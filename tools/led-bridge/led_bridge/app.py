from __future__ import annotations

import argparse
import signal
import threading
import time
from pathlib import Path

from .config import load_config
from .event_journal import append_order_event
from .firebase_listener import FirebaseOrdersWatcher
from .led_wall import LedWallController
from .logging_utils import log
from .models import OrderEvent, STATUS_LOG_LABELS, validate_order_event
from .panel import PixelPanel
from .queueing import DisplayQueue
from .renderer import (
    ACTIVE_STATUSES,
    RUSH_THRESHOLD,
    render_last_call,
    render_message,
    render_new_badge,
    render_order,
    render_order_grid,
    render_ready_alert_frame,
    render_ready_list,
    render_ready_pulse,
    render_rush_summary,
)

HEALTH_LOG_SECONDS = 30
TERMINAL_STATUSES = {"served", "cancelled"}


class ConfigState:
    def __init__(self, config_path: Path, initial_config):
        self.config_path = config_path
        self._config = initial_config
        self._mtime = self._read_mtime()
        self._last_check = 0.0
        self._revision = 0
        self._lock = threading.Lock()

    def _read_mtime(self) -> float:
        try:
            return self.config_path.stat().st_mtime
        except OSError:
            return 0.0

    def get(self):
        with self._lock:
            return self._config

    @property
    def revision(self) -> int:
        with self._lock:
            return self._revision

    def reload_if_changed(self):
        with self._lock:
            now = time.monotonic()
            interval = max(0.5, _config_value(self._config, "config_reload_seconds", 1.5))
            if now - self._last_check < interval:
                return self._config
            self._last_check = now

            mtime = self._read_mtime()
            if mtime == self._mtime:
                return self._config

            try:
                next_config = load_config(self.config_path)
            except Exception as exc:
                log(f"Config non rechargee: {exc}")
                return self._config

            self._config = next_config
            self._mtime = mtime
            self._revision += 1
            log(
                "Config rechargee: "
                f"stand_open={next_config.stand_open}, "
                f"high_contrast={next_config.high_contrast}, "
                f"rotation={next_config.panel.rotation_seconds}s"
            )
            return self._config


class FirebaseConnectionState:
    def __init__(self):
        self._connected = False
        self._detail = "demarrage"
        self._changed_at = time.monotonic()
        self._lock = threading.Lock()

    def set(self, connected: bool, detail: str = "") -> None:
        with self._lock:
            if self._connected == connected and self._detail == detail:
                return
            self._connected = connected
            self._detail = detail
            self._changed_at = time.monotonic()

    def label(self) -> str:
        with self._lock:
            if self._connected:
                return "Firebase OK"
            age = int(time.monotonic() - self._changed_at)
            detail = f" ({self._detail})" if self._detail else ""
            return f"Firebase reconnexion {age}s{detail}"


def _config_value(config, key: str, default):
    return getattr(config, key, default)


def _panel_value(config, key: str, default):
    return getattr(config.panel, key, default)


def _refresh_config(config_source):
    reload_if_changed = getattr(config_source, "reload_if_changed", None)
    if callable(reload_if_changed):
        return reload_if_changed()
    return config_source


def _config_revision(config_source) -> int:
    return getattr(config_source, "revision", 0)


def display_event(panel: PixelPanel, generated_dir: Path, event, *, high_contrast: bool = False) -> None:
    image_path = render_order(event, generated_dir, high_contrast=high_contrast)
    log(f"Commande #{event.number} -> {event.log_label}")
    panel.send_image(image_path)


def _active_list(events: dict[str, OrderEvent]) -> list[OrderEvent]:
    return sorted(events.values(), key=lambda event: event.number)


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
    high_contrast: bool = False,
    ready_since: float | None = None,
    last_call_seconds: float = 180,
    index: int | None = None,
    total: int | None = None,
    pulse_phase: int = 0,
) -> None:
    suffix = f" ({index}/{total})" if index is not None and total else ""
    name = f" {event.guest_name}" if event.guest_name else ""
    is_last_call = ready_since is not None and time.monotonic() - ready_since >= last_call_seconds
    if is_last_call:
        log(f"Dernier appel{suffix}: #{event.number}{name}")
        panel.send_image(render_last_call(event, generated_dir, high_contrast=high_contrast))
        return

    log(f"A recuperer{suffix}: #{event.number}{name}")
    panel.send_image(render_ready_pulse(event, generated_dir, phase=pulse_phase, high_contrast=high_contrast))


def display_active_events(
    panel: PixelPanel,
    generated_dir: Path,
    events: dict[str, OrderEvent],
    *,
    page: int = 0,
    high_contrast: bool = False,
    status_since: dict[str, float] | None = None,
    last_call_seconds: float = 180,
) -> None:
    status_since = status_since or {}
    active_list = _active_list(events)
    if not active_list:
        panel.send_image(render_message("idle", generated_dir, detail="SARAH", high_contrast=high_contrast))
        return

    ready_list = _ready_list(events)
    if len(ready_list) >= 2:
        now = time.monotonic()
        last_call_events = [
            event
            for event in ready_list
            if now - status_since.get(event.order_id, now) >= last_call_seconds
        ]
        if last_call_events:
            event = last_call_events[page % len(last_call_events)]
            _send_ready_focus(
                panel,
                generated_dir,
                event,
                high_contrast=high_contrast,
                ready_since=status_since.get(event.order_id),
                last_call_seconds=last_call_seconds,
                index=(page % len(last_call_events)) + 1,
                total=len(last_call_events),
                pulse_phase=page,
            )
            return

        ready_pages = (len(ready_list) + 2) // 3
        overview_needed = len(active_list) > len(ready_list)
        cycle_len = ready_pages + (1 if overview_needed else 0)
        slot = page % cycle_len
        if slot < ready_pages:
            image_path = render_ready_list(ready_list, generated_dir, page=slot, high_contrast=high_contrast)
            names = ", ".join(event.guest_name or f"#{event.number}" for event in ready_list)
            log(f"Commandes pretes: {names}")
            panel.send_image(image_path)
            return

    if len(active_list) >= RUSH_THRESHOLD:
        if ready_list:
            cycle_len = len(ready_list) + 1
            slot = page % cycle_len
            if slot < len(ready_list):
                event = ready_list[slot]
                _send_ready_focus(
                    panel,
                    generated_dir,
                    event,
                    high_contrast=high_contrast,
                    ready_since=status_since.get(event.order_id),
                    last_call_seconds=last_call_seconds,
                    index=slot + 1,
                    total=len(ready_list),
                    pulse_phase=page,
                )
                return

        ready_count, preparing_count, received_count = _counts(events)
        image_path = render_rush_summary(active_list, generated_dir, high_contrast=high_contrast)
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
            event = ready_list[slot]
            _send_ready_focus(
                panel,
                generated_dir,
                event,
                high_contrast=high_contrast,
                ready_since=status_since.get(event.order_id),
                last_call_seconds=last_call_seconds,
                index=slot + 1,
                total=len(ready_list),
                pulse_phase=page,
            )
            return

    if len(active_list) == 1:
        display_event(panel, generated_dir, active_list[0], high_contrast=high_contrast)
        return

    image_path = render_order_grid(active_list, generated_dir, page=page, high_contrast=high_contrast)
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


def log_health(
    panel: PixelPanel,
    active_events: dict[str, OrderEvent],
    last_event: OrderEvent | None,
    last_event_at: float | None,
    firebase_state: FirebaseConnectionState | None = None,
) -> None:
    ready_count, preparing_count, received_count = _counts(active_events)
    if last_event and last_event_at is not None:
        age = max(0, int(time.monotonic() - last_event_at))
        last = f"dernier #{last_event.number} {last_event.led_label} il y a {age}s"
    else:
        last = "aucun changement recu"
    firebase_label = firebase_state.label() if firebase_state else "Firebase OK"

    log(
        f"Sante: {firebase_label} | "
        f"{_panel_health(panel)} | actifs {len(active_events)} "
        f"(PRET {ready_count}, PREPA {preparing_count}, RECU {received_count}) | {last}"
    )


def log_stuck_orders(
    active_events: dict[str, OrderEvent],
    status_since: dict[str, float],
    stuck_logged_at: dict[str, float],
    *,
    stuck_order_minutes: float,
    stuck_repeat_minutes: float,
) -> None:
    if stuck_order_minutes <= 0:
        return

    now = time.monotonic()
    threshold = stuck_order_minutes * 60
    repeat = max(60, stuck_repeat_minutes * 60)
    for order_id, event in active_events.items():
        if event.status not in {"received", "preparing"}:
            continue

        started_at = status_since.get(order_id, now)
        age = now - started_at
        if age < threshold:
            continue

        last_log = stuck_logged_at.get(order_id, 0)
        if now - last_log < repeat:
            continue

        log(f"Commande #{event.number} bloquee depuis {int(age // 60)} min ({event.led_label}).")
        stuck_logged_at[order_id] = now

    active_ids = set(active_events)
    for order_id in list(stuck_logged_at):
        if order_id not in active_ids:
            stuck_logged_at.pop(order_id, None)


def should_rotate_active_display(active_events: dict[str, OrderEvent]) -> bool:
    if len(active_events) >= RUSH_THRESHOLD:
        return True
    return bool(_ready_list(active_events))


def rotation_delay_seconds(config, active_events: dict[str, OrderEvent]) -> float:
    ready_list = _ready_list(active_events)
    if len(ready_list) == 1 and len(active_events) == 1:
        return _panel_value(config, "ready_pulse_seconds", 1.2)
    return config.panel.rotation_seconds


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


def _send_interruptible_image(
    panel: PixelPanel,
    image_path: Path,
    queue: DisplayQueue,
    stop_event: threading.Event,
    delay: float,
) -> OrderEvent | None:
    panel.send_image(image_path)
    return wait_for_next_event(queue, stop_event, delay)


def _play_new_badge(
    panel: PixelPanel,
    config,
    event: OrderEvent,
    queue: DisplayQueue,
    stop_event: threading.Event,
    *,
    high_contrast: bool = False,
) -> OrderEvent | None:
    delay = _panel_value(config, "new_badge_seconds", 0.9)
    if delay <= 0 or event.initial:
        return None

    log(f"Nouvelle commande: #{event.number} {event.guest_name}".rstrip())
    return _send_interruptible_image(
        panel,
        render_new_badge(event, config.generated_dir, high_contrast=high_contrast),
        queue,
        stop_event,
        delay,
    )


def _play_ready_alert(
    panel: PixelPanel,
    config,
    event: OrderEvent,
    queue: DisplayQueue,
    stop_event: threading.Event,
    *,
    high_contrast: bool = False,
) -> OrderEvent | None:
    delay = _panel_value(config, "ready_animation_frame_seconds", 0.45)
    if delay <= 0 or event.initial:
        return None

    log(f"Animation pret: #{event.number} {event.guest_name}".rstrip())
    for frame in (0, 1, 0):
        pending = _send_interruptible_image(
            panel,
            render_ready_alert_frame(event, config.generated_dir, frame=frame, high_contrast=high_contrast),
            queue,
            stop_event,
            delay,
        )
        if pending is not None:
            return pending
    return None


def _journal_event(config, event: OrderEvent) -> None:
    try:
        append_order_event(_config_value(config, "event_log_path", None), event)
    except Exception as exc:
        log(f"Journal commande indisponible: {exc}")


def _update_active_state(
    event: OrderEvent,
    active_events: dict[str, OrderEvent],
    status_since: dict[str, float],
    stuck_logged_at: dict[str, float],
) -> None:
    if event.status in ACTIVE_STATUSES:
        previous = active_events.get(event.order_id)
        if previous is None or previous.status != event.status:
            status_since[event.order_id] = time.monotonic()
            stuck_logged_at.pop(event.order_id, None)
        active_events[event.order_id] = event
        return

    active_events.pop(event.order_id, None)
    status_since.pop(event.order_id, None)
    stuck_logged_at.pop(event.order_id, None)


def _show_current_state(
    panel: PixelPanel,
    config,
    active_events: dict[str, OrderEvent],
    status_since: dict[str, float],
    *,
    page: int = 0,
) -> None:
    display_active_events(
        panel,
        config.generated_dir,
        active_events,
        page=page,
        high_contrast=_config_value(config, "high_contrast", False),
        status_since=status_since,
        last_call_seconds=_panel_value(config, "last_call_seconds", 180),
    )


def run_worker(
    config,
    queue: DisplayQueue,
    panel: PixelPanel,
    stop_event: threading.Event,
    firebase_state: FirebaseConnectionState | None = None,
) -> None:
    current_config = _refresh_config(config)
    high_contrast = _config_value(current_config, "high_contrast", False)
    if not _config_value(current_config, "stand_open", True):
        try:
            panel.send_image(render_message("closed", current_config.generated_dir, high_contrast=high_contrast))
            log("Stand ferme: affichage STAND FERME actif.")
        except Exception as exc:
            log(f"Affichage stand ferme impossible: {exc}")
        closed_sent = True
    else:
        closed_sent = False
        try:
            panel.send_image(
                render_message("startup", current_config.generated_dir, detail="START", high_contrast=high_contrast)
            )
        except Exception as exc:
            log(f"Demarrage panneau impossible: {exc}")

    idle_sent = False
    active_events: dict[str, OrderEvent] = {}
    status_since: dict[str, float] = {}
    stuck_logged_at: dict[str, float] = {}
    active_page = 0
    last_rotation = time.monotonic()
    last_health = 0.0
    last_event = None
    last_event_at = None
    pending_event = None
    last_config_revision = _config_revision(config)
    while not stop_event.is_set():
        current_config = _refresh_config(config)
        high_contrast = _config_value(current_config, "high_contrast", False)
        current_revision = _config_revision(config)
        config_changed = current_revision != last_config_revision
        if config_changed:
            last_config_revision = current_revision
            idle_sent = False
            last_rotation = 0.0

        if not _config_value(current_config, "stand_open", True):
            if not closed_sent:
                try:
                    panel.send_image(render_message("closed", current_config.generated_dir, high_contrast=high_contrast))
                    log("Stand ferme: affichage STAND FERME actif.")
                except Exception as exc:
                    log(f"Affichage stand ferme impossible: {exc}")
                closed_sent = True
                idle_sent = False

            event = pending_event or queue.next_event(timeout=1)
            pending_event = None
            if event is not None:
                _journal_event(current_config, event)
                _update_active_state(event, active_events, status_since, stuck_logged_at)
                last_event = event
                last_event_at = time.monotonic()
            continue

        if closed_sent:
            closed_sent = False
            idle_sent = False
            try:
                _show_current_state(panel, current_config, active_events, status_since, page=active_page)
            except Exception as exc:
                log(f"Reouverture stand: affichage impossible: {exc}")

        if config_changed and active_events:
            try:
                _show_current_state(panel, current_config, active_events, status_since, page=active_page)
                last_rotation = time.monotonic()
            except Exception as exc:
                log(f"Reaffichage apres config impossible: {exc}")

        event = pending_event or queue.next_event(timeout=2)
        pending_event = None
        if event is None:
            health_seconds = _config_value(current_config, "health_log_seconds", HEALTH_LOG_SECONDS)
            if time.monotonic() - last_health >= health_seconds:
                log_health(panel, active_events, last_event, last_event_at, firebase_state)
                log_stuck_orders(
                    active_events,
                    status_since,
                    stuck_logged_at,
                    stuck_order_minutes=_config_value(current_config, "stuck_order_minutes", 15),
                    stuck_repeat_minutes=_config_value(current_config, "stuck_repeat_minutes", 5),
                )
                last_health = time.monotonic()

            if active_events:
                if (
                    should_rotate_active_display(active_events)
                    and time.monotonic() - last_rotation >= rotation_delay_seconds(current_config, active_events)
                ):
                    active_page += 1
                    try:
                        _show_current_state(panel, current_config, active_events, status_since, page=active_page)
                    except Exception as exc:
                        log(f"Erreur rotation panneau: {exc}")
                    last_rotation = time.monotonic()
                continue
            if idle_sent:
                continue
            try:
                panel.send_image(
                    render_message("idle", current_config.generated_dir, detail="STAND", high_contrast=high_contrast)
                )
                idle_sent = True
            except Exception as exc:
                log(f"Affichage attente impossible: {exc}")
            continue

        idle_sent = False
        last_event = event
        last_event_at = time.monotonic()
        _journal_event(current_config, event)
        try:
            previous_event = active_events.get(event.order_id)
            _update_active_state(event, active_events, status_since, stuck_logged_at)
            if event.status in ACTIVE_STATUSES:
                active_page = 0
                if event.status == "received" and previous_event is None:
                    pending_event = _play_new_badge(
                        panel,
                        current_config,
                        event,
                        queue,
                        stop_event,
                        high_contrast=high_contrast,
                    )
                    if pending_event is not None:
                        continue

                if event.status == "ready":
                    pending_event = _play_ready_alert(
                        panel,
                        current_config,
                        event,
                        queue,
                        stop_event,
                        high_contrast=high_contrast,
                    )
                    if pending_event is not None:
                        continue

                    if len(_ready_list(active_events)) >= 2:
                        _show_current_state(panel, current_config, active_events, status_since, page=active_page)
                    else:
                        _send_ready_focus(
                            panel,
                            current_config.generated_dir,
                            event,
                            high_contrast=high_contrast,
                            ready_since=status_since.get(event.order_id),
                            last_call_seconds=_panel_value(current_config, "last_call_seconds", 180),
                        )
                else:
                    _show_current_state(panel, current_config, active_events, status_since, page=active_page)
            else:
                display_event(panel, current_config.generated_dir, event, high_contrast=high_contrast)
            last_rotation = time.monotonic()
        except Exception as exc:
            log(f"Erreur panneau: {exc}")
            try:
                panel.send_image(
                    render_message(
                        "bluetooth_error",
                        current_config.generated_dir,
                        detail="ERR",
                        high_contrast=high_contrast,
                    )
                )
            except Exception:
                pass

        if event.status == "ready":
            pulse_delay = _panel_value(current_config, "ready_pulse_seconds", 1.2)
            delay = pulse_delay if pulse_delay > 0 else current_config.panel.ready_display_seconds
        elif event.status in TERMINAL_STATUSES:
            delay = _panel_value(current_config, "terminal_display_seconds", 1)
        else:
            delay = current_config.panel.status_display_seconds
        pending_event = wait_for_next_event(queue, stop_event, delay)
        if pending_event is None and active_events and not stop_event.is_set():
            try:
                if event.status == "ready" or event.status not in ACTIVE_STATUSES:
                    active_page += 1
                _show_current_state(panel, current_config, active_events, status_since, page=active_page)
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
    config_state = ConfigState(config_path, config)
    firebase_state = FirebaseConnectionState()
    stop_event = threading.Event()
    queue = DisplayQueue(queue_existing_ready_on_start=config.queue_existing_ready_on_start)
    panel = create_display_controller(config, dry_run=dry_run)

    def stop(_signum=None, _frame=None):
        stop_event.set()
        panel.close()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    worker = threading.Thread(target=run_worker, args=(config_state, queue, panel, stop_event, firebase_state), daemon=True)
    worker.start()

    watcher = FirebaseOrdersWatcher(config.firebase)
    log("Sarah Burger LED Bridge")
    log(f"Session Firebase: {config.firebase.session_id}")
    if config.panel.wall_panels:
        for name, address in config.panel.wall_panels.items():
            log(f"Panneau {name}: {address}")
    else:
        log(f"Panneau: {config.panel.bluetooth_address}")
    watcher.listen(lambda event: queue.enqueue(event), stop_event, on_connection_state=firebase_state.set)


def run_test(config_path: Path, number: int, status: str, *, dry_run: bool = False) -> None:
    config = load_config(config_path)
    event = validate_order_event(
        {"orderId": "test-local", "number": number, "guestName": "Test", "status": status}
    )
    panel = create_display_controller(config, dry_run=dry_run)
    display_event(panel, config.generated_dir, event, high_contrast=config.high_contrast)
    panel.close()


def render_samples(config_path: Path) -> None:
    config = load_config(config_path)
    for number in (1, 9, 18, 27, 99, 100, 999):
        for status in STATUS_LOG_LABELS:
            event = validate_order_event(
                {"orderId": f"sample-{number}-{status}", "number": number, "guestName": "", "status": status}
            )
            path = render_order(event, config.generated_dir, high_contrast=config.high_contrast)
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
