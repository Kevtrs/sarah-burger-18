from __future__ import annotations

import argparse
import signal
import threading
import time
from pathlib import Path

from .config import load_config
from .firebase_listener import FirebaseOrdersWatcher
from .led_wall import LedWallController
from .logging_utils import log
from .models import STATUS_LOG_LABELS, validate_order_event
from .panel import PixelPanel
from .queueing import DisplayQueue
from .renderer import ACTIVE_STATUSES, render_message, render_order, render_order_grid


def display_event(panel: PixelPanel, generated_dir: Path, event) -> None:
    image_path = render_order(event, generated_dir)
    log(f"Commande #{event.number} -> {event.log_label}")
    panel.send_image(image_path)


def display_active_events(panel: PixelPanel, generated_dir: Path, events: dict[str, object], *, page: int = 0) -> None:
    active_list = list(events.values())
    if not active_list:
        panel.send_image(render_message("idle", generated_dir, detail="SARAH"))
        return

    if len(active_list) == 1:
        display_event(panel, generated_dir, active_list[0])
        return

    image_path = render_order_grid(active_list, generated_dir, page=page)
    log(f"Affichage grille commandes actives ({len(active_list)})")
    panel.send_image(image_path)


def wait_for_next_event(queue: DisplayQueue, stop_event: threading.Event, delay: float):
    if delay <= 0:
        return None

    deadline = time.monotonic() + delay
    while not stop_event.is_set():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None

        event = queue.next_event(timeout=min(0.25, remaining))
        if event is not None:
            return event

    return None


def run_worker(config, queue: DisplayQueue, panel: PixelPanel, stop_event: threading.Event) -> None:
    try:
        panel.send_image(render_message("startup", config.generated_dir, detail="START"))
    except Exception as exc:
        log(f"Demarrage panneau impossible: {exc}")

    idle_sent = False
    active_events = {}
    active_page = 0
    last_rotation = time.monotonic()
    pending_event = None
    while not stop_event.is_set():
        event = pending_event or queue.next_event(timeout=2)
        pending_event = None
        if event is None:
            if active_events:
                if len(active_events) > 4 and time.monotonic() - last_rotation >= config.panel.rotation_seconds:
                    page_count = (len(active_events) + 3) // 4
                    active_page = (active_page + 1) % page_count
                    try:
                        display_active_events(panel, config.generated_dir, active_events, page=active_page)
                    except Exception as exc:
                        log(f"Erreur rotation panneau: {exc}")
                    last_rotation = time.monotonic()
                continue
            if idle_sent:
                continue
            try:
                panel.send_image(render_message("idle", config.generated_dir, detail="STAND"))
                idle_sent = True
            except Exception as exc:
                log(f"Affichage attente impossible: {exc}")
            continue

        idle_sent = False
        try:
            if event.status in ACTIVE_STATUSES:
                active_events[event.order_id] = event
                active_page = 0
                display_active_events(panel, config.generated_dir, active_events, page=active_page)
            else:
                active_events.pop(event.order_id, None)
                display_event(panel, config.generated_dir, event)
            last_rotation = time.monotonic()
        except Exception as exc:
            log(f"Erreur panneau: {exc}")
            try:
                panel.send_image(render_message("bluetooth_error", config.generated_dir, detail="ERR"))
            except Exception:
                pass

        delay = config.panel.ready_display_seconds if event.status == "ready" else config.panel.status_display_seconds
        pending_event = wait_for_next_event(queue, stop_event, delay)
        if pending_event is None and event.status not in ACTIVE_STATUSES and active_events and not stop_event.is_set():
            try:
                display_active_events(panel, config.generated_dir, active_events, page=active_page)
            except Exception as exc:
                log(f"Erreur retour commandes actives: {exc}")


def create_display_controller(config, *, dry_run: bool = False):
    if config.panel.wall_panels:
        log("Mode mur LED 64x64 actif")
        return LedWallController(
            config.panel.wall_panels,
            config.generated_dir,
            brightness=config.panel.brightness,
            reconnect_delay_seconds=config.panel.reconnect_delay_seconds,
            dry_run=dry_run,
        )

    return PixelPanel(
        config.panel.bluetooth_address,
        brightness=config.panel.brightness,
        reconnect_delay_seconds=config.panel.reconnect_delay_seconds,
        dry_run=dry_run,
    )


def run(config_path: Path, *, dry_run: bool = False) -> None:
    config = load_config(config_path)
    stop_event = threading.Event()
    queue = DisplayQueue(queue_existing_ready_on_start=config.queue_existing_ready_on_start)
    panel = create_display_controller(config, dry_run=dry_run)

    def stop(_signum=None, _frame=None):
        stop_event.set()
        panel.close()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    worker = threading.Thread(target=run_worker, args=(config, queue, panel, stop_event), daemon=True)
    worker.start()

    watcher = FirebaseOrdersWatcher(config.firebase)
    log("Sarah Burger LED Bridge")
    log(f"Session Firebase: {config.firebase.session_id}")
    if config.panel.wall_panels:
        for name, address in config.panel.wall_panels.items():
            log(f"Panneau {name}: {address}")
    else:
        log(f"Panneau: {config.panel.bluetooth_address}")
    watcher.listen(lambda event: queue.enqueue(event), stop_event)


def run_test(config_path: Path, number: int, status: str, *, dry_run: bool = False) -> None:
    config = load_config(config_path)
    event = validate_order_event(
        {"orderId": "test-local", "number": number, "guestName": "Test", "status": status}
    )
    panel = create_display_controller(config, dry_run=dry_run)
    display_event(panel, config.generated_dir, event)
    panel.close()


def render_samples(config_path: Path) -> None:
    config = load_config(config_path)
    for number in (1, 9, 18, 27, 99, 100, 999):
        for status in STATUS_LOG_LABELS:
            event = validate_order_event(
                {"orderId": f"sample-{number}-{status}", "number": number, "guestName": "", "status": status}
            )
            path = render_order(event, config.generated_dir)
            log(f"Rendu test: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sarah Burger LED Bridge")
    parser.add_argument("--config", default="config.json", help="Chemin vers config.json")
    parser.add_argument("--dry-run", action="store_true", help="Ne pas envoyer au Bluetooth")
    parser.add_argument("--render-samples", action="store_true", help="Generer les rendus 1, 9, 18, 27, 99, 100, 999")
    parser.add_argument("--test", nargs=2, metavar=("NUMBER", "STATUS"), help="Afficher une commande fictive")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()

    if args.render_samples:
        render_samples(config_path)
    elif args.test:
        number = int(args.test[0])
        run_test(config_path, number, args.test[1], dry_run=args.dry_run)
    else:
        run(config_path, dry_run=args.dry_run)
