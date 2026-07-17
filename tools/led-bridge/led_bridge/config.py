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
    bluetooth_address: str
    ready_display_seconds: float
    status_display_seconds: float
    reconnect_delay_seconds: float
    brightness: int | None
    idle_gif_path: Path | None


@dataclass(frozen=True)
class BridgeConfig:
    firebase: FirebaseConfig
    panel: PanelConfig
    generated_dir: Path
    queue_existing_ready_on_start: bool


def _required_text(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Configuration manquante: {key}")
    return value.strip()


def load_config(path: Path) -> BridgeConfig:
    if not path.exists():
        raise FileNotFoundError(
            f"{path.name} est absent. Copie config.example.json en config.json puis remplis les champs."
        )

    raw = json.loads(path.read_text(encoding="utf-8"))
    root = path.resolve().parent
    firebase = raw.get("firebase") or {}
    panel = raw.get("panel") or {}
    behavior = raw.get("behavior") or {}

    database_url = _required_text(firebase, "database_url").rstrip("/")
    session_id = firebase.get("session_id", "sarah-18-2026")
    service_account = root / firebase.get("service_account_path", "service-account.json")

    bluetooth_address = _required_text(panel, "bluetooth_address")
    idle_gif_value = panel.get("idle_gif_path", "")
    idle_gif = (root / idle_gif_value) if isinstance(idle_gif_value, str) and idle_gif_value.strip() else None
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
            ready_display_seconds=float(panel.get("ready_display_seconds", 20)),
            status_display_seconds=float(panel.get("status_display_seconds", 5)),
            reconnect_delay_seconds=float(panel.get("reconnect_delay_seconds", 5)),
            brightness=brightness,
            idle_gif_path=idle_gif,
        ),
        generated_dir=generated_dir,
        queue_existing_ready_on_start=bool(behavior.get("queue_existing_ready_on_start", False)),
    )
