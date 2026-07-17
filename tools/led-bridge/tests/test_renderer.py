from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from led_bridge.models import validate_order_event
from led_bridge.renderer import choose_number_font, render_message, render_order, text_size
from led_bridge.virtual_display import VirtualDisplay64


class RendererTest(unittest.TestCase):
    def test_small_number_fits_under_guest_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            for number in (1, 9, 18, 27, 99, 100, 999):
                event = validate_order_event(
                    {"orderId": f"order-{number}", "number": number, "guestName": "", "status": "ready"}
                )
                path = render_order(event, output_dir)
                with Image.open(path) as image:
                    self.assertEqual(image.size, (64, 64))
                    self.assertEqual(image.mode, "RGB")
                    self.assertIsNotNone(image.getbbox())

                probe = Image.new("RGB", (64, 64))
                draw = ImageDraw.Draw(probe)
                width, height = text_size(draw, f"#{number}", choose_number_font(number))
                self.assertLessEqual(width, 30)
                self.assertLessEqual(height, 12)

    def test_guest_name_is_rendered_as_primary_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            event = validate_order_event(
                {"orderId": "order-39", "number": 39, "guestName": "Kevin", "status": "preparing"}
            )
            path = render_order(event, Path(tmp))
            with Image.open(path) as image:
                center_crop = image.crop((2, 16, 62, 48))
                bottom_crop = image.crop((2, 49, 62, 62))

                self.assertIsNotNone(center_crop.getbbox())
                self.assertIsNotNone(bottom_crop.getbbox())

    def test_long_guest_name_still_fits(self):
        with tempfile.TemporaryDirectory() as tmp:
            event = validate_order_event(
                {"orderId": "order-long", "number": 99, "guestName": "Jean Baptiste", "status": "ready"}
            )
            path = render_order(event, Path(tmp))
            with Image.open(path) as image:
                self.assertEqual(image.size, (64, 64))
                self.assertIsNotNone(image.crop((2, 16, 62, 48)).getbbox())

    def test_message_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = render_message("idle", Path(tmp), detail="STAND")
            with Image.open(path) as image:
                self.assertEqual(image.size, (64, 64))
                self.assertIsNotNone(image.getbbox())

    def test_virtual_display_splits_into_four_panels(self):
        display = VirtualDisplay64()
        panels = display.split_to_panels()

        self.assertEqual(set(panels), {"top_left", "top_right", "bottom_left", "bottom_right"})
        for image in panels.values():
            self.assertEqual(image.size, (32, 32))


if __name__ == "__main__":
    unittest.main()
