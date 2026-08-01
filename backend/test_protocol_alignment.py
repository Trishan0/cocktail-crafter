"""Focused regression checks for the documented Pi ↔ ESP32 protocol."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

import hardware_controller as hw
from machine_state import MachineState


class SerialProtocolAlignmentTests(unittest.TestCase):
    def setUp(self):
        with hw._lock:
            self.original_state = copy.deepcopy(hw._state)

    def tearDown(self):
        with hw._lock:
            hw._state.clear()
            hw._state.update(self.original_state)

    def test_order_does_not_block_on_a_one_time_ready_event(self):
        controller = hw.SerialController()
        with hw._lock:
            hw._state["connected"] = True
            hw._state["firmware_ready"] = False

        with patch.object(controller, "_send_json") as send_json, patch.object(controller, "_start_order_timeout"):
            controller.send_order(
                42,
                "Protocol test",
                [{"pump": 1, "duration_ms": 1000}],
                total_volume_ml=50,
            )

        send_json.assert_called_once()
        self.assertNotIn("total_volume_ml", send_json.call_args.args[0])

    def test_wire_lines_are_bounded_and_single_line(self):
        controller = hw.SerialController()

        with self.assertRaisesRegex(ValueError, "single line"):
            controller._write_line("START\nCLEAN")
        with self.assertRaisesRegex(ValueError, "512"):
            controller._write_line("X" * 513)

    def test_valve_opened_is_progress_not_order_completion(self):
        controller = hw.SerialController()
        controller._pending_order = {"db_order_id": 42, "wire_order_id": "ORD-42"}
        controller._active_run_mode = "order"
        with hw._lock:
            hw._state["machine_status"] = MachineState.POURING

        with patch.object(hw, "_record_event"):
            controller._handle_system_event({"type": "system", "event": "valve", "action": "opened"})

        self.assertEqual(hw.get_state()["machine_status"], MachineState.POURING.value)
        self.assertEqual(controller._active_run_mode, "order")
        self.assertNotIn("drink_ready", controller._pending_order)

    def test_drink_ready_starts_post_drink_glass_removal_polling(self):
        controller = hw.SerialController()
        controller._pending_order = {
            "db_order_id": 42,
            "wire_order_id": "ORD-42",
            "initialized": True,
            "start_sent": True,
        }
        controller._active_run_mode = "order"
        with hw._lock:
            hw._state["machine_status"] = MachineState.POURING

        with (
            patch.object(controller, "_stop_ir_polling") as stop_pre_order_poll,
            patch.object(controller, "_start_post_drink_ir_polling") as start_removal_poll,
            patch.object(hw, "_record_event"),
        ):
            controller._handle_system_event(
                {"type": "system", "event": "drink", "action": "ready", "order_id": "ORD-42"}
            )

        self.assertEqual(hw.get_state()["machine_status"], MachineState.DONE.value)
        self.assertTrue(controller._pending_order["drink_ready"])
        self.assertIsNone(controller._active_run_mode)
        stop_pre_order_poll.assert_called_once()
        start_removal_poll.assert_called_once()

    def test_no_glass_after_ready_sends_clean(self):
        controller = hw.SerialController()
        controller._pending_order = {
            "db_order_id": 42,
            "wire_order_id": "ORD-42",
            "initialized": True,
            "start_sent": True,
            "drink_ready": True,
        }
        with hw._lock:
            hw._state["machine_status"] = MachineState.DONE

        with patch.object(controller, "send_clean") as send_clean:
            controller._handle_ir_response({"command": "CHECK_IR", "upper": 1, "lower": 1})

        send_clean.assert_called_once()

    def test_cleaning_finished_releases_completed_order_to_idle(self):
        controller = hw.SerialController()
        controller._pending_order = {
            "db_order_id": 42,
            "wire_order_id": "ORD-42",
            "initialized": True,
            "start_sent": True,
            "drink_ready": True,
        }
        controller._active_run_mode = "cleaning"
        with hw._lock:
            hw._state["machine_status"] = MachineState.WASHING

        controller._handle_system_event({"type": "system", "event": "cleaning", "action": "finished"})

        self.assertEqual(hw.get_state()["machine_status"], MachineState.IDLE.value)
        self.assertIsNone(controller._pending_order)
        self.assertIsNone(controller._active_run_mode)

    def test_start_error_log_moves_an_active_order_to_error(self):
        controller = hw.SerialController()
        controller._pending_order = {"db_order_id": 42, "wire_order_id": "ORD-42"}
        controller._active_run_mode = "order"
        with hw._lock:
            hw._state["machine_status"] = MachineState.DISPENSING

        with patch.object(hw, "_record_event"):
            controller._handle_log("ICE_POSITION_NOT_CLOSED")

        state = hw.get_state()
        self.assertEqual(state["machine_status"], MachineState.ERROR.value)
        self.assertIsNone(controller._pending_order)
        self.assertIsNone(controller._active_run_mode)


if __name__ == "__main__":
    unittest.main()
