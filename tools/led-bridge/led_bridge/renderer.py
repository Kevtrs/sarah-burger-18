from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .models import OrderEvent, STATUS_COLORS

WIDTH = 32
HEIGHT = 32
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)


def _safe_filename(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in value)
    return safe[:80] or "order"


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
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


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def choose_number_font(number: int) -> ImageFont.ImageFont:
    text = str(number)
    image = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(image)
    for size in range(21, 7, -1):
        font = _font(size, bold=True)
        width, height = text_size(draw, text, font)
        if width <= 30 and height <= 18:
            return font
    return _font(8, bold=True)


def _center(draw: ImageDraw.ImageDraw, text: str, y: int, font: ImageFont.ImageFont, fill: tuple[int, int, int]) -> None:
    width, _ = text_size(draw, text, font)
    draw.text(((WIDTH - width) // 2, y), text, font=font, fill=fill)


def render_order(event: OrderEvent, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(image)
    color = STATUS_COLORS[event.status]

    draw.rectangle((0, 0, 31, 31), outline=color)
    draw.rectangle((2, 2, 29, 29), outline=tuple(max(0, channel // 3) for channel in color))

    number_font = choose_number_font(event.number)
    label_font = _font(7, bold=True)
    _center(draw, str(event.number), 4, number_font, WHITE)
    _center(draw, event.led_label, 23, label_font, color)

    if event.status == "ready":
        draw.line([(4, 19), (8, 23), (14, 16)], fill=color, width=2)
        draw.line([(20, 16), (25, 22), (29, 13)], fill=color, width=2)
    elif event.status == "preparing":
        draw.polygon([(5, 25), (7, 19), (9, 25)], fill=(255, 118, 20))
        draw.polygon([(23, 25), (25, 19), (27, 25)], fill=(255, 118, 20))

    path = output_dir / f"order-{_safe_filename(event.order_id)}-{event.status}.png"
    image.save(path)
    return path


def render_message(kind: str, output_dir: Path, *, detail: str = "") -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    color_by_kind = {
        "startup": (255, 176, 42),
        "connected": (80, 235, 96),
        "idle": (70, 170, 255),
        "bluetooth_error": (235, 62, 62),
        "firebase_error": (235, 62, 62),
    }
    title_by_kind = {
        "startup": "SB",
        "connected": "OK",
        "idle": "WAIT",
        "bluetooth_error": "BT",
        "firebase_error": "FB",
    }

    image = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(image)
    color = color_by_kind.get(kind, WHITE)
    draw.rectangle((0, 0, 31, 31), outline=color)
    _center(draw, title_by_kind.get(kind, "LED"), 5, _font(13, bold=True), WHITE)
    _center(draw, (detail or kind).upper()[:6], 22, _font(7, bold=True), color)

    path = output_dir / f"{kind}.png"
    image.save(path)
    return path
