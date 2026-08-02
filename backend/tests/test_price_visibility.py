"""Regression tests for the customer drink-price display setting."""

from __future__ import annotations

import unittest
from unittest.mock import patch

try:
    import app as flask_app
except ModuleNotFoundError as exc:
    # The lightweight local test interpreter does not install Flask. The
    # deployed backend virtual environment does, so retain these API tests
    # there while allowing the database/controller suite to run locally.
    if exc.name != "flask":
        raise
    flask_app = None


@unittest.skipUnless(flask_app is not None, "Flask is not installed in this test environment")
class PriceVisibilityApiTests(unittest.TestCase):
    def setUp(self):
        flask_app.app.config.update(TESTING=True)
        self.client = flask_app.app.test_client()

    def test_menu_omits_prices_by_default(self):
        menu = [{"id": 1, "name": "Mojito", "price": 12.0}]
        with (
            patch.object(flask_app.recipe_manager, "get_menu", return_value=menu),
            patch.object(flask_app.db, "get_setting", return_value=False),
        ):
            response = self.client.get("/api/menu")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["show_prices"])
        self.assertNotIn("price", response.json["drinks"][0])

    def test_menu_includes_prices_when_admin_enables_them(self):
        menu = [{"id": 1, "name": "Mojito", "price": 12.0}]
        with (
            patch.object(flask_app.recipe_manager, "get_menu", return_value=menu),
            patch.object(flask_app.db, "get_setting", return_value=True),
        ):
            response = self.client.get("/api/menu")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["show_prices"])
        self.assertEqual(response.json["drinks"][0]["price"], 12.0)

    def test_admin_can_persist_price_visibility_and_notify_kiosks(self):
        with (
            patch.object(flask_app.db, "set_setting") as set_setting,
            patch.object(flask_app, "_push_event") as push_event,
        ):
            response = self.client.put(
                "/api/admin/display/price-visibility",
                json={"show_prices": True},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"success": True, "show_prices": True})
        set_setting.assert_called_once_with("show_drink_prices", True)
        push_event.assert_called_once_with("display_settings", {"show_prices": True})

    def test_price_visibility_requires_a_boolean(self):
        response = self.client.put(
            "/api/admin/display/price-visibility",
            json={"show_prices": "yes"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("true or false", response.json["error"])


if __name__ == "__main__":
    unittest.main()
