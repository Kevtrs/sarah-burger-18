from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .models import OrderEvent


def append_order_event(path: Path | None, event: OrderEvent) -> None:
    if path is None:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat(timespec="seconds")
    mode = "initial" if event.initial else "change"
    guest_name = event.guest_name.replace("\t", " ").replace("\n", " ").strip()
    line = f"{timestamp}\t{mode}\t#{event.number}\t{event.status}\t{guest_name}\t{event.order_id}\n"
    with path.open("a", encoding="utf-8") as file:
        file.write(line)
