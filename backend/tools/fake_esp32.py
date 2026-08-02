#!/usr/bin/env python3
"""Virtual implementation of the current CocktailCraft ESP32-S3 protocol.

It is a development harness for the real ``SerialController`` path, not a
second source of firmware behaviour.  It accepts compact ORDER JSON and
plain-text commands, and emits the current firmware's ``DATA:``/``LOG:``
lines.  Timings are deliberately accelerated.

Usage (with a virtual serial pair or TCP server) is unchanged::

    python fake_esp32.py --port /dev/pts/3
    python fake_esp32.py --tcp --tcp-port 9999
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
from datetime import datetime


MAX_PUMP_TIME_MS = 60_000


def log(message: str):
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{timestamp}] [FAKE-ESP32] {message}", flush=True)


class FakeESP32:
    """Implements the public Pi-facing protocol in the firmware handoff."""

    def __init__(self, send_line):
        self._send_line = send_line
        self._lock = threading.RLock()
        self._loaded_order: dict | None = None
        self._busy = False
        self._lines_primed = False
        self._ice_busy = False
        self._ice_position = "CLOSED"

    def ready(self):
        self._data({"type": "system", "event": "ready"})

    def on_line(self, line: str):
        log(f"<- {line}")
        if len(line) > 512:
            self._log("ERROR:COMMAND_TOO_LONG")
            return
        if line.startswith("{"):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                self._order_response("rejected", "invalid_json")
                return
            self._handle_order(payload)
            return

        command = line.strip().upper()
        if command in {"S", "START"}:
            self._start()
        elif command in {"X", "STOP"}:
            self._stop()
        elif command == "CLEAN":
            self._start_clean()
        elif command == "ICE":
            self._start_ice()
        elif command == "ICE_STATUS":
            self._log(f"ICE_POSITION:{self._ice_position},STATE:{'BUSY' if self._ice_busy else 'IDLE'},BUSY:{'YES' if self._ice_busy else 'NO'}")
        elif command == "ICE_SET_OPEN":
            self._set_ice_position("OPEN")
        elif command == "ICE_SET_CLOSED":
            self._set_ice_position("CLOSED")
        elif command == "REVERSE_PUMPS":
            self._start_reverse()
        elif command == "CHECK_IR":
            self._data({"type": "response", "command": "CHECK_IR", "upper": 1, "lower": 1})
        elif command == "CHECK_LEVELS":
            self._data({"type": "response", "command": "CHECK_LEVELS", **{f"ls{i}": 1 for i in range(1, 7)}})
        elif command == "CHECK_LINE_STATE":
            self._data({
                "type": "response",
                "command": "CHECK_LINE_STATE",
                "primed": self._lines_primed,
                "state": "PRIMED" if self._lines_primed else "EMPTY",
            })
        else:
            self._log("ERROR:UNKNOWN_COMMAND")

    def _handle_order(self, payload: dict):
        with self._lock:
            if self._busy or self._loaded_order is not None:
                self._order_response("rejected", "busy")
                return
            if payload.get("command") != "ORDER":
                self._order_response("rejected", "invalid_command")
                return
            order_id = payload.get("order_id")
            if not isinstance(order_id, str) or not order_id:
                self._order_response("rejected", "missing_order_id")
                return
            pumps = payload.get("pumps")
            if not isinstance(pumps, list) or not pumps:
                self._order_response("rejected", "missing_pumps")
                return
            seen = set()
            parsed = []
            for entry in pumps:
                try:
                    pump = int(entry["pump"])
                    time_ms = int(entry["time_ms"])
                except (KeyError, TypeError, ValueError):
                    self._order_response("rejected", "invalid_pump_time")
                    return
                if pump not in range(1, 7):
                    self._order_response("rejected", "invalid_pump_number")
                    return
                if not 1 <= time_ms <= MAX_PUMP_TIME_MS:
                    self._order_response("rejected", "invalid_pump_time")
                    return
                if pump in seen:
                    self._order_response("rejected", "duplicate_pump")
                    return
                seen.add(pump)
                parsed.append({"pump": pump, "time_ms": time_ms})

            self._loaded_order = {
                "order_id": order_id,
                "pumps": sorted(parsed, key=lambda item: item["pump"]),
                "ice": bool(payload.get("ice", {}).get("enabled", False)),
            }
        self._order_response("initialized")

    def _start(self):
        with self._lock:
            if self._busy:
                self._log("BUSY")
                return
            if not self._loaded_order:
                self._log("NO_ORDER_LOADED")
                return
            order = dict(self._loaded_order)
            self._busy = True
        self._log("ACK:START")
        threading.Thread(target=self._run_order, args=(order,), daemon=True).start()

    def _start_clean(self):
        with self._lock:
            if self._busy:
                self._log("BUSY")
                return
            self._busy = True
        self._log("ACK:CLEAN")
        threading.Thread(target=self._run_clean, daemon=True).start()

    def _stop(self):
        with self._lock:
            if not self._busy and not self._ice_busy:
                self._log("NOTHING_STOPPABLE_RUNNING")
                return
            self._ice_busy = False
        self._log("ACK:STOP")

    def _start_ice(self):
        with self._lock:
            if self._busy:
                self._log("BUSY")
                return
            if self._ice_busy:
                self._log("ICE_BUSY")
                return
            if self._ice_position != "CLOSED":
                self._log("ICE_POSITION_NOT_CLOSED")
                return
            self._busy = True
            self._ice_busy = True
        self._log("ACK:ICE")
        threading.Thread(target=self._run_standalone_ice, daemon=True).start()

    def _set_ice_position(self, position: str):
        with self._lock:
            if self._busy or self._ice_busy:
                self._log("BUSY")
                return
            self._ice_position = position
        self._log("WARNING: ICE POSITION CHANGED WITHOUT MOVEMENT")

    def _run_standalone_ice(self):
        self._run_ice_cycle()
        with self._lock:
            self._ice_busy = False
            self._busy = False

    def _start_reverse(self):
        with self._lock:
            if self._busy:
                self._log("BUSY")
                return
            self._busy = True
        self._log("ACK:REVERSE_PUMPS")
        threading.Thread(target=self._run_reverse, daemon=True).start()

    def _run_order(self, order: dict):
        if order["ice"]:
            self._run_ice_cycle()
        if not self._lines_primed:
            self._system("line_priming", "started")
            self._sleep(0.35)
            self._lines_primed = True
            self._system("line_priming", "finished")
        for command in order["pumps"]:
            self._system("pump", "forward", pump=command["pump"])
            self._sleep(0.18)
            self._system("pump", "stop", pump=command["pump"])
            self._sleep(0.08)
        self._system("mixing", "started")
        self._sleep(0.3)
        self._system("mixing", "stopped")
        self._sleep(0.12)
        self._system("valve", "opened")
        with self._lock:
            self._loaded_order = None
            self._busy = False
        # Match CocktailCraft_Firmware.ino: valve/opened is mechanical
        # progress, while drink/ready is the final customer-facing signal.
        self._system("drink", "ready", order_id=order["order_id"])

    def _run_clean(self):
        self._system("cleaning", "started")
        self._sleep(0.12)
        self._system("pump", "forward", pump=1)
        self._sleep(0.25)
        self._system("pump", "stop", pump=1)
        self._system("mixing", "started")
        self._sleep(0.25)
        self._system("mixing", "stopped")
        self._sleep(0.12)
        self._system("valve", "opened")
        self._system("cleaning", "finished")
        with self._lock:
            self._busy = False

    def _run_ice_cycle(self):
        with self._lock:
            self._ice_busy = True
        self._log("ICE CYCLE STARTED")
        self._log("ICE DISPENSER OPENING CW FOR 26000ms")
        self._sleep(0.08)
        with self._lock:
            self._ice_position = "OPEN"
        self._log("ICE SAVED POSITION: OPEN")
        self._log("ICE DISPENSER FULLY OPEN")
        self._log("ICE DISPENSER CLOSING CCW FOR 26000ms")
        self._sleep(0.08)
        with self._lock:
            self._ice_position = "CLOSED"
        self._log("ICE SAVED POSITION: CLOSED")
        self._log("ICE DISPENSER FULLY CLOSED")
        self._log("ICE DISPENSER VIBRATION STARTED")
        self._sleep(0.08)
        self._log("ICE DISPENSER VIBRATION FINISHED")
        self._log("ICE CYCLE FINISHED")
        with self._lock:
            self._ice_busy = False

    def _run_reverse(self):
        self._system("reverse_pumps", "started")
        self._sleep(0.5)
        self._lines_primed = False
        self._system("reverse_pumps", "finished")
        with self._lock:
            self._busy = False

    def _order_response(self, status: str, reason: str | None = None):
        body = {"type": "response", "command": "ORDER", "status": status}
        if reason:
            body["reason"] = reason
        elif self._loaded_order:
            body.update(self._loaded_order)
        self._data(body)

    def _system(self, event: str, action: str | None = None, **extra):
        body = {"type": "system", "event": event, **extra}
        if action is not None:
            body["action"] = action
        self._data(body)

    def _data(self, body: dict):
        line = "DATA:" + json.dumps(body, separators=(",", ":"))
        log(f"-> {line}")
        self._send_line(line)

    def _log(self, message: str):
        line = f"LOG:{message}"
        log(f"-> {line}")
        self._send_line(line)

    @staticmethod
    def _sleep(seconds: float):
        time.sleep(seconds)


def run_serial(port_path: str):
    import serial

    try:
        port = serial.Serial(port_path, baudrate=115200, timeout=1)
    except serial.SerialException as exc:
        log(f"ERROR: Cannot open {port_path}: {exc}")
        sys.exit(1)

    def send_line(line: str):
        port.write((line + "\n").encode("utf-8"))
        port.flush()

    fake = FakeESP32(send_line)
    fake.ready()
    try:
        while True:
            raw = port.readline()
            if raw:
                fake.on_line(raw.decode("utf-8", errors="replace").strip())
    except KeyboardInterrupt:
        pass
    finally:
        port.close()


def run_tcp(host: str, tcp_port: int):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, tcp_port))
    server.listen(1)
    log(f"TCP server listening on {host}:{tcp_port}")
    try:
        while True:
            connection, address = server.accept()
            log(f"Client connected from {address}")
            _serve_connection(connection)
    except KeyboardInterrupt:
        pass
    finally:
        server.close()


def _serve_connection(connection: socket.socket):
    def send_line(line: str):
        connection.sendall((line + "\n").encode("utf-8"))

    fake = FakeESP32(send_line)
    fake.ready()
    buffer = b""
    try:
        while True:
            chunk = connection.recv(4096)
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                raw_line, buffer = buffer.split(b"\n", 1)
                fake.on_line(raw_line.decode("utf-8", errors="replace").strip())
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="Current CocktailCraft ESP32 protocol harness")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--port", "-p", help="Serial port, e.g. /dev/pts/3")
    target.add_argument("--tcp", action="store_true", help="Run a TCP server for pyserial socket://")
    parser.add_argument("--tcp-host", default="localhost")
    parser.add_argument("--tcp-port", type=int, default=9999)
    args = parser.parse_args()
    if args.tcp:
        run_tcp(args.tcp_host, args.tcp_port)
    else:
        run_serial(args.port)


if __name__ == "__main__":
    main()
