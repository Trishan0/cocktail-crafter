"""
db.py — SQLite Database Layer
ATRIA Bartender | Raspberry Pi

New normalized schema:
  - ingredients     : all known liquids (can grow beyond 10)
  - pumps           : the 6 active hardware slots
  - recipes         : drink definitions
  - recipe_ingredients : junction (recipe ↔ ingredient + amount_ml)
  - orders          : order history with pump command snapshot
"""

import sqlite3
import json
import os
from datetime import datetime
import config

DB_PATH = os.path.join(os.path.dirname(__file__), "atria.db")


# ─────────────────────────────────────────────
#  CONNECTION
# ─────────────────────────────────────────────

def get_connection():
    """Return a SQLite connection with row_factory for dict-like access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ─────────────────────────────────────────────
#  SCHEMA INIT
# ─────────────────────────────────────────────

def init_db():
    """Create all tables if they don't exist, then seed defaults."""
    with get_connection() as conn:
        conn.executescript("""
            -- All known liquids/ingredients the machine can work with
            CREATE TABLE IF NOT EXISTS ingredients (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL UNIQUE,
                description TEXT    DEFAULT '',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- The 6 active hardware pump slots
            CREATE TABLE IF NOT EXISTS pumps (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                pump_number         INTEGER NOT NULL UNIQUE,  -- 1 to 6
                ingredient_id       INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
                flow_rate_ml_per_s  REAL    NOT NULL DEFAULT 1.5,
                is_active           INTEGER NOT NULL DEFAULT 1
            );

            -- Drink definitions
            CREATE TABLE IF NOT EXISTS recipes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL UNIQUE,
                description TEXT    DEFAULT '',
                category    TEXT    NOT NULL DEFAULT 'classic',
                price       REAL    DEFAULT 0.0,
                is_visible  INTEGER NOT NULL DEFAULT 1,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Junction table: which ingredient goes in which recipe and how much
            CREATE TABLE IF NOT EXISTS recipe_ingredients (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
                amount_ml     REAL    NOT NULL,
                UNIQUE(recipe_id, ingredient_id)
            );

            -- Order history
            CREATE TABLE IF NOT EXISTS orders (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id       INTEGER REFERENCES recipes(id),
                recipe_name     TEXT    NOT NULL,
                status          TEXT    NOT NULL DEFAULT 'pending',
                pump_commands   TEXT,               -- JSON snapshot sent to ESP32
                ordered_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at    TIMESTAMP
            );
        """)
    _seed_defaults()
    print("[DB] Database initialized.")


# ─────────────────────────────────────────────
#  SEED DEFAULTS
# ─────────────────────────────────────────────

DEFAULT_INGREDIENTS = [
    "Rum", "Vodka", "Gin", "Tequila", "Whiskey",
    "Triple Sec", "Blue Curaçao", "Campari",
    "Lime Juice", "Lemon Juice", "Simple Syrup",
    "Grenadine", "Coconut Cream", "Orange Juice",
    "Cranberry Juice", "Pineapple Juice", "Cola",
]

DEFAULT_PUMP_ASSIGNMENTS = {
    1: "Rum",
    2: "Vodka",
    3: "Gin",
    4: "Lime Juice",
    5: "Simple Syrup",
    6: "Orange Juice",
}

DEFAULT_RECIPES = [
    {
        "name": "Mojito",
        "category": "classic",
        "description": "Fresh mint, lime & rum",
        "price": 12.0,
        "ingredients": {"Rum": 50, "Lime Juice": 25, "Simple Syrup": 15},
    },
    {
        "name": "Gin & Tonic",
        "category": "classic",
        "description": "Crisp gin with tonic water",
        "price": 10.0,
        "ingredients": {"Gin": 50, "Lime Juice": 10},
    },
    {
        "name": "Tequila Sunrise",
        "category": "classic",
        "description": "Tequila, orange juice & grenadine",
        "price": 11.0,
        "ingredients": {"Tequila": 45, "Orange Juice": 90, "Grenadine": 15},
    },
    {
        "name": "Vodka Lime",
        "category": "signature",
        "description": "Vodka with fresh lime juice",
        "price": 9.0,
        "ingredients": {"Vodka": 50, "Lime Juice": 20, "Simple Syrup": 10},
    },
]


def _seed_defaults():
    """Seed ingredients, pumps, and recipes only if tables are empty."""
    with get_connection() as conn:
        # Seed ingredients
        ing_count = conn.execute("SELECT COUNT(*) FROM ingredients").fetchone()[0]
        if ing_count == 0:
            for name in DEFAULT_INGREDIENTS:
                conn.execute("INSERT OR IGNORE INTO ingredients (name) VALUES (?)", (name,))
            print(f"[DB] Seeded {len(DEFAULT_INGREDIENTS)} default ingredients.")

        # Seed pump slots 1-6
        pump_count = conn.execute("SELECT COUNT(*) FROM pumps").fetchone()[0]
        if pump_count == 0:
            for pnum in range(1, config.NUM_PUMPS + 1):
                ing_name = DEFAULT_PUMP_ASSIGNMENTS.get(pnum)
                ing_id = None
                if ing_name:
                    row = conn.execute(
                        "SELECT id FROM ingredients WHERE name = ?", (ing_name,)
                    ).fetchone()
                    if row:
                        ing_id = row["id"]
                conn.execute(
                    """INSERT INTO pumps (pump_number, ingredient_id, flow_rate_ml_per_s)
                       VALUES (?, ?, ?)""",
                    (pnum, ing_id, config.DEFAULT_FLOW_RATE)
                )
            print(f"[DB] Seeded {config.NUM_PUMPS} pump slots.")

        # Seed recipes
        recipe_count = conn.execute("SELECT COUNT(*) FROM recipes").fetchone()[0]
        if recipe_count == 0:
            for r in DEFAULT_RECIPES:
                cursor = conn.execute(
                    """INSERT INTO recipes (name, description, category, price)
                       VALUES (?, ?, ?, ?)""",
                    (r["name"], r["description"], r["category"], r["price"])
                )
                recipe_id = cursor.lastrowid
                for ing_name, amount_ml in r["ingredients"].items():
                    row = conn.execute(
                        "SELECT id FROM ingredients WHERE name = ?", (ing_name,)
                    ).fetchone()
                    if row:
                        conn.execute(
                            """INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount_ml)
                               VALUES (?, ?, ?)""",
                            (recipe_id, row["id"], amount_ml)
                        )
            print(f"[DB] Seeded {len(DEFAULT_RECIPES)} default recipes.")


# ─────────────────────────────────────────────
#  INGREDIENTS
# ─────────────────────────────────────────────

def get_all_ingredients():
    """Return all ingredients as list of dicts."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM ingredients ORDER BY name"
        ).fetchall()
    return [dict(r) for r in rows]


def create_ingredient(name: str, description: str = ""):
    """Insert a new ingredient. Returns new id or raises if name exists."""
    name = name.strip()
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO ingredients (name, description) VALUES (?, ?)",
            (name, description)
        )
        return cursor.lastrowid


def update_ingredient(ingredient_id: int, name: str = None, description: str = None):
    with get_connection() as conn:
        if name is not None:
            conn.execute(
                "UPDATE ingredients SET name = ? WHERE id = ?", (name.strip(), ingredient_id)
            )
        if description is not None:
            conn.execute(
                "UPDATE ingredients SET description = ? WHERE id = ?", (description, ingredient_id)
            )


def delete_ingredient(ingredient_id: int):
    """Delete ingredient (cascade will remove recipe_ingredient rows too)."""
    with get_connection() as conn:
        conn.execute("DELETE FROM ingredients WHERE id = ?", (ingredient_id,))


# ─────────────────────────────────────────────
#  PUMPS
# ─────────────────────────────────────────────

def get_all_pumps():
    """
    Return all 6 pump slots with their assigned ingredient info.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.id, p.pump_number, p.flow_rate_ml_per_s, p.is_active,
                   i.id   AS ingredient_id,
                   i.name AS ingredient_name
            FROM pumps p
            LEFT JOIN ingredients i ON p.ingredient_id = i.id
            ORDER BY p.pump_number
        """).fetchall()
    return [dict(r) for r in rows]


def assign_pump(pump_number: int, ingredient_id: int = None):
    """Assign (or unassign) an ingredient to a pump slot."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE pumps SET ingredient_id = ? WHERE pump_number = ?",
            (ingredient_id, pump_number)
        )


def update_pump_flow_rate(pump_number: int, flow_rate: float):
    """Update the calibrated flow rate for a pump."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE pumps SET flow_rate_ml_per_s = ? WHERE pump_number = ?",
            (flow_rate, pump_number)
        )


def get_pump_assignments():
    """
    Return a dict: ingredient_id → {pump_number, flow_rate_ml_per_s}
    Used by recipe_manager to resolve ingredients to pumps.
    """
    pumps = get_all_pumps()
    mapping = {}
    for p in pumps:
        if p["ingredient_id"] is not None:
            mapping[p["ingredient_id"]] = {
                "pump_number":       p["pump_number"],
                "flow_rate_ml_per_s": p["flow_rate_ml_per_s"],
            }
    return mapping


# ─────────────────────────────────────────────
#  RECIPES
# ─────────────────────────────────────────────

def get_all_recipes(visible_only=True):
    """Return recipes with their ingredient lists."""
    with get_connection() as conn:
        if visible_only:
            rows = conn.execute(
                "SELECT * FROM recipes WHERE is_visible = 1 ORDER BY category, name"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM recipes ORDER BY category, name"
            ).fetchall()

        result = []
        for row in rows:
            r = dict(row)
            ings = conn.execute("""
                SELECT i.id, i.name, ri.amount_ml
                FROM recipe_ingredients ri
                JOIN ingredients i ON ri.ingredient_id = i.id
                WHERE ri.recipe_id = ?
            """, (r["id"],)).fetchall()
            r["ingredients"] = [dict(ing) for ing in ings]
            result.append(r)
    return result


def get_recipe_by_id(recipe_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
        if not row:
            return None
        r = dict(row)
        ings = conn.execute("""
            SELECT i.id, i.name, ri.amount_ml
            FROM recipe_ingredients ri
            JOIN ingredients i ON ri.ingredient_id = i.id
            WHERE ri.recipe_id = ?
        """, (recipe_id,)).fetchall()
        r["ingredients"] = [dict(ing) for ing in ings]
    return r


def create_recipe(name: str, description: str, category: str, price: float, ingredients: list):
    """
    Create a recipe with ingredients.
    ingredients: [{"ingredient_id": 1, "amount_ml": 50}, ...]
    Returns new recipe_id.
    """
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO recipes (name, description, category, price) VALUES (?, ?, ?, ?)",
            (name.strip(), description, category, price)
        )
        recipe_id = cursor.lastrowid
        for ing in ingredients:
            conn.execute(
                "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount_ml) VALUES (?, ?, ?)",
                (recipe_id, ing["ingredient_id"], ing["amount_ml"])
            )
    return recipe_id


def update_recipe(recipe_id: int, name: str = None, description: str = None,
                  category: str = None, price: float = None,
                  is_visible: int = None, ingredients: list = None):
    with get_connection() as conn:
        if name is not None:
            conn.execute("UPDATE recipes SET name = ? WHERE id = ?", (name.strip(), recipe_id))
        if description is not None:
            conn.execute("UPDATE recipes SET description = ? WHERE id = ?", (description, recipe_id))
        if category is not None:
            conn.execute("UPDATE recipes SET category = ? WHERE id = ?", (category, recipe_id))
        if price is not None:
            conn.execute("UPDATE recipes SET price = ? WHERE id = ?", (price, recipe_id))
        if is_visible is not None:
            conn.execute("UPDATE recipes SET is_visible = ? WHERE id = ?", (is_visible, recipe_id))
        if ingredients is not None:
            conn.execute("DELETE FROM recipe_ingredients WHERE recipe_id = ?", (recipe_id,))
            for ing in ingredients:
                conn.execute(
                    "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount_ml) VALUES (?, ?, ?)",
                    (recipe_id, ing["ingredient_id"], ing["amount_ml"])
                )


def delete_recipe(recipe_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))


# ─────────────────────────────────────────────
#  ORDERS
# ─────────────────────────────────────────────

def create_order(recipe_id: int, recipe_name: str, pump_commands: list):
    """Insert a new order and return its id."""
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO orders (recipe_id, recipe_name, status, pump_commands)
               VALUES (?, ?, 'pending', ?)""",
            (recipe_id, recipe_name, json.dumps(pump_commands))
        )
        return cursor.lastrowid


def update_order_status(order_id: int, status: str):
    """Update order status."""
    completed_at = None
    if status in ("done", "aborted", "error"):
        completed_at = datetime.now().isoformat()
    with get_connection() as conn:
        conn.execute(
            "UPDATE orders SET status = ?, completed_at = ? WHERE id = ?",
            (status, completed_at, order_id)
        )


def get_recent_orders(limit=20):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM orders ORDER BY ordered_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_order_by_id(order_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    return dict(row) if row else None


# ─────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("\n[DB] Recipes:")
    for r in get_all_recipes():
        ings = ", ".join(f"{i['name']} {i['amount_ml']}ml" for i in r["ingredients"])
        print(f"  {r['name']} → {ings}")
    print("\n[DB] Pumps:")
    for p in get_all_pumps():
        print(f"  Pump {p['pump_number']}: {p['ingredient_name'] or '(empty)'} @ {p['flow_rate_ml_per_s']} ml/s")
