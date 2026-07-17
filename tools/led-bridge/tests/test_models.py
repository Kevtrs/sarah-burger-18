from __future__ import annotations

import unittest

from led_bridge.models import STATUS_LABELS, validate_order_event


class EventValidationTest(unittest.TestCase):
    def test_valid_event(self):
        event = validate_order_event(
            {"orderId": "abc-123", "number": 27, "guestName": "Kevin", "status": "ready"}
        )

        self.assertEqual(event.order_id, "abc-123")
        self.assertEqual(event.number, 27)
        self.assertEqual(event.guest_name, "Kevin")
        self.assertEqual(event.status, "ready")
        self.assertEqual(event.led_label, "PRET")

    def test_rejects_invalid_number(self):
        with self.assertRaises(ValueError):
            validate_order_event({"orderId": "abc", "number": 0, "status": "ready"})

    def test_rejects_invalid_status(self):
        with self.assertRaises(ValueError):
            validate_order_event({"orderId": "abc", "number": 27, "status": "done"})

    def test_status_mapping_is_complete(self):
        self.assertEqual(
            set(STATUS_LABELS),
            {"received", "preparing", "ready", "served", "cancelled"},
        )


if __name__ == "__main__":
    unittest.main()
