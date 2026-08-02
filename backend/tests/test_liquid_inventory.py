"""Regression tests for Pi-side bottle inventory and reserve checks."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

import config
import db
import recipe_manager


class LiquidAvailabilityTests(unittest.TestCase):
    def _pump(self, current_ml: float) -> dict:
        return {
            "pump_number": 1,
            "ingredient_name": "Water",
            "current_volume_ml": current_ml,
        }

    def test_recipe_amount_plus_15_ml_reserve_is_required(self):
        command = [{"pump": 1, "ingredient": "Water", "amount_ml": 50, "duration_ms": 1000}]
        with (
            patch.object(recipe_manager.db, "get_all_pumps", return_value=[self._pump(65)]),
            patch.object(recipe_manager.db, "get_setting", return_value=1),
        ):
            self.assertIsNone(recipe_manager.validate_liquid_availability(command, {"ls1": 1}))

        with (
            patch.object(recipe_manager.db, "get_all_pumps", return_value=[self._pump(64)]),
            patch.object(recipe_manager.db, "get_setting", return_value=1),
        ):
            error = recipe_manager.validate_liquid_availability(command, {"ls1": 1})

        self.assertIn("50 ml plus the 15 ml safety reserve", error)
        self.assertIn("Water", error)

    def test_physical_level_sensor_must_also_pass(self):
        command = [{"pump": 1, "ingredient": "Water", "amount_ml": 50, "duration_ms": 1000}]
        with (
            patch.object(recipe_manager.db, "get_all_pumps", return_value=[self._pump(200)]),
            patch.object(recipe_manager.db, "get_setting", return_value=1),
        ):
            error = recipe_manager.validate_liquid_availability(command, {"ls1": 0})

        self.assertIn("below its fixed liquid-level sensor line", error)


class AtomicInventoryReservationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "inventory.db")
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.executescript(
                """
                CREATE TABLE ingredients (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                );
                CREATE TABLE pumps (
                    id INTEGER PRIMARY KEY,
                    pump_number INTEGER NOT NULL UNIQUE,
                    ingredient_id INTEGER,
                    current_volume_ml REAL NOT NULL DEFAULT 0
                );
                INSERT INTO ingredients (id, name) VALUES (1, 'Water');
                INSERT INTO pumps (id, pump_number, ingredient_id, current_volume_ml)
                VALUES (1, 1, 1, 200);
                """
            )
            conn.commit()

    def tearDown(self):
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def _current_volume(self) -> float:
        with closing(sqlite3.connect(self.db_path)) as conn:
            return float(conn.execute(
                "SELECT current_volume_ml FROM pumps WHERE pump_number = 1"
            ).fetchone()[0])

    def test_reservation_deducts_only_the_recipe_amount(self):
        commands = [{"pump": 1, "amount_ml": 50}]

        shortages = db.reserve_pump_inventory(commands, config.LIQUID_RESERVE_MARGIN_ML)

        self.assertEqual(shortages, [])
        self.assertEqual(self._current_volume(), 150)

    def test_failed_reservation_changes_nothing(self):
        commands = [{"pump": 1, "amount_ml": 190}]

        shortages = db.reserve_pump_inventory(commands, config.LIQUID_RESERVE_MARGIN_ML)

        self.assertEqual(len(shortages), 1)
        self.assertEqual(shortages[0]["minimum_ml"], 205)
        self.assertEqual(self._current_volume(), 200)

    def test_inventory_can_be_restored_when_order_send_fails(self):
        commands = [{"pump": 1, "amount_ml": 50}]
        self.assertEqual(db.reserve_pump_inventory(commands, 15), [])

        db.restore_pump_inventory(commands)

        self.assertEqual(self._current_volume(), 200)


if __name__ == "__main__":
    unittest.main()
