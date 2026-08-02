"""Regression tests for Admin recipe deletion and immutable order history."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import db


class RecipeDeletionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "recipes.db")
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("PRAGMA foreign_keys=ON")
            conn.executescript(
                """
                CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE recipe_ingredients (
                    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                    amount_ml REAL NOT NULL
                );
                -- Deliberately use the old restrictive reference to prove the
                -- runtime migration path works for existing installations.
                CREATE TABLE orders (
                    id INTEGER PRIMARY KEY,
                    recipe_id INTEGER REFERENCES recipes(id),
                    recipe_name TEXT NOT NULL,
                    ingredients_snapshot TEXT
                );
                INSERT INTO recipes (id, name) VALUES (8, 'Historical Drink');
                INSERT INTO ingredients (id, name) VALUES (1, 'Lime');
                INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount_ml)
                    VALUES (8, 1, 25);
                INSERT INTO orders (id, recipe_id, recipe_name, ingredients_snapshot)
                    VALUES (101, 8, 'Historical Drink', '[{"name":"Lime","amount_ml":25}]');
                """
            )

    def tearDown(self):
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def test_delete_recipe_preserves_order_history_and_clears_its_link(self):
        self.assertTrue(db.delete_recipe(8))

        with db.get_connection() as conn:
            recipe = conn.execute("SELECT id FROM recipes WHERE id = 8").fetchone()
            ingredients = conn.execute(
                "SELECT recipe_id FROM recipe_ingredients WHERE recipe_id = 8"
            ).fetchall()
            order = conn.execute(
                "SELECT recipe_id, recipe_name, ingredients_snapshot FROM orders WHERE id = 101"
            ).fetchone()

        self.assertIsNone(recipe)
        self.assertEqual(ingredients, [])
        self.assertIsNone(order["recipe_id"])
        self.assertEqual(order["recipe_name"], "Historical Drink")
        self.assertIn("Lime", order["ingredients_snapshot"])

    def test_delete_missing_recipe_reports_no_change(self):
        self.assertFalse(db.delete_recipe(999))


if __name__ == "__main__":
    unittest.main()
