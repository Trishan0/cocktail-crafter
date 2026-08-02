"""Regression tests for Admin-controlled customer menu ordering."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import db


class RecipeOrderTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "recipe_order.db")
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE recipes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    category TEXT NOT NULL DEFAULT 'classic',
                    price REAL DEFAULT 0,
                    is_visible INTEGER NOT NULL DEFAULT 1,
                    image_url TEXT,
                    display_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE recipe_ingredients (
                    recipe_id INTEGER NOT NULL,
                    ingredient_id INTEGER NOT NULL,
                    amount_ml REAL NOT NULL
                );
                INSERT INTO recipes (id, name, display_order) VALUES
                    (1, 'First', 1), (2, 'Second', 2), (3, 'Third', 3);
                """
            )

    def tearDown(self):
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def test_admin_order_is_returned_by_both_customer_and_admin_recipe_queries(self):
        db.set_recipe_display_order([3, 1, 2])

        self.assertEqual([recipe["id"] for recipe in db.get_all_recipes()], [3, 1, 2])
        self.assertEqual(
            [recipe["id"] for recipe in db.get_all_recipes(visible_only=False)],
            [3, 1, 2],
        )

    def test_new_recipe_is_added_after_the_existing_menu_items(self):
        recipe_id = db.create_recipe("Fourth", "", "classic", 0, [])

        self.assertEqual([recipe["id"] for recipe in db.get_all_recipes()], [1, 2, 3, recipe_id])

    def test_reorder_rejects_a_partial_or_duplicate_recipe_list(self):
        with self.assertRaisesRegex(ValueError, "every current recipe"):
            db.set_recipe_display_order([1, 2])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            db.set_recipe_display_order([1, 2, 2])


if __name__ == "__main__":
    unittest.main()
