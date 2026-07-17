from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from led_bridge.app import run_worker
from led_bridge.models import validate_order_event


def event(order_id: str, number: int, status: str):
    return validate_order_event(
        {"orderId": order_id, "number": number, "guestName": "Test", "status": status}
    )


class FakePanel:
    def __init__(self):
        self.sent: list[Path] = []

    def send_image(self, path: Path) -> None:
        self.sent.append(path)


class ScriptedQueue:
    def __init__(self, stop_event: threading.Event, events):
        self.stop_event = stop_event
        self.events = list(events)

    def next_event(self, timeout=None):
        if self.events:
            return self.events.pop(0)
        self.stop_event.set()
        return None


class WorkerDisplayTest(unittest.TestCase):
    def test_active_order_stays_on_panel_instead_of_idle(self):
        stop_event = threading.Event()
        panel = FakePanel()
        queue = ScriptedQueue(stop_event, [event("order-39", 39, "received")])

        with tempfile.TemporaryDirectory() as tmp:
            config = SimpleNamespace(
                generated_dir=Path(tmp),
                panel=SimpleNamespace(
                    ready_display_seconds=0,
                    status_display_seconds=0,
                    rotation_seconds=3,
                ),
            )

            run_worker(config, queue, panel, stop_event)

        sent_names = [path.name for path in panel.sent]
        self.assertIn("startup.png", sent_names)
        self.assertIn("order-order-39-received.png", sent_names)
        self.assertNotIn("idle.png", sent_names)

    def test_status_delay_is_interrupted_by_next_event(self):
        stop_event = threading.Event()
        panel = FakePanel()
        queue = ScriptedQueue(
            stop_event,
            [event("order-39", 39, "received"), event("order-39", 39, "preparing")],
        )

        with tempfile.TemporaryDirectory() as tmp:
            config = SimpleNamespace(
                generated_dir=Path(tmp),
                panel=SimpleNamespace(
                    ready_display_seconds=1,
                    status_display_seconds=1,
                    rotation_seconds=3,
                ),
            )

            started_at = time.monotonic()
            run_worker(config, queue, panel, stop_event)
            elapsed = time.monotonic() - started_at

        sent_names = [path.name for path in panel.sent]
        self.assertIn("order-order-39-received.png", sent_names)
        self.assertIn("order-order-39-preparing.png", sent_names)
        self.assertLess(elapsed, 0.8)

    def test_multiple_active_orders_use_grid_display(self):
        stop_event = threading.Event()
        panel = FakePanel()
        queue = ScriptedQueue(
            stop_event,
            [
                event("order-39", 39, "received"),
                event("order-40", 40, "preparing"),
            ],
        )

        with tempfile.TemporaryDirectory() as tmp:
            config = SimpleNamespace(
                generated_dir=Path(tmp),
                panel=SimpleNamespace(
                    ready_display_seconds=1,
                    status_display_seconds=1,
                    rotation_seconds=3,
                ),
            )

            run_worker(config, queue, panel, stop_event)

        sent_names = [path.name for path in panel.sent]
        self.assertIn("active-orders-page-1.png", sent_names)

    def test_ready_order_gets_fullscreen_priority(self):
        stop_event = threading.Event()
        panel = FakePanel()
        queue = ScriptedQueue(
            stop_event,
            [
                event("order-39", 39, "received"),
                event("order-40", 40, "ready"),
            ],
        )

        with tempfile.TemporaryDirectory() as tmp:
            config = SimpleNamespace(
                generated_dir=Path(tmp),
                panel=SimpleNamespace(
                    ready_display_seconds=1,
                    status_display_seconds=1,
                    rotation_seconds=3,
                ),
            )

            run_worker(config, queue, panel, stop_event)

        sent_names = [path.name for path in panel.sent]
        self.assertIn("order-order-40-ready.png", sent_names)

    def test_five_active_orders_use_rush_summary(self):
        stop_event = threading.Event()
        panel = FakePanel()
        queue = ScriptedQueue(
            stop_event,
            [event(f"order-{number}", number, "received") for number in range(39, 44)],
        )

        with tempfile.TemporaryDirectory() as tmp:
            config = SimpleNamespace(
                generated_dir=Path(tmp),
                panel=SimpleNamespace(
                    ready_display_seconds=0,
                    status_display_seconds=0,
                    rotation_seconds=3,
                ),
            )

            run_worker(config, queue, panel, stop_event)

        sent_names = [path.name for path in panel.sent]
        self.assertIn("rush-summary.png", sent_names)


if __name__ == "__main__":
    unittest.main()
