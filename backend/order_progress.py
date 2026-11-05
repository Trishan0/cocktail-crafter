"""
order_progress.py — Real-time drink progress derived from firmware events
Cocktail-Craft Bartender | Raspberry Pi

The ESP32 firmware (CocktailCraft_Firmware.ino) makes a drink in a fixed
order, and reports each transition as a DATA event:

  1. line_priming started/finished   only when the saved feed-line state is empty
  2. pumps 1-5, one at a time, in pump-number order. The indexer moves to each
     bottle, sends pump/forward, runs exactly the ORDER's time_ms, sends
     pump/stop, then moves on. Pumps with no time are skipped silently.
  3. mixing started/stopped          the oscillator
  4. valve opened                    the drink pours into the glass
  5. pump 6 forward/stop             direct syrup topping, ~5 s after the valve
  6. drink ready                     after the parallel ice cycle, if any

Only pump runs have a known duration (their time_ms). Everything else is
reported as "active" without an invented percentage, so the kiosk can animate
pours against their real duration and show other steps as in progress.
"""

from __future__ import annotations

import time

INDEXED_PUMPS = range(1, 6)  # firmware INDEXED_PUMP_COUNT = 5
SYRUP_PUMP = 6               # firmware DIRECT_SYRUP_PUMP

# Share of the overall percentage per step type; pours split theirs by run time.
_WEIGHTS = {"pour": 60.0, "mix": 15.0, "serve": 10.0, "topping": 10.0, "ice": 5.0}


def _now_ms() -> int:
    return int(time.time() * 1000)


class OrderProgress:
    """Step plan for one order, advanced only by firmware events."""

    def __init__(self, pump_commands: list, ice: bool = False, time_scale: float = 1.0):
        pours = []
        topping = None
        for command in pump_commands:
            pump = int(command["pump"])
            step = {
                "key": f"pump{pump}",
                "kind": "pour",
                "pump": pump,
                "ingredient": str(command.get("ingredient") or f"Pump {pump}"),
                "amount_ml": command.get("amount_ml"),
                "duration_ms": int(int(command["duration_ms"]) * time_scale),
                "state": "pending",
            }
            if pump == SYRUP_PUMP:
                step["kind"] = "topping"
                topping = step
            elif pump in INDEXED_PUMPS:
                pours.append(step)
        pours.sort(key=lambda step: step["pump"])

        self.steps: list[dict] = list(pours)
        self.steps.append({"key": "mix", "kind": "mix", "state": "pending"})
        self.steps.append({"key": "serve", "kind": "serve", "state": "pending"})
        if topping:
            self.steps.append(topping)
        self.ice = bool(ice)
        if self.ice:
            self.steps.append({"key": "ice", "kind": "ice", "state": "pending"})

        self.active_key: str | None = None
        self.active_started_ms: int | None = None
        # Between pump/stop and the next pump/forward the indexer is moving.
        self.moving_to: str | None = None
        self.priming = False
        self._percent = 0

    # ---- firmware events -------------------------------------------------

    def on_start(self):
        """START was sent. The firmware may prime the lines or head straight for
        the first bottle; it does not say which until its next event."""
        self.moving_to = None

    def on_line_priming(self, action: str):
        self.priming = action == "started"
        self.moving_to = None if self.priming else self._next_pour_key()

    def on_pump(self, pump: int, action: str):
        step = self._step(f"pump{pump}")
        if step is None:
            return
        if action == "forward":
            self.priming = False
            self.moving_to = None
            self._activate(step)
        else:
            self._finish(step)
            if step["kind"] == "pour":
                self.moving_to = self._next_pour_key()
            elif self.ice:
                self._activate(self._step("ice"))

    def on_mixing(self, action: str):
        mix = self._step("mix")
        if action == "started":
            self.moving_to = None
            for step in self.steps:
                if step["kind"] == "pour" and step["state"] != "done":
                    step["state"] = "done"  # firmware skipped it (no time)
            self._activate(mix)
        else:
            self._finish(mix)
            self._activate(self._step("serve"))

    def on_valve_opened(self):
        serve = self._step("serve")
        self._finish(serve)
        if self._step(f"pump{SYRUP_PUMP}"):
            # Topping starts after the firmware's post-valve delay; until its
            # pump/forward arrives nothing is running that we can time.
            self.active_key = None
            self.active_started_ms = None
        elif self.ice:
            self._activate(self._step("ice"))

    def on_ready(self):
        for step in self.steps:
            step["state"] = "done"
        self.active_key = None
        self.active_started_ms = None
        self.moving_to = None
        self._percent = 100

    # ---- derived values ---------------------------------------------------

    @property
    def phase(self) -> str:
        if self.priming:
            return "priming"
        active = self._step(self.active_key) if self.active_key else None
        if active:
            return {"pour": "pouring", "mix": "mixing", "serve": "serving",
                    "topping": "topping", "ice": "ice"}[active["kind"]]
        if self.moving_to:
            return "moving"
        mix = self._step("mix")
        if mix["state"] == "pending" and any(
            s["kind"] == "pour" and s["state"] == "done" for s in self.steps
        ):
            # Last bottle done: the indexer returns to position 1 before mixing.
            return "returning"
        if self._step("serve")["state"] == "done":
            topping = self._step(f"pump{SYRUP_PUMP}")
            # Between valve/opened and pump-6 forward: the post-valve delay.
            return "topping" if topping and topping["state"] != "done" else "finishing"
        return "starting"

    def percent(self) -> int:
        """Monotonic overall percentage for logs and the admin activity bar."""
        total_pour_ms = sum(s["duration_ms"] for s in self.steps if s["kind"] == "pour") or 1
        weights = {}
        for step in self.steps:
            if step["kind"] == "pour":
                weights[step["key"]] = _WEIGHTS["pour"] * step["duration_ms"] / total_pour_ms
            else:
                weights[step["key"]] = _WEIGHTS[step["kind"]]
        total = sum(weights.values())
        done = sum(weights[s["key"]] for s in self.steps if s["state"] == "done")
        active = self._step(self.active_key) if self.active_key else None
        if active and active.get("duration_ms") and self.active_started_ms:
            elapsed = _now_ms() - self.active_started_ms
            done += weights[active["key"]] * min(1.0, elapsed / active["duration_ms"])
        value = min(99, int(round(100 * done / total)))
        self._percent = max(self._percent, value)
        return self._percent

    def message(self) -> str:
        phase = self.phase
        if phase == "priming":
            return "Priming the feed lines..."
        if phase == "pouring":
            step = self._step(self.active_key)
            return f"Pouring {step['ingredient']} (pump {step['pump']})..."
        if phase == "moving":
            step = self._step(self.moving_to)
            return f"Moving to {step['ingredient']} (pump {step['pump']})..."
        if phase == "returning":
            return "Getting ready to mix..."
        if phase == "mixing":
            return "Mixing drink..."
        if phase == "serving":
            return "Pouring into the glass..."
        if phase == "topping":
            step = self._step(f"pump{SYRUP_PUMP}")
            return f"Adding {step['ingredient']} topping..."
        if phase == "ice":
            return "Finishing the ice..."
        if phase == "finishing":
            return "Finishing up..."
        return "Preparing drink..."

    def snapshot(self) -> dict:
        """JSON-ready view for the kiosk. server_time_ms lets it correct for clock skew."""
        return {
            "phase": self.phase,
            "steps": [dict(step) for step in self.steps],
            "active_key": self.active_key,
            "active_started_ms": self.active_started_ms,
            "moving_to": self.moving_to,
            "server_time_ms": _now_ms(),
            "percent": self.percent(),
        }

    # ---- helpers ----------------------------------------------------------

    def _step(self, key: str | None) -> dict | None:
        return next((step for step in self.steps if step["key"] == key), None)

    def _next_pour_key(self) -> str | None:
        step = next((s for s in self.steps if s["kind"] == "pour" and s["state"] == "pending"), None)
        return step["key"] if step else None

    def _activate(self, step: dict | None):
        if step is None:
            return
        step["state"] = "active"
        self.active_key = step["key"]
        self.active_started_ms = _now_ms()

    def _finish(self, step: dict | None):
        if step is None:
            return
        step["state"] = "done"
        if self.active_key == step["key"]:
            self.active_key = None
            self.active_started_ms = None
