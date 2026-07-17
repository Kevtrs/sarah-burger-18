from __future__ import annotations

from pathlib import Path

from PIL import Image

from .logging_utils import log
from .panel import PixelPanel
from .virtual_display import PANEL_BOXES

PANEL_LABELS = {
    "top_left": "haut gauche",
    "top_right": "haut droite",
    "bottom_left": "bas gauche",
    "bottom_right": "bas droite",
}


class LedWallController:
    def __init__(
        self,
        panel_addresses: dict[str, str],
        output_dir: Path,
        *,
        brightness: int | None = None,
        reconnect_delay_seconds: float = 5,
        dry_run: bool = False,
    ):
        missing = [name for name in PANEL_BOXES if name not in panel_addresses]
        if missing:
            raise ValueError(f"Adresses manquantes pour le mur LED: {', '.join(missing)}")

        self.output_dir = output_dir / "wall-panels"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.panels = {
            name: PixelPanel(
                address,
                brightness=brightness,
                reconnect_delay_seconds=reconnect_delay_seconds,
                dry_run=dry_run,
                label=PANEL_LABELS[name],
            )
            for name, address in panel_addresses.items()
        }

    def close(self) -> None:
        for panel in self.panels.values():
            panel.close()

    def send_image(self, image_path: Path) -> None:
        with Image.open(image_path) as image:
            image = image.convert("RGB")
            if image.size != (64, 64):
                raise ValueError(f"Le mur LED attend une image 64x64, recu {image.size[0]}x{image.size[1]}.")

            for name, box in PANEL_BOXES.items():
                crop_path = self.output_dir / f"{name}.png"
                image.crop(box).save(crop_path)
                log(f"Envoi panneau {PANEL_LABELS[name]}")
                self.panels[name].send_image(crop_path)
