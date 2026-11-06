"""
seed_menu.py — Replace the house menu with the current CocktailCraft recipes
Cocktail-Craft Bartender | Raspberry Pi

Removes every existing recipe (order history is kept: db.delete_recipe nulls
the link and the snapshots stay) and creates the menu below. Also ensures
Green Apple Juice exists and is assigned to pump 5, which previously held Soda.

    uv run python tools/seed_menu.py                          # Cocktail-Craft.db
    uv run python tools/seed_menu.py --db Cocktail-Craft.sim.db

Back up the database first; this is not reversible from the app.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

import db  # noqa: E402

GREEN_APPLE = "Green Apple Juice"
GREEN_APPLE_PUMP = 5

# Small drinks fit the small glass (150 ml); large drinks need the large glass.
MENU = [
    {
        "name": "Apple Rose Fizz",
        "category": "small",
        "description": "Green apple and rose syrup lifted with Sprite.",
        "ingredients": {GREEN_APPLE: 70, "Sprite": 55, "Rose Syrup": 25},
    },
    {
        "name": "Citrus Sunrise",
        "category": "small",
        "description": "Bright orange juice with Sprite, a touch of apple and rose.",
        "ingredients": {"Orange Juice": 75, "Sprite": 50, GREEN_APPLE: 15, "Rose Syrup": 10},
    },
    {
        "name": "Pink Apple Sparkle",
        "category": "small",
        "description": "A rosy apple sparkler with a splash of orange.",
        "ingredients": {GREEN_APPLE: 45, "Sprite": 60, "Rose Syrup": 35, "Orange Juice": 10},
    },
    {
        "name": "Golden Apple Twist",
        "category": "small",
        "description": "Orange and green apple, softened with Sprite and a hint of rose.",
        "ingredients": {GREEN_APPLE: 40, "Orange Juice": 65, "Sprite": 40, "Rose Syrup": 5},
    },
    {
        "name": "Tropical Sunset",
        "category": "large",
        "description": "A long orange-and-apple cooler with Sprite and rose.",
        # Orange juice is capped at the 100 ml per-ingredient limit; the extra
        # 10 ml went to green apple so the drink is still 250 ml.
        "ingredients": {"Orange Juice": 100, GREEN_APPLE: 55, "Sprite": 65, "Rose Syrup": 30},
    },
    {
        "name": "Royal Rose Cooler",
        "category": "large",
        "description": "Rose-forward and refreshing, with apple, orange and Sprite.",
        "ingredients": {GREEN_APPLE: 70, "Orange Juice": 35, "Sprite": 95, "Rose Syrup": 50},
    },
]


def _ingredient_ids() -> dict[str, int]:
    return {row["name"].strip().lower(): int(row["id"]) for row in db.get_all_ingredients()}


def main():
    parser = argparse.ArgumentParser(description="Replace the house menu with the current recipes.")
    parser.add_argument("--db", default="Cocktail-Craft.db", help="Database file, relative to backend/.")
    args = parser.parse_args()

    db.DB_PATH = os.path.join(BACKEND, args.db)
    if not os.path.exists(db.DB_PATH):
        sys.exit(f"Database not found: {db.DB_PATH}")
    db.init_db()

    ids = _ingredient_ids()
    if GREEN_APPLE.lower() not in ids:
        db.create_ingredient(GREEN_APPLE, "Fresh green apple juice")
        ids = _ingredient_ids()
    db.assign_pump(GREEN_APPLE_PUMP, ids[GREEN_APPLE.lower()])

    needed = {name for drink in MENU for name in drink["ingredients"]}
    missing = [name for name in needed if name.lower() not in ids]
    if missing:
        sys.exit(f"Missing ingredients: {', '.join(missing)}")

    for recipe in db.get_all_recipes(visible_only=False):  # hidden ones too
        db.delete_recipe(int(recipe["id"]))

    for drink in MENU:
        total = sum(drink["ingredients"].values())
        db.create_recipe(
            drink["name"],
            drink["description"],
            drink["category"],
            0.0,
            [
                {"ingredient_id": ids[name.lower()], "amount_ml": amount}
                for name, amount in drink["ingredients"].items()
            ],
        )
        print(f"  + {drink['name']} ({drink['category']}, {total} ml)")

    print(f"Menu replaced in {os.path.basename(db.DB_PATH)}; {GREEN_APPLE} is on pump {GREEN_APPLE_PUMP}.")


if __name__ == "__main__":
    main()
