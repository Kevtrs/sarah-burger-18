from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
WIDTH = 64
HEIGHT = 64
PANEL_SIZE = 32

PANEL_BOXES = {
    "top_left": (0, 0, 32, 32),
    "top_right": (32, 0, 64, 32),
    "bottom_left": (0, 32, 32, 64),
    "bottom_right": (32, 32, 64, 64),
}


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "arialbd.ttf" if bold else "arial.ttf",
        "segoeuib.ttf" if bold else "segoeui.ttf",
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
    ]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


class VirtualDisplay64:
    def __init__(self, background: tuple[int, int, int] = BLACK):
        self.image = Image.new("RGB", (WIDTH, HEIGHT), background)
        self.draw = ImageDraw.Draw(self.image)

    def clear(self, color: tuple[int, int, int] = BLACK) -> None:
        self.draw.rectangle((0, 0, WIDTH - 1, HEIGHT - 1), fill=color)

    def draw_text(
        self,
        text: str,
        *,
        x: int = WIDTH // 2,
        y: int = 0,
        size: int = 12,
        fill: tuple[int, int, int] = WHITE,
        bold: bool = True,
        anchor: str = "ma",
    ) -> None:
        self.draw.text((x, y), text, font=font(size, bold=bold), fill=fill, anchor=anchor)

    def draw_icon(self, name: str, *, x: int, y: int, fill: tuple[int, int, int] = WHITE) -> None:
        if name == "ready":
            self.draw.line([(x, y + 7), (x + 5, y + 12), (x + 15, y)], fill=fill, width=3)
        elif name == "preparing":
            self.draw.polygon([(x + 3, y + 16), (x + 7, y + 4), (x + 12, y + 16)], fill=fill)
            self.draw.polygon([(x + 15, y + 16), (x + 19, y + 4), (x + 24, y + 16)], fill=fill)
        elif name == "cancelled":
            self.draw.line([(x, y), (x + 13, y + 13)], fill=fill, width=3)
            self.draw.line([(x + 13, y), (x, y + 13)], fill=fill, width=3)
        elif name == "served":
            self.draw.rectangle((x, y + 5, x + 15, y + 13), outline=fill, width=2)
            self.draw.line([(x + 4, y + 3), (x + 11, y + 3)], fill=fill, width=2)
        else:
            self.draw.ellipse((x, y, x + 12, y + 12), outline=fill, width=2)

    def render(self) -> Image.Image:
        return self.image.copy()

    def save(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.image.save(path)
        return path

    def split_to_panels(self) -> dict[str, Image.Image]:
        return {name: self.image.crop(box) for name, box in PANEL_BOXES.items()}
