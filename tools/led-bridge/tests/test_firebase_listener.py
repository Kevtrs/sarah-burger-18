from __future__ import annotations

import unittest

from led_bridge.firebase_listener import FirebaseOrdersWatcher


class FirebaseApplyChangeTest(unittest.TestCase):
    def test_status_patch_emits_full_order(self):
        watcher = FirebaseOrdersWatcher.__new__(FirebaseOrdersWatcher)
        watcher._orders = {
            "order-1": {
                "number": 27,
                "guestName": "Kevin",
                "status": "received",
            }
        }
        events = []

        watcher._apply_change("/order-1/status", "ready", events.append)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].order_id, "order-1")
        self.assertEqual(events[0].number, 27)
        self.assertEqual(events[0].status, "ready")

    def test_full_snapshot_emits_initial_events(self):
        watcher = FirebaseOrdersWatcher.__new__(FirebaseOrdersWatcher)
        watcher._orders = {}
        events = []

        watcher._apply_change(
            "/",
            {"order-1": {"number": 18, "guestName": "Sarah", "status": "preparing"}},
            events.append,
        )

        self.assertEqual(len(events), 1)
        self.assertTrue(events[0].initial)
        self.assertEqual(events[0].status, "preparing")


if __name__ == "__main__":
    unittest.main()
