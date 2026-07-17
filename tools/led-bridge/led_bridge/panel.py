from __future__ import annotations

import threading
import time
from pathlib import Path

from PIL import Image

from .logging_utils import log


class PixelPanel:
    def __init__(
        self,
        address: str,
        *,
        brightness: int | None = None,
        reconnect_delay_seconds: float = 5,
        dry_run: bool = False,
    ):
        self.address = address
        self.brightness = brightness
        self.reconnect_delay_seconds = reconnect_delay_seconds
        self.dry_run = dry_run
        self._client = None
        self._lock = threading.Lock()

    @property
    def connected(self) -> bool:
        session = getattr(getattr(self._client, "_async_client", None), "_session", None)
        return bool(getattr(session, "is_connected", False))

    def connect(self) -> None:
        if self.dry_run:
            log(f"Mode test: connexion panneau simulee ({self.address})")
            return
        if self.connected:
            return

        from pypixelcolor import Client

        self.close()
        log(f"Connexion Bluetooth au panneau {self.address}...")
        self._client = Client(self.address)
        self._client.connect()
        if self.brightness is not None:
            self._client.set_brightness(self.brightness)
        info = self._client.get_device_info()
        log(f"Panneau connecte: {info.width}x{info.height}")

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
        self._client = None

    def send_image(self, image_path: Path) -> None:
        with self._lock:
            self._send_with_retry(image_path)

    def _send_with_retry(self, image_path: Path) -> None:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                self.connect()
                if self.dry_run:
                    log(f"Mode test: image prete pour le panneau: {image_path}")
                    return
                if image_path.suffix.lower() == ".gif":
                    self._send_gif_without_reencode(image_path)
                else:
                    self._client.send_image(str(image_path), resize_method="fit")
                log("Image envoyee")
                return
            except Exception as exc:
                last_error = exc
                self.close()
                if attempt == 0:
                    log(f"Erreur Bluetooth, reconnexion dans {self.reconnect_delay_seconds:.0f}s: {exc}")
                    time.sleep(self.reconnect_delay_seconds)

        raise RuntimeError(f"Impossible d'envoyer l'image au panneau: {last_error}")

    def _send_gif_without_reencode(self, gif_path: Path) -> None:
        with Image.open(gif_path) as image:
            if image.size != (32, 32):
                raise ValueError("Le GIF d'attente doit deja faire 32x32 pour eviter le reencodage.")

        from pypixelcolor.commands.send_image import send_image as build_send_image_plan
        from pypixelcolor.lib.transport.send_plan import send_plan

        async_client = self._client._async_client
        session = async_client._session
        if not session.is_connected or session._client is None or session._ack_mgr is None:
            raise RuntimeError("Session Bluetooth non connectee.")

        plan = build_send_image_plan(gif_path, device_info=None)
        self._client._run_async(send_plan(session._client, plan, session._ack_mgr))
