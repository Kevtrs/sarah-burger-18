from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from led_bridge.led_wall import LedWallController


class FakePanel:
    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.sent: list[Path] = []

    def close(self) -> None:
        pass

    def send_image(self, image_path: Path) -> None:
        if self.fail:
            raise RuntimeError("panne simulee")
        self.sent.append(image_path)


class LedWallControllerTest(unittest.TestCase):
    def test_one_disconnected_panel_does_not_block_the_wall(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            source = output_dir / "source.png"
            Image.new("RGB", (64, 64), (255, 255, 255)).save(source)

            controller = LedWallController.__new__(LedWallController)
            controller.output_dir = output_dir / "wall-panels"
            controller.output_dir.mkdir(parents=True, exist_ok=True)
            controller.panels = {
                "top_left": FakePanel(),
                "top_right": FakePanel(fail=True),
                "bottom_left": FakePanel(),
                "bottom_right": FakePanel(),
            }

            controller.send_image(source)

            self.assertEqual(len(controller.panels["top_left"].sent), 1)
            self.assertEqual(len(controller.panels["bottom_left"].sent), 1)
            self.assertEqual(len(controller.panels["bottom_right"].sent), 1)
            self.assertEqual(len(controller.panels["top_right"].sent), 0)


if __name__ == "__main__":
    unittest.main()
