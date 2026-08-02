"""Regression tests for capacity-aware Pi-side glass validation."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

import hardware_controller as hw
from machine_state import MachineState


class GlassCapacityTests(unittest.TestCase):
    def setUp(self):
        with hw._lock:
            self.original_state = copy.deepcopy(hw._state)
        self.small_capacity = patch.object(hw, "_small_glass_capacity_ml", return_value=170)
        self.small_capacity.start()

    def tearDown(self):
        self.small_capacity.stop()
        with hw._lock:
            hw._state.clear()
            hw._state.update(self.original_state)

    def _waiting_order(self, volume: float) -> hw.SerialController:
        controller = hw.SerialController()
        controller._pending_order = {
            "db_order_id": 42,
            "wire_order_id": "ORD-42",
            "initialized": True,
            "start_sent": False,
            "ice": False,
            "total_volume_ml": volume,
            "required_glass": hw._required_glass_for_volume(volume),
        }
        with hw._lock:
            hw._state["machine_status"] = MachineState.WAITING_GLASS
        return controller

    def test_200_ml_order_requires_a_large_glass(self):
        controller = self._waiting_order(200)
        with hw._lock:
            hw._state["glass_state"] = "small_glass"

        with patch.object(controller, "_send_text") as send_text:
            with self.assertRaisesRegex(RuntimeError, "requires a large glass"):
                controller.start_pending_order()

        send_text.assert_not_called()
        self.assertFalse(controller._pending_order["start_sent"])
        self.assertEqual(hw.get_state()["machine_status"], "waiting_glass")

    def test_small_glass_ir_reading_does_not_start_a_200_ml_order(self):
        controller = self._waiting_order(200)

        with patch.object(controller, "start_pending_order") as start:
            controller._handle_ir_response({"upper": 1, "lower": 0})

        start.assert_not_called()
        state = hw.get_state()
        self.assertEqual(state["machine_status"], "waiting_glass")
        self.assertIn("requires a large glass", state["message"])

    def test_large_glass_ir_reading_starts_a_200_ml_order(self):
        controller = self._waiting_order(200)

        with patch.object(controller, "start_pending_order") as start:
            controller._handle_ir_response({"upper": 0, "lower": 0})

        start.assert_called_once()

    def test_a_170_ml_order_allows_a_small_glass(self):
        controller = self._waiting_order(170)
        with hw._lock:
            hw._state["glass_state"] = "small_glass"

        with patch.object(controller, "_send_text"):
            controller.start_pending_order()

        self.assertTrue(controller._pending_order["start_sent"])
        self.assertEqual(controller._active_run_mode, "order")

    def test_requirement_uses_the_admin_calibrated_capacity(self):
        with patch.object(hw, "_small_glass_capacity_ml", return_value=200):
            self.assertEqual(hw._required_glass_for_volume(200), "small_or_large")
            self.assertEqual(hw._required_glass_for_volume(201), "large")



if __name__ == "__main__":
    unittest.main()
