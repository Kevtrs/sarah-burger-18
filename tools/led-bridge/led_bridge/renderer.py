from __future__ import annotations

import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .models import OrderEvent, STATUS_COLORS
from .virtual_display import BLACK, HEIGHT, WHITE, WIDTH, VirtualDisplay64, font


def _safe_filename(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in value)
    return safe[:80] or "order"


def text_size(draw: ImageDraw.ImageDraw, text: str, selected_font: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=selected_font)
    return box[2] - box[0], box[3] - box[1]


def choose_number_font(number: int) -> ImageFont.ImageFont:
    text = f"#{number}"
    image = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(image)
    for size in range(12, 7, -1):
        selected_font = font(size, bold=True)
        width, height = text_size(draw, text, selected_font)
        if width <= 30 and height <= 12:
            return selected_font
    return font(8, bold=True)


def _draw_centered(
    display: VirtualDisplay64,
    text: str,
    y: int,
    selected_font: ImageFont.ImageFont,
    fill: tuple[int, int, int],
) -> None:
    display.draw.text((WIDTH // 2, y), text, font=selected_font, fill=fill, anchor="ma")


def _clean_display_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = "".join(char for char in ascii_name.upper() if char.isalnum() or char in " -_")
    cleaned = " ".join(cleaned.replace("_", " ").split())
    return cleaned or "COMMANDE"


def _fits(text: str, size: int, *, max_width: int, max_height: int) -> bool:
    image = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(image)
    width, height = text_size(draw, text, font(size, bold=True))
    return width <= max_width and height <= max_height


def _fit_font(text: str, *, max_size: int, min_size: int, max_width: int, max_height: int) -> ImageFont.ImageFont:
    for size in range(max_size, min_size - 1, -1):
        if _fits(text, size, max_width=max_width, max_height=max_height):
            return font(size, bold=True)
    return font(min_size, bold=True)


def _name_lines(value: str) -> list[str]:
    cleaned = _clean_display_name(value)
    if _fits(cleaned, 24, max_width=60, max_height=27):
        return [cleaned]

    words = cleaned.replace("-", " ").split()
    if len(words) >= 2:
        return [" ".join(words[:-1])[:12], words[-1][:12]]
    return [cleaned[:12]]


def _draw_guest_name(display: VirtualDisplay64, guest_name: str) -> None:
    lines = _name_lines(guest_name)
    if len(lines) == 1:
        name_font = _fit_font(lines[0], max_size=24, min_size=10, max_width=60, max_height=27)
        display.draw.text((WIDTH // 2, 32), lines[0], font=name_font, fill=WHITE, anchor="mm")
        return

    line_font = _fit_font(max(lines, key=len), max_size=15, min_size=9, max_width=60, max_height=14)
    display.draw.text((WIDTH // 2, 25), lines[0], font=line_font, fill=WHITE, anchor="mm")
    display.draw.text((WIDTH // 2, 39), lines[1], font=line_font, fill=WHITE, anchor="mm")


def render_order(event: OrderEvent, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    display = VirtualDisplay64()
    color = STATUS_COLORS[event.status]
    dim = tuple(max(0, channel // 3) for channel in color)

    display.draw.rectangle((0, 0, 63, 63), outline=color, width=2)
    display.draw.rectangle((2, 2, 61, 14), fill=dim, outline=color)
    _draw_centered(display, event.led_label, 3, _fit_font(event.led_label, max_size=11, min_size=8, max_width=56, max_height=10), color)

    _draw_guest_name(display, event.guest_name)

    number_text = f"#{event.number}"
    number_font = choose_number_font(event.number)
    _draw_centered(display, number_text, 50, number_font, (210, 210, 210))

    path = output_dir / f"order-{_safe_filename(event.order_id)}-{event.status}.png"
    display.save(path)
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

    display = VirtualDisplay64()
    color = color_by_kind.get(kind, WHITE)
    display.draw.rectangle((0, 0, 63, 63), outline=color, width=2)
    display.draw.text((WIDTH // 2, 9), title_by_kind.get(kind, "LED"), font=font(20, bold=True), fill=WHITE, anchor="ma")
    display.draw.text((WIDTH // 2, 40), (detail or kind).upper()[:8], font=font(12, bold=True), fill=color, anchor="ma")

    path = output_dir / f"{kind}.png"
    display.save(path)
    return path
