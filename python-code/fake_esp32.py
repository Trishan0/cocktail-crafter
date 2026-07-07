#!/usr/bin/env python3
"""
fake_esp32.py — Virtual ESP32 Serial Harness
Cocktail-Craft Bartender | Development Tool

Simulates the ESP32 firmware over a serial port so the Flask app's
SerialController can be exercised against real serial I/O without
physical hardware.

Usage
-----
# Linux / Raspberry Pi (socat virtual pair):
#   Terminal 1 — create the pair:
#     socat -d -d pty,raw,echo=0 pty,raw,echo=0
#   Note the two /dev/pts/N paths it prints, e.g. /dev/pts/2 and /dev/pts/3
#   Terminal 2 — start fake ESP32 on one end:
#     python fake_esp32.py --port /dev/pts/3
#   In config.py set SERIAL_PORT = "/dev/pts/2", SIMULATOR_MODE = False, then run app.

# Windows (TCP loopback via pyserial socket:// URL):
#   Terminal 1 — start fake ESP32 as a TCP server:
#     python fake_esp32.py --tcp --tcp-port 9999
#   In config.py set SERIAL_PORT = "socket://localhost:9999", SIMULATOR_MODE = False, then run app.
#   (pyserial supports "socket://host:port" as a port string natively)

# Chaos mode — injects malformed JSON lines, artificial delays, and disconnects:
#     python fake_esp32.py --port /dev/pts/3 --chaos

Protocol implemented (per PROTOCOL.md)
---------------------------------------
  Receives:  ORDER, ABORT, CLEAN (post_order | manual)
  Sends:     STATUS, SENSOR
"""

import argparse
import json
import random
import socket
import sys
import threading
import time
from datetime import datetime

# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] [FAKE-ESP32] {msg}", flush=True)


def encode(payload: dict) -> bytes:
    return (json.dumps(payload) + "\n").encode("utf-8")


# ─────────────────────────────────────────────
#  ESP32 State Machine
# ─────────────────────────────────────────────

class FakeESP32:
    """
    Replicates the ESP32 state machine described in PROTOCOL.md.
    Runs the full ORDER + post-order auto-clean cycle, and handles
    ABORT and CLEAN (manual) commands.
    """

    def __init__(self, send_fn, chaos: bool = False):
        """
        send_fn: callable(bytes) — write raw bytes to the serial port
        chaos:   if True, randomly inject protocol errors
        """
        self._send     = send_fn
        self._chaos    = chaos
        self._lock     = threading.Lock()
        self._abort    = threading.Event()
        self._sequence = None   # currently running sequence thread

    # ── Command dispatch ──────────────────────

    def on_command(self, data: dict):
        cmd = data.get("cmd", "").upper()
        log(f"← Received: {json.dumps(data)}")

        if cmd == "ORDER":
            self._start_sequence(self._run_order, data)
        elif cmd == "ABORT":
            self._do_abort()
        elif cmd == "CLEAN":
            trigger = data.get("trigger", "manual")
            if trigger == "post_order":
                self._start_sequence(self._run_post_order_clean, data)
            else:
                self._start_sequence(self._run_manual_clean, data)
        else:
            log(f"Unknown command: {cmd!r}")

    def _start_sequence(self, fn, data):
        with self._lock:
            self._abort.clear()
        t = threading.Thread(target=fn, args=(data,), daemon=True)
        with self._lock:
            self._sequence = t
        t.start()

    # ── ABORT ─────────────────────────────────

    def _do_abort(self):
        log("ABORT received — halting all sequences.")
        self._abort.set()
        self._status(None, "aborted", 0, "Emergency stop.")
        self._sleep(1.5)
        self._status(None, "idle", 0, "Ready")

    # ── ORDER sequence ────────────────────────

    def _run_order(self, data: dict):
        order_id    = data.get("order_id")
        recipe_name = data.get("recipe_name", "Unknown")
        ice         = data.get("ice", False)

        log(f"Starting ORDER #{order_id} — {recipe_name} | ice={ice}")

        self._status(order_id, "waiting_glass", 0, "Waiting for glass...")
        if self._sleep(2): return

        # Glass placed
        import random
        glass_type = random.choice(["small_glass", "large_glass"])
        self._sensor(glass_state=glass_type)
        if self._sleep(0.3): return

        if ice:
            self._status(order_id, "dispensing", 5, "Adding ice...")
            if self._sleep(1.2): return

        self._status(order_id, "dispensing", 10, f"Preparing {recipe_name}...")
        if self._sleep(1.5): return

        self._maybe_chaos()   # inject chaos mid-sequence

        self._status(order_id, "dispensing", 40, "Dispensing ingredients...")
        if self._sleep(2.5): return

        self._status(order_id, "mixing", 60, "Mixing your drink...")
        if self._sleep(2.0): return

        self._status(order_id, "pouring", 80, "Pouring into glass...")
        if self._sleep(1.5): return

        self._status(order_id, "done", 100, "Drink is ready! Enjoy!")
        log(f"ORDER #{order_id} done — starting post-order auto-clean.")

        # Post-order auto-clean fires immediately
        self._run_post_order_clean({
            "order_id": order_id,
            "pumps":    [p["pump"] for p in data.get("pumps", [])],
        })

    # ── Post-order auto-clean sequence ────────

    def _run_post_order_clean(self, data: dict):
        order_id = data.get("order_id")
        pumps    = data.get("pumps", [])

        log(f"Post-order clean → order #{order_id}, reversing pumps {pumps}")

        # REVERSING starts immediately — doesn't need glass gone yet
        self._status(order_id, "reversing", 0, "Reversing pump lines...")
        if self._sleep(2.0): return

        # Gate: wait for glass to be removed (no timeout per PROTOCOL.md §4)
        self._status(order_id, "reversing", 50, "Please remove your glass...")
        log("Gate: waiting indefinitely for glass removal...")
        self._wait_for_glass_removal(order_id)
        if self._abort.is_set(): return

        self._status(order_id, "washing", 0, "Rinsing container with water...")
        if self._sleep(2.5): return

        self._status(order_id, "mixing", 50, "Shaking container clean...")
        if self._sleep(2.0): return

        self._status(order_id, "draining", 75, "Draining water...")
        if self._sleep(1.5): return

        self._status(order_id, "resealing", 90, "Resealing container...")
        if self._sleep(1.0): return

        self._status(None, "idle", 0, "Ready for next order")
        log("Auto-clean complete — machine idle.")

    def _wait_for_glass_removal(self, order_id):
        """
        In this harness, simulate glass removal after a 3-second pause by
        sending a SENSOR event. In real life the customer removes their glass
        and the IR sensor fires — same event, different origin.
        """
        time.sleep(3)
        if self._abort.is_set():
            return
        log("Simulating customer removing glass.")
        self._sensor(glass_state="no_glass")

    # ── Manual clean sequence ─────────────────

    def _run_manual_clean(self, data: dict):
        mode = data.get("mode", "all")
        pump = data.get("pump")
        desc = f"pump {pump}" if mode == "single" else "all pump lines"
        log(f"Manual clean — {desc}")

        self._status(None, "reversing", 0, f"Flushing {desc}...")
        if self._sleep(2.5): return
        self._status(None, "idle", 0, "Ready")
        log("Manual clean complete.")

    # ── Message senders ───────────────────────

    def _status(self, order_id, status: str, progress: int, message: str):
        payload = {
            "type":     "STATUS",
            "status":   status,
            "progress": progress,
            "message":  message,
        }
        if order_id is not None:
            payload["order_id"] = order_id
        log(f"→ STATUS  {status} ({progress}%) | {message}")
        self._send(encode(payload))

    def _sensor(self, glass_state: str):
        payload = {"type": "SENSOR", "glass_state": glass_state}
        log(f"→ SENSOR  glass_state={glass_state}")
        self._send(encode(payload))

    # ── Chaos injection ───────────────────────

    def _maybe_chaos(self):
        """Randomly inject a chaos event if --chaos is active."""
        if not self._chaos:
            return
        roll = random.random()
        if roll < 0.25:
            # Send a garbage/malformed line
            garbage = b"THIS IS NOT JSON\n"
            log("[CHAOS] Injecting malformed line.")
            self._send(garbage)
        elif roll < 0.40:
            # Inject an artificial delay (simulate slow firmware)
            delay = random.uniform(1.5, 3.5)
            log(f"[CHAOS] Injecting {delay:.1f}s delay.")
            time.sleep(delay)
        elif roll < 0.50:
            # Send a JSON line with an unknown message type
            log("[CHAOS] Injecting unknown message type.")
            self._send(encode({"type": "TELEMETRY", "motor_temp": 42.7}))
        # else: no chaos this time

    # ── Sleep helper ──────────────────────────

    def _sleep(self, seconds: float) -> bool:
        """Sleep in 0.1s chunks; return True if abort was requested."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            if self._abort.is_set():
                log("Abort flag detected — bailing out of sequence.")
                self._status(None, "aborted", 0, "Aborted.")
                time.sleep(0.5)
                self._status(None, "idle", 0, "Ready")
                return True
            time.sleep(0.1)
        return False


# ─────────────────────────────────────────────
#  Serial port mode (socat / real port)
# ─────────────────────────────────────────────

def run_serial(port_path: str, chaos: bool):
    import serial  # noqa: PLC0415 — only needed in this mode

    log(f"Opening serial port: {port_path}")
    try:
        port = serial.Serial(port_path, baudrate=115200, timeout=1)
    except serial.SerialException as e:
        log(f"ERROR: Cannot open {port_path}: {e}")
        sys.exit(1)

    log(f"Listening on {port_path} — waiting for commands from Flask app...")

    def send_fn(data: bytes):
        try:
            port.write(data)
            port.flush()
        except Exception as e:
            log(f"Send error: {e}")

    esp = FakeESP32(send_fn, chaos=chaos)

    try:
        while True:
            try:
                raw = port.readline()
            except serial.SerialException as e:
                log(f"Read error: {e}")
                break

            if not raw:
                continue

            line = raw.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                log(f"Non-JSON received: {line!r}")
                continue

            esp.on_command(data)

    except KeyboardInterrupt:
        log("Interrupted by user.")
    finally:
        port.close()
        log("Port closed.")


# ─────────────────────────────────────────────
#  TCP mode (cross-platform / Windows)
# ─────────────────────────────────────────────

def run_tcp_server(host: str, tcp_port: int, chaos: bool):
    """
    Listens as a raw TCP server.
    pyserial on the Flask side uses "socket://localhost:<tcp_port>" as SERIAL_PORT.
    Note: pyserial's socket:// connects as a TCP *client* — so this script is the
    server side.
    """
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, tcp_port))
    server.listen(1)
    log(f"TCP server listening on {host}:{tcp_port}")
    log("In config.py set: SERIAL_PORT = f'socket://localhost:{tcp_port}', SIMULATOR_MODE = False")

    while True:
        log("Waiting for Flask app to connect...")
        try:
            conn, addr = server.accept()
        except KeyboardInterrupt:
            log("Interrupted — shutting down.")
            break

        log(f"Flask app connected from {addr}")
        _handle_tcp_connection(conn, chaos)
        log("Connection closed — ready for next connection.")

    server.close()


def _handle_tcp_connection(conn: socket.socket, chaos: bool):
    buf = b""

    def send_fn(data: bytes):
        try:
            conn.sendall(data)
        except Exception as e:
            log(f"TCP send error: {e}")

    esp = FakeESP32(send_fn, chaos=chaos)

    try:
        while True:
            try:
                chunk = conn.recv(4096)
            except ConnectionResetError:
                log("Connection reset by Flask app.")
                break

            if not chunk:
                log("Flask app disconnected.")
                break

            buf += chunk
            while b"\n" in buf:
                line_bytes, buf = buf.split(b"\n", 1)
                line = line_bytes.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    log(f"Non-JSON received: {line!r}")
                    continue
                esp.on_command(data)

    except KeyboardInterrupt:
        pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Fake ESP32 serial harness for Cocktail-Craft dev/testing.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--port", "-p",
        metavar="PORT",
        help="Serial port to listen on (e.g. /dev/pts/3 or COM4). "
             "Use with socat virtual pair on Linux/Pi.",
    )
    mode.add_argument(
        "--tcp",
        action="store_true",
        help="Run as a TCP server instead of a serial port. "
             "Set SERIAL_PORT = 'socket://localhost:<tcp-port>' in config.py.",
    )
    parser.add_argument(
        "--tcp-host",
        default="localhost",
        metavar="HOST",
        help="TCP bind address (default: localhost). Only used with --tcp.",
    )
    parser.add_argument(
        "--tcp-port",
        type=int,
        default=9999,
        metavar="PORT",
        help="TCP port to listen on (default: 9999). Only used with --tcp.",
    )
    parser.add_argument(
        "--chaos",
        action="store_true",
        help="Randomly inject malformed lines, delays, and unknown message types "
             "to stress-test the Flask app's error handling.",
    )

    args = parser.parse_args()

    if args.chaos:
        log("CHAOS MODE enabled — expect deliberate protocol errors.")

    if args.tcp:
        run_tcp_server(args.tcp_host, args.tcp_port, args.chaos)
    else:
        run_serial(args.port, args.chaos)


if __name__ == "__main__":
    main()
