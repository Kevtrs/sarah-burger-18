from __future__ import annotations

import json
import queue
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
OUTPUT_PATH = ROOT / "current-display.png"

STATUS_LABELS = {
    "received": "RECU",
    "preparing": "CUIT",
    "ready": "PRET",
    "served": "SERVI",
    "cancelled": "ANNULE",
}

STATUS_COLORS = {
    "received": (255, 175, 40),
    "preparing": (255, 70, 25),
    "ready": (80, 235, 90),
    "served": (70, 165, 255),
    "cancelled": (235, 55, 55),
}

jobs: queue.Queue[dict] = queue.Queue()
last_state = {"connected": False, "message": "En attente", "number": None, "status": None}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            "config.json absent. Copie config.example.json en config.json puis vérifie l'adresse Bluetooth."
        )
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not config.get("bluetooth_address"):
        raise ValueError("bluetooth_address manque dans config.json")
    return config


def find_cli() -> str:
    direct = shutil.which("pypixelcolor") or shutil.which("pypixelcolor.exe")
    if direct:
        return direct

    scripts = Path(sys.executable).resolve().parent / "Scripts" / "pypixelcolor.exe"
    if scripts.exists():
        return str(scripts)

    raise FileNotFoundError("pypixelcolor.exe introuvable. Lance INSTALLER.bat.")


def font(size: int, bold: bool = False):
    names = ["arialbd.ttf" if bold else "arial.ttf", "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, selected_font, fill):
    box = draw.textbbox((0, 0), text, font=selected_font)
    width = box[2] - box[0]
    draw.text(((32 - width) // 2, y), text, font=selected_font, fill=fill)


def make_screen(number: int, status: str) -> Path:
    image = Image.new("RGB", (32, 32), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = STATUS_COLORS.get(status, (255, 255, 255))
    label = STATUS_LABELS.get(status, status.upper()[:6])

    draw.rectangle((0, 0, 31, 31), outline=color)
    draw.rectangle((2, 2, 29, 29), outline=tuple(max(0, value // 3) for value in color))

    number_text = str(number)
    number_font = font(18 if len(number_text) <= 2 else 14, bold=True)
    label_font = font(7, bold=True)

    centered(draw, number_text, 4, number_font, (255, 255, 255))
    centered(draw, label, 23, label_font, color)

    if status == "preparing":
        draw.polygon([(4, 25), (6, 19), (8, 25)], fill=(255, 100, 25))
        draw.polygon([(24, 25), (26, 19), (28, 25)], fill=(255, 100, 25))
    elif status == "ready":
        draw.line([(4, 18), (7, 21), (12, 15)], fill=color, width=2)
        draw.line([(20, 15), (25, 21), (29, 12)], fill=color, width=2)

    image.save(OUTPUT_PATH)
    return OUTPUT_PATH


def send_to_panel(payload: dict):
    config = load_config()
    address = config["bluetooth_address"]
    status = str(payload.get("status", "received"))
    number = int(payload["number"])
    image_path = make_screen(number, status)
    cli = find_cli()

    command = [cli, "-a", address, "-c", "send_image", str(image_path)]
    last_state.update(message=f"Envoi #{number} {status}...", number=number, status=status)
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)

    if result.returncode != 0:
        error = result.stderr.strip() or result.stdout.strip() or "Erreur inconnue"
        last_state.update(connected=False, message=error[-300:])
        print(f"[ERREUR] {error}")
        return

    last_state.update(connected=True, message=f"Affiché : #{number} {STATUS_LABELS.get(status, status)}")
    print(f"[OK] Commande #{number} -> {status}")


def worker():
    while True:
        payload = jobs.get()
        try:
            # On vide les changements plus anciens pour afficher le dernier état demandé.
            while True:
                payload = jobs.get_nowait()
                jobs.task_done()
        except queue.Empty:
            pass

        try:
            send_to_panel(payload)
        except Exception as exc:  # le serveur doit rester vivant même si le Bluetooth décroche
            last_state.update(connected=False, message=str(exc))
            print(f"[ERREUR] {exc}")
        finally:
            jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, status: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"ok": True, **last_state})
        else:
            self.reply(404, {"ok": False, "error": "Route inconnue"})

    def do_POST(self):
        if self.path != "/display":
            self.reply(404, {"ok": False, "error": "Route inconnue"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            number = int(payload.get("number", 0))
            status = str(payload.get("status", "received"))
            if number <= 0 or status not in STATUS_LABELS:
                raise ValueError("Numéro ou statut invalide")
            jobs.put({"number": number, "status": status, "guestName": payload.get("guestName", "")})
            self.reply(202, {"ok": True, "queued": True})
        except Exception as exc:
            self.reply(400, {"ok": False, "error": str(exc)})

    def log_message(self, format, *args):
        return


def main():
    config = load_config()
    host = config.get("host", "127.0.0.1")
    port = int(config.get("port", 8765))
    threading.Thread(target=worker, daemon=True).start()
    print("=" * 52)
    print(" SARAH BURGER - PONT PANNEAU LED")
    print("=" * 52)
    print(f"Panneau : {config['bluetooth_address']}")
    print(f"Serveur : http://{host}:{port}")
    print("Laisse cette fenêtre ouverte pendant le stand.")
    print("Ctrl+C pour arrêter.\n")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
