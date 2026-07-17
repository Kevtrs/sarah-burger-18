from __future__ import annotations

import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .models import OrderEvent, STATUS_COLORS
from .virtual_display import BLACK, HEIGHT, WHITE, WIDTH, VirtualDisplay64, font

ACTIVE_STATUSES = {"received", "preparing", "ready"}
ACTIVE_SORT = {"ready": 0, "preparing": 1, "received": 2}
RUSH_THRESHOLD = 5


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


def _status_dim(color: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(max(0, channel // 3) for channel in color)


def _draw_status_strip(display: VirtualDisplay64, label: str, color: tuple[int, int, int]) -> None:
    display.draw.rectangle((2, 2, 61, 14), fill=_status_dim(color), outline=color)
    _draw_centered(
        display,
        label,
        3,
        _fit_font(label, max_size=11, min_size=8, max_width=56, max_height=10),
        WHITE,
    )


def render_order(event: OrderEvent, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    display = VirtualDisplay64()
    color = STATUS_COLORS[event.status]

    display.draw.rectangle((0, 0, 63, 63), outline=color, width=2)
    _draw_status_strip(display, event.led_label, color)
    _draw_guest_name(display, event.guest_name)

    number_text = f"#{event.number}"
    number_font = choose_number_font(event.number)
    _draw_centered(display, number_text, 50, number_font, (210, 210, 210))

    path = output_dir / f"order-{_safe_filename(event.order_id)}-{event.status}.png"
    display.save(path)
    return path


def _short_name(value: str, max_chars: int = 7) -> str:
    cleaned = _clean_display_name(value)
    if len(cleaned) <= max_chars:
        return cleaned
    compact = cleaned.replace(" ", "")
    return compact[:max_chars] if compact else cleaned[:max_chars]


def _draw_order_slot(display: VirtualDisplay64, event: OrderEvent, box: tuple[int, int, int, int]) -> None:
    x1, y1, x2, y2 = box
    color = STATUS_COLORS[event.status]
    display.draw.rectangle((x1, y1, x2 - 1, y2 - 1), outline=color)
    display.draw.rectangle((x1 + 1, y1 + 1, x2 - 2, y1 + 7), fill=_status_dim(color))

    status_font = _fit_font(event.led_label, max_size=6, min_size=5, max_width=28, max_height=6)
    display.draw.text(((x1 + x2) // 2, y1 + 1), event.led_label, font=status_font, fill=WHITE, anchor="ma")

    name = _short_name(event.guest_name)
    name_font = _fit_font(name, max_size=11, min_size=6, max_width=29, max_height=12)
    display.draw.text(((x1 + x2) // 2, y1 + 18), name, font=name_font, fill=WHITE, anchor="mm")

    number_text = f"#{event.number}"
    number_font = _fit_font(number_text, max_size=7, min_size=5, max_width=22, max_height=7)
    display.draw.text(((x1 + x2) // 2, y2 - 8), number_text, font=number_font, fill=(210, 210, 210), anchor="ma")


def _active_sort_key(event: OrderEvent) -> tuple[int, int]:
    return (ACTIVE_SORT.get(event.status, 9), event.number)


def render_order_grid(events: list[OrderEvent], output_dir: Path, *, page: int = 0) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    active_events = sorted([event for event in events if event.status in ACTIVE_STATUSES], key=_active_sort_key)
    display = VirtualDisplay64()

    slots = [
        (0, 0, 32, 32),
        (32, 0, 64, 32),
        (0, 32, 32, 64),
        (32, 32, 64, 64),
    ]

    if not active_events:
        return render_message("idle", output_dir, detail="SARAH")

    start = (page * 4) % len(active_events)
    page_events = active_events[start : start + 4]
    if len(page_events) < min(4, len(active_events)):
        page_events.extend(active_events[: min(4, len(active_events)) - len(page_events)])

    for slot, event in zip(slots, page_events):
        _draw_order_slot(display, event, slot)

    if len(active_events) > 4:
        page_count = (len(active_events) + 3) // 4
        label = f"{(page % page_count) + 1}/{page_count}"
        display.draw.rectangle((47, 55, 63, 63), fill=(0, 0, 0))
        display.draw.text((55, 55), label, font=font(6, bold=True), fill=(255, 176, 42), anchor="ma")

    path = output_dir / f"active-orders-page-{page + 1}.png"
    display.save(path)
    return path


def _count_status(events: list[OrderEvent], status: str) -> int:
    return sum(1 for event in events if event.status == status)


def render_rush_summary(events: list[OrderEvent], output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    active_events = [event for event in events if event.status in ACTIVE_STATUSES]
    ready_count = _count_status(active_events, "ready")
    preparing_count = _count_status(active_events, "preparing")
    received_count = _count_status(active_events, "received")

    display = VirtualDisplay64()
    pink = (232, 20, 82)
    orange = STATUS_COLORS["preparing"]
    green = STATUS_COLORS["ready"]
    yellow = STATUS_COLORS["received"]

    display.draw.rectangle((0, 0, 63, 63), outline=pink, width=2)
    display.draw.text((WIDTH // 2, 3), "RUSH", font=font(14, bold=True), fill=WHITE, anchor="ma")
    display.draw.line((5, 20, 58, 20), fill=pink)

    rows = [
        ("PRET", ready_count, green, 25),
        ("PREPA", preparing_count, orange, 38),
        ("RECU", received_count, yellow, 51),
    ]
    for label, count, color, y in rows:
        display.draw.text((5, y), label, font=font(8, bold=True), fill=color, anchor="la")
        display.draw.text((58, y - 1), str(count), font=font(11, bold=True), fill=WHITE, anchor="ra")

    path = output_dir / "rush-summary.png"
    display.save(path)
    return path


def _draw_idle_screen(display: VirtualDisplay64) -> None:
    pink = (232, 20, 82)
    cream = (255, 238, 190)
    dim = (80, 36, 50)

    display.clear(BLACK)
    display.draw.rectangle((0, 0, 63, 63), outline=pink, width=2)
    display.draw.rectangle((3, 3, 60, 60), outline=dim)
    display.draw.text((WIDTH // 2, 13), "SARAH", font=font(15, bold=True), fill=cream, anchor="ma")
    display.draw.text((WIDTH // 2, 31), "BURGER", font=font(11, bold=True), fill=pink, anchor="ma")
    display.draw.text((WIDTH // 2, 49), "ATTENTE", font=font(7, bold=True), fill=(170, 170, 170), anchor="ma")


def render_message(kind: str, output_dir: Path, *, detail: str = "") -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    if kind == "idle":
        display = VirtualDisplay64()
        _draw_idle_screen(display)
        path = output_dir / "idle.png"
        display.save(path)
        return path

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
