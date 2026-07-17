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
from .renderer import render_message, render_order


def display_event(panel: PixelPanel, generated_dir: Path, event) -> None:
    image_path = render_order(event, generated_dir)
    log(f"Commande #{event.number} -> {event.log_label}")
    panel.send_image(image_path)


def run_worker(config, queue: DisplayQueue, panel: PixelPanel, stop_event: threading.Event) -> None:
    try:
        panel.send_image(render_message("startup", config.generated_dir, detail="START"))
    except Exception as exc:
        log(f"Demarrage panneau impossible: {exc}")

    idle_sent = False
    active_events = {}
    active_index = 0
    last_rotation = time.monotonic()
    while not stop_event.is_set():
        event = queue.next_event(timeout=2)
        if event is None:
            if active_events:
                active_list = sorted(active_events.values(), key=lambda item: (item.status != "preparing", item.number))
                if len(active_list) > 1 and time.monotonic() - last_rotation >= config.panel.rotation_seconds:
                    active_index = (active_index + 1) % len(active_list)
                    try:
                        display_event(panel, config.generated_dir, active_list[active_index])
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
            display_event(panel, config.generated_dir, event)
            if event.status in {"received", "preparing"}:
                active_events[event.order_id] = event
                active_index = 0
            else:
                active_events.pop(event.order_id, None)
                if active_events:
                    active_index %= len(active_events)
            last_rotation = time.monotonic()
        except Exception as exc:
            log(f"Erreur panneau: {exc}")
            try:
                panel.send_image(render_message("bluetooth_error", config.generated_dir, detail="ERR"))
            except Exception:
                pass

        delay = config.panel.ready_display_seconds if event.status == "ready" else config.panel.status_display_seconds
        stop_event.wait(delay)


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
