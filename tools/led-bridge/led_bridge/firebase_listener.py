from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path
from threading import Event
from urllib.parse import quote

import google.auth.transport.requests
import requests
from google.oauth2 import service_account

from .config import FirebaseConfig
from .logging_utils import log
from .models import OrderEvent, event_from_firebase

SCOPES = (
    "https://www.googleapis.com/auth/firebase.database",
    "https://www.googleapis.com/auth/userinfo.email",
)


class FirebaseOrdersWatcher:
    def __init__(self, config: FirebaseConfig):
        self.config = config
        self._credentials = self._load_credentials(config.service_account_path)
        self._auth_request = google.auth.transport.requests.Request()
        self._http = requests.Session()
        self._orders: dict[str, dict] = {}

    def _load_credentials(self, path: Path):
        if not path.exists():
            raise FileNotFoundError(
                f"{path.name} absent. Telecharge le fichier service account Firebase et place-le dans tools/led-bridge."
            )
        return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)

    def _token(self) -> str:
        if not self._credentials.valid or self._credentials.expired:
            self._credentials.refresh(self._auth_request)
        return self._credentials.token

    def _url(self, path: str) -> str:
        clean_path = "/".join(quote(part, safe="") for part in path.strip("/").split("/") if part)
        return f"{self.config.database_url}/{clean_path}.json?auth={self._token()}"

    def fetch_all(self) -> dict[str, dict]:
        response = self._http.get(self._url(f"sessions/{self.config.session_id}/orders"), timeout=20)
        response.raise_for_status()
        data = response.json() or {}
        if not isinstance(data, dict):
            return {}
        return {str(order_id): value for order_id, value in data.items() if isinstance(value, dict)}

    def fetch_order(self, order_id: str) -> dict | None:
        response = self._http.get(
            self._url(f"sessions/{self.config.session_id}/orders/{order_id}"),
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else None

    def listen(self, on_event: Callable[[OrderEvent], None], stop_event: Event) -> None:
        while not stop_event.is_set():
            try:
                self._seed(on_event)
                self._stream(on_event, stop_event)
            except Exception as exc:
                log(f"Firebase indisponible, nouvel essai dans 5s: {exc}")
                stop_event.wait(5)

    def _seed(self, on_event: Callable[[OrderEvent], None]) -> None:
        self._orders = self.fetch_all()
        for order_id, data in self._orders.items():
            try:
                on_event(event_from_firebase(order_id, data, initial=True))
            except ValueError as exc:
                log(f"Commande ignoree au demarrage ({order_id}): {exc}")
        log("Firebase connecte")

    def _stream(self, on_event: Callable[[OrderEvent], None], stop_event: Event) -> None:
        url = self._url(f"sessions/{self.config.session_id}/orders")
        with self._http.get(
            url,
            headers={"Accept": "text/event-stream"},
            stream=True,
            timeout=(10, 70),
        ) as response:
            response.raise_for_status()
            event_name = ""
            data_lines: list[str] = []
            last_activity = time.monotonic()

            for raw_line in response.iter_lines(decode_unicode=True):
                if stop_event.is_set():
                    return
                if raw_line is None:
                    continue

                line = raw_line.strip()
                if not line:
                    if event_name and data_lines:
                        self._handle_stream_message(event_name, "\n".join(data_lines), on_event)
                    event_name = ""
                    data_lines = []
                    continue

                last_activity = time.monotonic()
                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())

                if time.monotonic() - last_activity > 65:
                    raise TimeoutError("Flux Firebase silencieux.")

    def _handle_stream_message(
        self,
        event_name: str,
        raw_data: str,
        on_event: Callable[[OrderEvent], None],
    ) -> None:
        if event_name not in {"put", "patch"}:
            return
        payload = json.loads(raw_data)
        path = str(payload.get("path", "/"))
        data = payload.get("data")
        self._apply_change(path, data, on_event)

    def _apply_change(
        self,
        path: str,
        data,
        on_event: Callable[[OrderEvent], None],
    ) -> None:
        parts = [part for part in path.strip("/").split("/") if part]

        if not parts:
            if isinstance(data, dict):
                self._orders = {str(key): value for key, value in data.items() if isinstance(value, dict)}
                for order_id, order in self._orders.items():
                    self._emit(order_id, order, on_event, initial=True)
            return

        order_id = parts[0]
        current = self._orders.get(order_id, {}).copy()

        if len(parts) == 1:
            if data is None:
                self._orders.pop(order_id, None)
                return
            if isinstance(data, dict):
                current.update(data)
        elif len(parts) == 2:
            current[parts[1]] = data
        else:
            nested = current
            for part in parts[1:-1]:
                next_value = nested.get(part)
                if not isinstance(next_value, dict):
                    next_value = {}
                    nested[part] = next_value
                nested = next_value
            nested[parts[-1]] = data

        self._orders[order_id] = current
        self._emit(order_id, current, on_event)

    def _emit(
        self,
        order_id: str,
        order: dict,
        on_event: Callable[[OrderEvent], None],
        *,
        initial: bool = False,
    ) -> None:
        try:
            on_event(event_from_firebase(order_id, order, initial=initial))
        except ValueError as exc:
            log(f"Commande ignoree ({order_id}): {exc}")
