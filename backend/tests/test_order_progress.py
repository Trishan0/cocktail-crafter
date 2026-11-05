import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import hardware_controller as hw
from machine_state import MachineState
from order_progress import OrderProgress


# Recipe order deliberately differs from pump order: the firmware's indexer
# always visits pumps 1-5 in number order and runs pump 6 after the valve.
COMMANDS = [
    {"pump": 4, "duration_ms": 32000, "amount_ml": 80, "ingredient": "Sprite"},
    {"pump": 2, "duration_ms": 40000, "amount_ml": 100, "ingredient": "Orange Juice"},
    {"pump": 6, "duration_ms": 4800, "amount_ml": 12, "ingredient": "Rose Syrup"},
]


class OrderProgressTests(unittest.TestCase):
    def test_plan_follows_firmware_order(self):
        plan = OrderProgress(COMMANDS, ice=True)
        self.assertEqual(
            [step["key"] for step in plan.steps],
            ["pump2", "pump4", "mix", "serve", "pump6", "ice"],
        )
        self.assertEqual(plan.steps[0]["duration_ms"], 40000)
        self.assertEqual(plan._step("pump6")["kind"], "topping")

    def test_time_scale_matches_simulated_runs(self):
        plan = OrderProgress(COMMANDS, time_scale=0.25)
        self.assertEqual(plan._step("pump2")["duration_ms"], 10000)

    def test_event_sequence_advances_phases(self):
        plan = OrderProgress(COMMANDS, ice=True)
        plan.on_start()
        self.assertEqual((plan.phase, plan.moving_to), ("starting", None))

        plan.on_pump(2, "forward")
        self.assertEqual((plan.phase, plan.active_key), ("pouring", "pump2"))
        self.assertIsNotNone(plan.active_started_ms)

        plan.on_pump(2, "stop")
        self.assertEqual((plan.phase, plan.moving_to), ("moving", "pump4"))

        plan.on_pump(4, "forward")
        plan.on_pump(4, "stop")
        self.assertEqual(plan.phase, "returning")  # indexer heads back to position 1
        plan.on_mixing("started")
        self.assertEqual(plan.phase, "mixing")
        plan.on_mixing("stopped")
        self.assertEqual(plan.phase, "serving")
        plan.on_valve_opened()
        self.assertEqual(plan.phase, "topping")  # waiting through the post-valve delay
        plan.on_pump(6, "forward")
        self.assertEqual((plan.phase, plan.active_key), ("topping", "pump6"))
        plan.on_pump(6, "stop")
        self.assertEqual((plan.phase, plan.active_key), ("ice", "ice"))

    def test_mixing_marks_unpoured_steps_done(self):
        plan = OrderProgress(COMMANDS)
        plan.on_pump(2, "forward")
        plan.on_pump(2, "stop")
        plan.on_mixing("started")  # pump 4 never reported: treat as skipped
        self.assertEqual(plan._step("pump4")["state"], "done")

    def test_percent_is_monotonic_and_capped_until_ready(self):
        plan = OrderProgress(COMMANDS)
        seen = [plan.percent()]
        for update in (
            lambda: plan.on_pump(2, "forward"),
            lambda: plan.on_pump(2, "stop"),
            lambda: plan.on_pump(4, "forward"),
            lambda: plan.on_pump(4, "stop"),
            lambda: plan.on_mixing("started"),
            lambda: plan.on_mixing("stopped"),
            lambda: plan.on_valve_opened(),
            lambda: plan.on_pump(6, "forward"),
            lambda: plan.on_pump(6, "stop"),
        ):
            update()
            seen.append(plan.percent())
        self.assertEqual(seen, sorted(seen))
        self.assertLessEqual(seen[-1], 99)
        plan.on_ready()
        self.assertEqual(plan.percent(), 100)

    def test_priming_is_its_own_phase(self):
        plan = OrderProgress(COMMANDS)
        plan.on_line_priming("started")
        self.assertEqual(plan.phase, "priming")
        plan.on_line_priming("finished")
        self.assertEqual((plan.phase, plan.moving_to), ("moving", "pump2"))


class SerialEventRoutingTests(unittest.TestCase):
    def setUp(self):
        self.controller = hw.SerialController()
        self.controller._pending_order = {
            "db_order_id": 7,
            "wire_order_id": "ORD-7",
            "initialized": True,
            "start_sent": True,
            "pump_commands": COMMANDS,
        }
        self.controller._active_run_mode = "order"
        with hw._lock:
            hw._state["machine_status"] = MachineState.DISPENSING
        hw._begin_order_progress(COMMANDS, ice=False)

    def tearDown(self):
        with hw._lock:
            hw._discard_order_progress_locked()
            hw._state["machine_status"] = MachineState.IDLE

    def send(self, event, action, **extra):
        with patch.object(hw, "_record_event"):
            self.controller._handle_system_event(
                {"type": "system", "event": event, "action": action, **extra}
            )
        return hw.get_state()

    def test_pump_events_publish_the_active_ingredient(self):
        state = self.send("pump", "forward", pump=2)
        self.assertEqual(state["machine_status"], MachineState.DISPENSING.value)
        self.assertEqual(state["order_progress"]["active_key"], "pump2")
        self.assertIn("Orange Juice", state["message"])

        state = self.send("pump", "stop", pump=2)
        self.assertEqual(state["order_progress"]["moving_to"], "pump4")

    def test_full_sequence_reaches_serving_then_clears_on_ready(self):
        self.send("pump", "forward", pump=2)
        self.send("pump", "stop", pump=2)
        self.send("pump", "forward", pump=4)
        self.send("pump", "stop", pump=4)
        self.assertEqual(self.send("mixing", "started")["machine_status"], MachineState.MIXING.value)
        self.assertEqual(self.send("mixing", "stopped")["machine_status"], MachineState.POURING.value)
        self.assertEqual(self.send("valve", "opened")["order_progress"]["phase"], "topping")
        self.assertEqual(self.send("pump", "forward", pump=6)["machine_status"], MachineState.DISPENSING.value)
        self.assertEqual(self.send("pump", "stop", pump=6)["machine_status"], MachineState.POURING.value)

        with (
            patch.object(self.controller, "_stop_ir_polling"),
            patch.object(self.controller, "_start_post_drink_ir_polling"),
        ):
            state = self.send("drink", "ready", order_id="ORD-7")
        self.assertEqual(state["machine_status"], MachineState.DONE.value)
        self.assertIsNone(state["order_progress"])


if __name__ == "__main__":
    unittest.main()
