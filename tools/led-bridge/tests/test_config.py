from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from led_bridge.config import load_config


class ConfigTest(unittest.TestCase):
    def test_new_display_options_have_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "firebase": {
                            "database_url": "https://example.firebaseio.com",
                            "service_account_path": "service-account.json",
                        },
                        "panel": {
                            "bluetooth_address": "AA:BB:CC:DD:EE:FF",
                        },
                    }
                ),
                encoding="utf-8",
            )

            config = load_config(path)

        self.assertTrue(config.stand_open)
        self.assertFalse(config.high_contrast)
        self.assertEqual(config.panel.terminal_display_seconds, 1)
        self.assertEqual(config.panel.last_call_seconds, 180)
        self.assertEqual(config.panel.ready_pulse_seconds, 1.2)
        self.assertEqual(config.panel.ready_animation_frame_seconds, 0.45)
        self.assertEqual(config.panel.new_badge_seconds, 0.9)
        self.assertEqual(config.stuck_order_minutes, 15)
        self.assertEqual(config.health_log_seconds, 30)
        self.assertEqual(config.config_reload_seconds, 1.5)
        self.assertEqual(config.event_log_path.name, "orders-log.txt")

    def test_stand_and_contrast_can_be_configured_at_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "stand_open": False,
                        "high_contrast": True,
                        "firebase": {
                            "database_url": "https://example.firebaseio.com",
                            "service_account_path": "service-account.json",
                        },
                        "panel": {
                            "bluetooth_address": "AA:BB:CC:DD:EE:FF",
                            "terminal_display_seconds": 0.5,
                            "last_call_seconds": 60,
                            "ready_pulse_seconds": 0.8,
                            "ready_animation_frame_seconds": 0.2,
                            "new_badge_seconds": 0.4,
                        },
                        "behavior": {
                            "stuck_order_minutes": 10,
                            "health_log_seconds": 12,
                            "config_reload_seconds": 0.5,
                            "event_log_path": "logs/orders-test.txt",
                        },
                    }
                ),
                encoding="utf-8",
            )

            config = load_config(path)

        self.assertFalse(config.stand_open)
        self.assertTrue(config.high_contrast)
        self.assertEqual(config.panel.terminal_display_seconds, 0.5)
        self.assertEqual(config.panel.last_call_seconds, 60)
        self.assertEqual(config.panel.ready_pulse_seconds, 0.8)
        self.assertEqual(config.panel.ready_animation_frame_seconds, 0.2)
        self.assertEqual(config.panel.new_badge_seconds, 0.4)
        self.assertEqual(config.stuck_order_minutes, 10)
        self.assertEqual(config.health_log_seconds, 12)
        self.assertEqual(config.config_reload_seconds, 0.5)
        self.assertEqual(config.event_log_path.name, "orders-test.txt")

    def test_config_accepts_utf8_bom_from_windows_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            raw = json.dumps(
                {
                    "firebase": {
                        "database_url": "https://example.firebaseio.com",
                        "service_account_path": "service-account.json",
                    },
                    "panel": {
                        "bluetooth_address": "AA:BB:CC:DD:EE:FF",
                    },
                }
            )
            path.write_text("\ufeff" + raw, encoding="utf-8")

            config = load_config(path)

        self.assertTrue(config.stand_open)


if __name__ == "__main__":
    unittest.main()
