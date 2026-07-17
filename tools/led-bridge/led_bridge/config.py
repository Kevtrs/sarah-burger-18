from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class FirebaseConfig:
    database_url: str
    service_account_path: Path
    session_id: str


@dataclass(frozen=True)
class PanelConfig:
    bluetooth_address: str | None
    wall_panels: dict[str, str]
    ready_display_seconds: float
    status_display_seconds: float
    terminal_display_seconds: float
    last_call_seconds: float
    rotation_seconds: float
    reconnect_delay_seconds: float
    brightness: int | None


@dataclass(frozen=True)
class BridgeConfig:
    firebase: FirebaseConfig
    panel: PanelConfig
    generated_dir: Path
    queue_existing_ready_on_start: bool
    stand_open: bool
    high_contrast: bool
    stuck_order_minutes: float
    stuck_repeat_minutes: float


def _required_text(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Configuration manquante: {key}")
    return value.strip()


def _optional_text(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _bool_value(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "oui", "on"}:
            return True
        if normalized in {"false", "0", "no", "non", "off"}:
            return False
    return bool(value)


def _load_wall_panels(raw: dict[str, Any]) -> dict[str, str]:
    wall = raw.get("wall") or {}
    panels = wall.get("panels") or {}
    if not isinstance(panels, dict) or not panels:
        return {}

    required = ("top_left", "top_right", "bottom_left", "bottom_right")
    cleaned: dict[str, str] = {}
    for key in required:
        value = panels.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Adresse manquante pour wall.panels.{key}")
        cleaned[key] = value.strip()
    return cleaned


def load_config(path: Path) -> BridgeConfig:
    if not path.exists():
        raise FileNotFoundError(
            f"{path.name} est absent. Copie config.example.json en config.json puis remplis les champs."
        )

    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    root = path.resolve().parent
    firebase = raw.get("firebase") or {}
    panel = raw.get("panel") or {}
    behavior = raw.get("behavior") or {}
    wall_panels = _load_wall_panels(raw)

    database_url = _required_text(firebase, "database_url").rstrip("/")
    session_id = firebase.get("session_id", "sarah-18-2026")
    service_account = root / firebase.get("service_account_path", "service-account.json")

    bluetooth_address = _optional_text(panel, "bluetooth_address")
    if not wall_panels and not bluetooth_address:
        raise ValueError("Configuration manquante: panel.bluetooth_address ou wall.panels")

    brightness = panel.get("brightness")
    if brightness is not None:
        brightness = int(brightness)
        if brightness < 1 or brightness > 100:
            raise ValueError("brightness doit etre entre 1 et 100.")

    generated_dir = root / raw.get("generated_dir", "generated")
    generated_dir.mkdir(parents=True, exist_ok=True)

    return BridgeConfig(
        firebase=FirebaseConfig(
            database_url=database_url,
            service_account_path=service_account,
            session_id=str(session_id),
        ),
        panel=PanelConfig(
            bluetooth_address=bluetooth_address,
            wall_panels=wall_panels,
            ready_display_seconds=float(panel.get("ready_display_seconds", 20)),
            status_display_seconds=float(panel.get("status_display_seconds", 3)),
            terminal_display_seconds=float(panel.get("terminal_display_seconds", 1)),
            last_call_seconds=float(panel.get("last_call_seconds", 180)),
            rotation_seconds=float(panel.get("rotation_seconds", 3)),
            reconnect_delay_seconds=float(panel.get("reconnect_delay_seconds", 5)),
            brightness=brightness,
        ),
        generated_dir=generated_dir,
        queue_existing_ready_on_start=bool(behavior.get("queue_existing_ready_on_start", False)),
        stand_open=_bool_value(raw.get("stand_open", behavior.get("stand_open")), True),
        high_contrast=_bool_value(raw.get("high_contrast", behavior.get("high_contrast")), False),
        stuck_order_minutes=float(behavior.get("stuck_order_minutes", raw.get("stuck_order_minutes", 15))),
        stuck_repeat_minutes=float(behavior.get("stuck_repeat_minutes", raw.get("stuck_repeat_minutes", 5))),
    )
