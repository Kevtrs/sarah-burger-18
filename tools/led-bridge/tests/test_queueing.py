from __future__ import annotations

import unittest

from led_bridge.models import validate_order_event
from led_bridge.queueing import DisplayQueue


def event(order_id: str, number: int, status: str, *, initial: bool = False):
    return validate_order_event(
        {"orderId": order_id, "number": number, "guestName": "Test", "status": status},
        initial=initial,
    )


class DisplayQueueTest(unittest.TestCase):
    def test_ready_events_are_fifo(self):
        queue = DisplayQueue()
        self.assertTrue(queue.enqueue(event("a", 18, "ready")))
        self.assertTrue(queue.enqueue(event("b", 19, "ready")))

        self.assertEqual(queue.next_event().number, 18)
        self.assertEqual(queue.next_event().number, 19)

    def test_duplicate_status_is_ignored(self):
        queue = DisplayQueue()
        self.assertTrue(queue.enqueue(event("a", 18, "preparing")))
        self.assertFalse(queue.enqueue(event("a", 18, "preparing")))

    def test_keeps_latest_non_ready_state(self):
        queue = DisplayQueue()
        queue.enqueue(event("a", 18, "received"))
        queue.enqueue(event("a", 18, "preparing"))

        self.assertEqual(queue.next_event().status, "preparing")
        self.assertIsNone(queue.next_event(timeout=0))

    def test_existing_ready_is_not_queued_by_default(self):
        queue = DisplayQueue()
        self.assertFalse(queue.enqueue(event("a", 18, "ready", initial=True)))

        self.assertIsNone(queue.next_event(timeout=0))

    def test_ready_seen_after_reconnect_is_queued_when_status_changed(self):
        queue = DisplayQueue()
        queue.enqueue(event("a", 18, "preparing", initial=True))
        self.assertEqual(queue.next_event().status, "preparing")

        self.assertTrue(queue.enqueue(event("a", 18, "ready", initial=True)))
        self.assertEqual(queue.next_event().status, "ready")


if __name__ == "__main__":
    unittest.main()
