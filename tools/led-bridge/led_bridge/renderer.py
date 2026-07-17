from __future__ import annotations

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
    for size in range(31, 11, -1):
        selected_font = font(size, bold=True)
        width, height = text_size(draw, text, selected_font)
        if width <= 62 and height <= 29:
            return selected_font
    return font(12, bold=True)


def _draw_centered(
    display: VirtualDisplay64,
    text: str,
    y: int,
    selected_font: ImageFont.ImageFont,
    fill: tuple[int, int, int],
) -> None:
    display.draw.text((WIDTH // 2, y), text, font=selected_font, fill=fill, anchor="ma")


def render_order(event: OrderEvent, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    display = VirtualDisplay64()
    color = STATUS_COLORS[event.status]
    dim = tuple(max(0, channel // 3) for channel in color)

    display.draw.rectangle((0, 0, 63, 63), outline=color, width=2)
    display.draw.line((4, 35, 60, 35), fill=dim, width=1)

    number_font = choose_number_font(event.number)
    label_font = font(15 if event.status == "ready" else 13, bold=True)

    _draw_centered(display, f"#{event.number}", 5, number_font, WHITE)
    if event.status == "ready":
        display.draw_icon("ready", x=5, y=42, fill=color)
        _draw_centered(display, "PRET", 40, label_font, color)
    elif event.status == "preparing":
        display.draw_icon("preparing", x=3, y=40, fill=color)
        _draw_centered(display, event.led_label, 41, label_font, color)
    elif event.status == "cancelled":
        display.draw_icon("cancelled", x=6, y=43, fill=color)
        _draw_centered(display, event.led_label, 41, font(11, bold=True), color)
    elif event.status == "served":
        display.draw_icon("served", x=6, y=42, fill=color)
        _draw_centered(display, event.led_label, 41, font(12, bold=True), color)
    else:
        display.draw_icon("received", x=7, y=43, fill=color)
        _draw_centered(display, event.led_label, 41, label_font, color)

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
