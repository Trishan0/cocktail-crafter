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
            controller.send_order(42, "Protocol test", [{"pump": 1, "duration_ms": 1000}])

        send_json.assert_called_once()

    def test_wire_lines_are_bounded_and_single_line(self):
        controller = hw.SerialController()

        with self.assertRaisesRegex(ValueError, "single line"):
            controller._write_line("START\nCLEAN")
        with self.assertRaisesRegex(ValueError, "512"):
            controller._write_line("X" * 513)

    def test_valve_opened_finishes_the_tracked_order(self):
        controller = hw.SerialController()
        controller._pending_order = {"db_order_id": 42, "wire_order_id": "ORD-42"}
        controller._active_run_mode = "order"

        with patch.object(controller, "_finish_order_after_display") as finish, patch.object(hw, "_record_event"):
            controller._handle_system_event({"type": "system", "event": "valve", "action": "opened"})

        finish.assert_called_once_with(42)

    def test_undocumented_drink_ready_event_does_not_control_completion(self):
        controller = hw.SerialController()
        controller._pending_order = {"db_order_id": 42, "wire_order_id": "ORD-42"}
        controller._active_run_mode = "order"

        with patch.object(controller, "_finish_order_after_display") as finish:
            controller._handle_system_event({"type": "system", "event": "drink", "action": "ready"})

        finish.assert_not_called()

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
