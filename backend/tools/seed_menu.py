"""
seed_menu.py — Replace the house menu, ingredients and pump layout
Cocktail-Craft Bartender | Raspberry Pi

Removes every existing recipe (order history is kept: db.delete_recipe nulls
the link and the snapshots stay), sets the pump layout below, deletes any
ingredient that is no longer used, and creates the menu.

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

# Pump 1 is reserved for Water (the CLEAN cycle uses it). Pumps 2-5 pour at
# the indexer before mixing; pump 6 is the firmware's direct syrup line and
# pours after the valve opens, so rose syrup lands on top of the drink.
PUMPS = {
    1: ("Water", "Cleaning water"),
    2: ("Orange Juice", "Fresh orange juice"),
    3: ("Strawberry Juice", "Strawberry juice"),
    4: ("Sprite", "Lemon-lime soda"),
    5: ("Green Apple Juice", "Fresh green apple juice"),
    6: ("Rose Syrup", "Floral rose syrup"),
}

# Small drinks fit the small glass; large drinks (250 ml) need the large one.
MENU = [
    {
        "name": "Pink Rose Fizz",
        "category": "small",
        "description": "Sweet, fizzy and floral.",
        "ingredients": {"Sprite": 100, "Rose Syrup": 20},
    },
    {
        "name": "Orange Rose Cooler",
        "category": "small",
        "description": "Citrusy with a sweet rose flavour.",
        "ingredients": {"Orange Juice": 100, "Rose Syrup": 20},
    },
    {
        "name": "Green Apple Sparkle",
        "category": "small",
        "description": "Crisp green apple flavour with refreshing carbonation.",
        # Soda has no free pump, so Sprite stands in (same carbonation).
        "ingredients": {"Green Apple Juice": 90, "Sprite": 60},
    },
    {
        "name": "Strawberry Sprite",
        "category": "small",
        "description": "Sweet strawberry flavour with a fizzy finish.",
        "ingredients": {"Strawberry Juice": 90, "Sprite": 60},
    },
    {
        "name": "Tropical Sunset",
        "category": "large",
        "description": "A fruity orange-strawberry combination with a sparkling finish.",
        "ingredients": {"Orange Juice": 100, "Strawberry Juice": 100, "Sprite": 50},
    },
    {
        "name": "Apple Berry Splash",
        "category": "large",
        "description": "Sweet and fruity with a refreshing sparkling finish.",
        "ingredients": {"Green Apple Juice": 100, "Strawberry Juice": 100, "Sprite": 50},
    },
]


def _ingredient_ids() -> dict[str, int]:
    return {row["name"].strip().lower(): int(row["id"]) for row in db.get_all_ingredients()}


def main():
    parser = argparse.ArgumentParser(description="Replace the house menu, ingredients and pumps.")
    parser.add_argument("--db", default="Cocktail-Craft.db", help="Database file, relative to backend/.")
    args = parser.parse_args()

    db.DB_PATH = os.path.join(BACKEND, args.db)
    if not os.path.exists(db.DB_PATH):
        sys.exit(f"Database not found: {db.DB_PATH}")
    db.init_db()

    for recipe in db.get_all_recipes(visible_only=False):  # hidden ones too
        db.delete_recipe(int(recipe["id"]))

    ids = _ingredient_ids()
    for name, description in PUMPS.values():
        if name.lower() not in ids:
            db.create_ingredient(name, description)
    ids = _ingredient_ids()
    for pump_number, (name, _) in PUMPS.items():
        db.assign_pump(pump_number, ids[name.lower()])

    keep = {name.lower() for name, _ in PUMPS.values()}
    for name, ingredient_id in ids.items():
        if name not in keep:
            db.delete_ingredient(ingredient_id)
            print(f"  - removed ingredient {name}")

    for drink in MENU:
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
        print(f"  + {drink['name']} ({drink['category']}, {sum(drink['ingredients'].values())} ml)")

    layout = ", ".join(f"{n}: {name}" for n, (name, _) in PUMPS.items())
    print(f"Menu replaced in {os.path.basename(db.DB_PATH)}. Pumps — {layout}")


if __name__ == "__main__":
    main()
