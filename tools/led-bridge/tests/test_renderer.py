from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from led_bridge.models import validate_order_event
from led_bridge.renderer import choose_number_font, render_message, render_order, text_size


class RendererTest(unittest.TestCase):
    def test_numbers_fit_32_by_32(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            for number in (1, 9, 18, 27, 99, 100, 999):
                event = validate_order_event(
                    {"orderId": f"order-{number}", "number": number, "guestName": "", "status": "ready"}
                )
                path = render_order(event, output_dir)
                with Image.open(path) as image:
                    self.assertEqual(image.size, (32, 32))
                    self.assertEqual(image.mode, "RGB")
                    self.assertIsNotNone(image.getbbox())

                probe = Image.new("RGB", (32, 32))
                draw = ImageDraw.Draw(probe)
                width, height = text_size(draw, str(number), choose_number_font(number))
                self.assertLessEqual(width, 30)
                self.assertLessEqual(height, 18)

    def test_message_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = render_message("idle", Path(tmp), detail="STAND")
            with Image.open(path) as image:
                self.assertEqual(image.size, (32, 32))
                self.assertIsNotNone(image.getbbox())


if __name__ == "__main__":
    unittest.main()
