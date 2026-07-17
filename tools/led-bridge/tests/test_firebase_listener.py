from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import Mock

from led_bridge.config import FirebaseConfig
from led_bridge.firebase_listener import FirebaseOrdersWatcher


class FirebaseApplyChangeTest(unittest.TestCase):
    def test_oauth_url_uses_access_token_parameter(self):
        watcher = FirebaseOrdersWatcher.__new__(FirebaseOrdersWatcher)
        watcher.config = FirebaseConfig(
            database_url="https://example.firebaseio.com",
            service_account_path=Path("service-account.json"),
            session_id="sarah-18-2026",
        )
        watcher._token = Mock(return_value="token-value")

        url = watcher._url("sessions/sarah-18-2026/orders")

        self.assertIn("access_token=token-value", url)
        self.assertNotIn("?auth=", url)

    def test_http_error_does_not_include_tokenized_url(self):
        watcher = FirebaseOrdersWatcher.__new__(FirebaseOrdersWatcher)
        response = Mock(ok=False, status_code=401, text='{"error":"Permission denied"}')

        with self.assertRaisesRegex(RuntimeError, "Firebase HTTP 401 sur lecture"):
            watcher._raise_for_status(response, "lecture")

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
