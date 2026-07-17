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
from .models import OrderEvent, STATUS_LOG_LABELS, validate_order_event
from .panel import PixelPanel
from .queueing import DisplayQueue
from .renderer import ACTIVE_STATUSES, RUSH_THRESHOLD, render_message, render_order, render_order_grid, render_rush_summary

HEALTH_LOG_SECONDS = 30


def display_event(panel: PixelPanel, generated_dir: Path, event) -> None:
    image_path = render_order(event, generated_dir)
    log(f"Commande #{event.number} -> {event.log_label}")
    panel.send_image(image_path)


def _active_list(events: dict[str, OrderEvent]) -> list[OrderEvent]:
    return sorted(events.values(), key=lambda event: (event.status != "ready", event.number))


def _ready_list(events: dict[str, OrderEvent]) -> list[OrderEvent]:
    return sorted([event for event in events.values() if event.status == "ready"], key=lambda event: event.number)


def _counts(events: dict[str, OrderEvent]) -> tuple[int, int, int]:
    values = list(events.values())
    ready = sum(1 for event in values if event.status == "ready")
    preparing = sum(1 for event in values if event.status == "preparing")
    received = sum(1 for event in values if event.status == "received")
    return ready, preparing, received


def _send_ready_focus(
    panel: PixelPanel,
    generated_dir: Path,
    event: OrderEvent,
    *,
    index: int | None = None,
    total: int | None = None,
) -> None:
    suffix = f" ({index}/{total})" if index is not None and total else ""
    name = f" {event.guest_name}" if event.guest_name else ""
    log(f"A recuperer{suffix}: #{event.number}{name}")
    panel.send_image(render_order(event, generated_dir))


def display_active_events(panel: PixelPanel, generated_dir: Path, events: dict[str, OrderEvent], *, page: int = 0) -> None:
    active_list = _active_list(events)
    if not active_list:
        panel.send_image(render_message("idle", generated_dir, detail="SARAH"))
        return

    ready_list = _ready_list(events)
    if len(active_list) >= RUSH_THRESHOLD:
        if ready_list:
            cycle_len = len(ready_list) + 1
            slot = page % cycle_len
            if slot < len(ready_list):
                _send_ready_focus(panel, generated_dir, ready_list[slot], index=slot + 1, total=len(ready_list))
                return

        ready_count, preparing_count, received_count = _counts(events)
        image_path = render_rush_summary(active_list, generated_dir)
        log(
            "Mode rush: "
            f"{len(active_list)} actives | PRET {ready_count} | PREPA {preparing_count} | RECU {received_count}"
        )
        panel.send_image(image_path)
        return

    if ready_list:
        overview_needed = len(active_list) > len(ready_list)
        cycle_len = len(ready_list) + (1 if overview_needed else 0)
        slot = page % cycle_len
        if slot < len(ready_list):
            _send_ready_focus(panel, generated_dir, ready_list[slot], index=slot + 1, total=len(ready_list))
            return

    if len(active_list) == 1:
        display_event(panel, generated_dir, active_list[0])
        return

    image_path = render_order_grid(active_list, generated_dir, page=page)
    log(f"Affichage grille commandes actives ({len(active_list)})")
    panel.send_image(image_path)


def _panel_health(panel: PixelPanel) -> str:
    wall_panels = getattr(panel, "panels", None)
    if isinstance(wall_panels, dict) and wall_panels:
        total = len(wall_panels)
        connected = sum(1 for item in wall_panels.values() if getattr(item, "dry_run", False) or item.connected)
        return f"panneaux {connected}/{total} OK"

    if getattr(panel, "dry_run", False) or getattr(panel, "connected", False):
        return "panneau 1/1 OK"
    return "panneau 0/1 OK"


def log_health(panel: PixelPanel, active_events: dict[str, OrderEvent], last_event: OrderEvent | None, last_event_at: float | None) -> None:
    ready_count, preparing_count, received_count = _counts(active_events)
    if last_event and last_event_at is not None:
        age = max(0, int(time.monotonic() - last_event_at))
        last = f"dernier #{last_event.number} {last_event.led_label} il y a {age}s"
    else:
        last = "aucun changement recu"

    log(
        "Sante: Firebase OK | "
        f"{_panel_health(panel)} | actifs {len(active_events)} "
        f"(PRET {ready_count}, PREPA {preparing_count}, RECU {received_count}) | {last}"
    )


def should_rotate_active_display(active_events: dict[str, OrderEvent]) -> bool:
    if len(active_events) >= RUSH_THRESHOLD:
        return True
    return bool(_ready_list(active_events)) and len(active_events) > 1


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
    last_health = 0.0
    last_event = None
    last_event_at = None
    pending_event = None
    while not stop_event.is_set():
        event = pending_event or queue.next_event(timeout=2)
        pending_event = None
        if event is None:
            if time.monotonic() - last_health >= HEALTH_LOG_SECONDS:
                log_health(panel, active_events, last_event, last_event_at)
                last_health = time.monotonic()

            if active_events:
                if should_rotate_active_display(active_events) and time.monotonic() - last_rotation >= config.panel.rotation_seconds:
                    active_page += 1
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
        last_event = event
        last_event_at = time.monotonic()
        try:
            if event.status in ACTIVE_STATUSES:
                active_events[event.order_id] = event
                active_page = 0
                if event.status == "ready":
                    _send_ready_focus(panel, config.generated_dir, event)
                else:
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
        if pending_event is None and active_events and not stop_event.is_set():
            try:
                if event.status == "ready" or event.status not in ACTIVE_STATUSES:
                    active_page += 1
                display_active_events(panel, config.generated_dir, active_events, page=active_page)
                last_rotation = time.monotonic()
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
