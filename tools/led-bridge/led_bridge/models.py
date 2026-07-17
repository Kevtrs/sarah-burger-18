from __future__ import annotations

from dataclasses import dataclass
from typing import Any


ALLOWED_STATUSES = ("received", "preparing", "ready", "served", "cancelled")

STATUS_LABELS = {
    "received": "RECU",
    "preparing": "PREPA",
    "ready": "PRET",
    "served": "SERVI",
    "cancelled": "ANNULE",
}

STATUS_LOG_LABELS = {
    "received": "RECUE",
    "preparing": "EN PREPA",
    "ready": "PRETE",
    "served": "SERVIE",
    "cancelled": "ANNULEE",
}

STATUS_COLORS = {
    "received": (255, 176, 42),
    "preparing": (255, 92, 28),
    "ready": (80, 235, 96),
    "served": (70, 170, 255),
    "cancelled": (235, 62, 62),
}


@dataclass(frozen=True)
class OrderEvent:
    order_id: str
    number: int
    guest_name: str
    status: str
    initial: bool = False

    @property
    def led_label(self) -> str:
        return STATUS_LABELS[self.status]

    @property
    def log_label(self) -> str:
        return STATUS_LOG_LABELS[self.status]


def _clean_text(value: Any, max_length: int, label: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{label} doit etre une chaine.")
    cleaned = " ".join(value.strip().split())
    if len(cleaned) > max_length:
        raise ValueError(f"{label} est trop long.")
    return cleaned


def validate_order_event(payload: dict[str, Any], *, initial: bool = False) -> OrderEvent:
    if not isinstance(payload, dict):
        raise ValueError("Evenement invalide.")

    order_id = _clean_text(payload.get("orderId") or payload.get("id") or "", 80, "orderId")
    if not order_id:
        raise ValueError("orderId est obligatoire.")

    try:
        number = int(payload.get("number"))
    except (TypeError, ValueError) as exc:
        raise ValueError("number doit etre un entier positif.") from exc
    if number <= 0 or number > 9999:
        raise ValueError("number doit etre un entier positif.")

    guest_name = _clean_text(payload.get("guestName") or "", 32, "guestName")
    status = _clean_text(payload.get("status") or "", 16, "status")
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"status invalide: {status}")

    return OrderEvent(
        order_id=order_id,
        number=number,
        guest_name=guest_name,
        status=status,
        initial=initial,
    )


def event_from_firebase(order_id: str, data: dict[str, Any], *, initial: bool = False) -> OrderEvent:
    payload = {
        "orderId": order_id,
        "number": data.get("number"),
        "guestName": data.get("guestName", ""),
        "status": data.get("status", "received"),
    }
    return validate_order_event(payload, initial=initial)
