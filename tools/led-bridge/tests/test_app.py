from __future__ import annotations

import tempfile
import threading
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
                    idle_gif_path=None,
                    ready_display_seconds=0,
                    status_display_seconds=0,
                ),
            )

            run_worker(config, queue, panel, stop_event)

        sent_names = [path.name for path in panel.sent]
        self.assertIn("startup.png", sent_names)
        self.assertIn("order-order-39-received.png", sent_names)
        self.assertNotIn("idle.png", sent_names)


if __name__ == "__main__":
    unittest.main()
