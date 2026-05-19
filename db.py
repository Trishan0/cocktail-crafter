"""
db.py — SQLite Database Layer
CocktailCraft | Raspberry Pi
Handles all database setup, queries, and maintenance.
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta
import config

DB_PATH = os.path.join(os.path.dirname(__file__), "cocktailcraft.db")
CUSTOM_DRINK_EXPIRY_DAYS = config.CUSTOM_EXPIRY_DAYS


# ─────────────────────────────────────────────
#  CONNECTION
# ─────────────────────────────────────────────

def get_connection():
    """Return a SQLite connection with row_factory for dict-like access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # safe for concurrent reads
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ─────────────────────────────────────────────
#  SCHEMA INIT
# ─────────────────────────────────────────────

def init_db():
    """Create all tables if they don't exist, then seed default recipes."""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS recipes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL UNIQUE,
                category    TEXT    NOT NULL DEFAULT 'classic',
                description TEXT,
                emoji       TEXT    DEFAULT '🍹',
                color       TEXT    DEFAULT '#e91e8c',
                ingredients TEXT    NOT NULL,   -- JSON: {"vodka": 30, "gin": 0, ...}
                is_active   INTEGER DEFAULT 1,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS custom_drinks (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT    NOT NULL,
                ingredients   TEXT    NOT NULL,  -- JSON
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at    TIMESTAMP NOT NULL,
                times_ordered INTEGER DEFAULT 0,
                is_saved      INTEGER DEFAULT 0  -- 1 = permanent, never expires
            );

            CREATE TABLE IF NOT EXISTS orders (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id   INTEGER,
                recipe_name TEXT    NOT NULL,
                is_custom   INTEGER DEFAULT 0,
                ingredients TEXT,               -- JSON snapshot at time of order
                status      TEXT    DEFAULT 'pending',
                ordered_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
        """)
    _seed_recipes()
    print("[DB] Database initialized.")


# ─────────────────────────────────────────────
#  SEED DEFAULT RECIPES
#  6 bottles: [bottle_1_ml, bottle_2_ml, ..., bottle_6_ml]
#  Map these to your actual bottle layout on the machine
# ─────────────────────────────────────────────

DEFAULT_RECIPES = [
    {
        "name": "Mojito",
        "category": "classic",
        "description": "Fresh mint, lime & rum",
        "emoji": "🌿",
        "color": "#00c896",
        "ingredients": {"bottle_1": 40, "bottle_2": 20, "bottle_3": 30, "bottle_4": 0, "bottle_5": 0, "bottle_6": 10}
    },
    {
        "name": "Blue Lagoon",
        "category": "classic",
        "description": "Vodka, blue curaçao & lemonade",
        "emoji": "🌊",
        "color": "#0099ff",
        "ingredients": {"bottle_1": 35, "bottle_2": 0, "bottle_3": 20, "bottle_4": 30, "bottle_5": 0, "bottle_6": 15}
    },
    {
        "name": "Tequila Sunrise",
        "category": "classic",
        "description": "Tequila, orange juice & grenadine",
        "emoji": "🌅",
        "color": "#ff6b35",
        "ingredients": {"bottle_1": 0, "bottle_2": 40, "bottle_3": 0, "bottle_4": 20, "bottle_5": 30, "bottle_6": 10}
    },
    {
        "name": "Cosmopolitan",
        "category": "classic",
        "description": "Vodka, triple sec, cranberry & lime",
        "emoji": "🍸",
        "color": "#e91e8c",
        "ingredients": {"bottle_1": 30, "bottle_2": 0, "bottle_3": 15, "bottle_4": 25, "bottle_5": 0, "bottle_6": 15}
    },
    {
        "name": "Pina Colada",
        "category": "tropical",
        "description": "Rum, coconut cream & pineapple",
        "emoji": "🍍",
        "color": "#f5c842",
        "ingredients": {"bottle_1": 25, "bottle_2": 0, "bottle_3": 30, "bottle_4": 0, "bottle_5": 35, "bottle_6": 0}
    },
    {
        "name": "Cuba Libre",
        "category": "classic",
        "description": "Rum, cola & a squeeze of lime",
        "emoji": "🥤",
        "color": "#8b1a1a",
        "ingredients": {"bottle_1": 40, "bottle_2": 0, "bottle_3": 0, "bottle_4": 0, "bottle_5": 20, "bottle_6": 10}
    },
    {
        "name": "Strawberry Daiquiri",
        "category": "tropical",
        "description": "Rum, strawberry & fresh lime juice",
        "emoji": "🍓",
        "color": "#ff3366",
        "ingredients": {"bottle_1": 35, "bottle_2": 0, "bottle_3": 20, "bottle_4": 30, "bottle_5": 0, "bottle_6": 0}
    },
    {
        "name": "Whiskey Sour",
        "category": "classic",
        "description": "Whiskey, lemon juice & simple syrup",
        "emoji": "🥃",
        "color": "#d4860b",
        "ingredients": {"bottle_1": 0, "bottle_2": 0, "bottle_3": 30, "bottle_4": 15, "bottle_5": 25, "bottle_6": 15}
    },
    {
        "name": "Lemon Drop",
        "category": "signature",
        "description": "Vodka, triple sec & fresh lemon",
        "emoji": "🍋",
        "color": "#f0d000",
        "ingredients": {"bottle_1": 25, "bottle_2": 0, "bottle_3": 20, "bottle_4": 30, "bottle_5": 0, "bottle_6": 10}
    },
]


def _seed_recipes():
    """Insert default recipes only if the table is empty."""
    with get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM recipes").fetchone()[0]
        if count == 0:
            for r in DEFAULT_RECIPES:
                conn.execute(
                    """INSERT INTO recipes (name, category, description, emoji, color, ingredients)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (r["name"], r["category"], r["description"],
                     r["emoji"], r["color"], json.dumps(r["ingredients"]))
                )
            print(f"[DB] Seeded {len(DEFAULT_RECIPES)} default recipes.")


# ─────────────────────────────────────────────
#  RECIPES
# ─────────────────────────────────────────────

def get_all_recipes():
    """Return all active recipes as a list of dicts."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM recipes WHERE is_active = 1 ORDER BY category, name"
        ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["ingredients"] = json.loads(d["ingredients"])
        result.append(d)
    return result


def get_recipe_by_id(recipe_id):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM recipes WHERE id = ? AND is_active = 1", (recipe_id,)
        ).fetchone()
    if row:
        d = dict(row)
        d["ingredients"] = json.loads(d["ingredients"])
        return d
    return None


def get_recipe_by_name(name):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM recipes WHERE name = ? AND is_active = 1", (name,)
        ).fetchone()
    if row:
        d = dict(row)
        d["ingredients"] = json.loads(d["ingredients"])
        return d
    return None


# ─────────────────────────────────────────────
#  CUSTOM DRINKS
# ─────────────────────────────────────────────

def create_custom_drink(name, ingredients: dict):
    """
    Insert a new custom drink with expiry = now + CUSTOM_DRINK_EXPIRY_DAYS.
    Returns the new row id.
    """
    expires_at = datetime.now() + timedelta(days=CUSTOM_DRINK_EXPIRY_DAYS)
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO custom_drinks (name, ingredients, expires_at)
               VALUES (?, ?, ?)""",
            (name, json.dumps(ingredients), expires_at.isoformat())
        )
        return cursor.lastrowid


def get_all_custom_drinks():
    """Return all non-expired custom drinks."""
    _purge_expired_custom_drinks()
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT * FROM custom_drinks
               WHERE is_saved = 1 OR expires_at > CURRENT_TIMESTAMP
               ORDER BY times_ordered DESC, created_at DESC"""
        ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["ingredients"] = json.loads(d["ingredients"])
        result.append(d)
    return result


def get_custom_drink_by_id(custom_id):
    with get_connection() as conn:
        row = conn.execute(
            """SELECT * FROM custom_drinks WHERE id = ?
               AND (is_saved = 1 OR expires_at > CURRENT_TIMESTAMP)""",
            (custom_id,)
        ).fetchone()
    if row:
        d = dict(row)
        d["ingredients"] = json.loads(d["ingredients"])
        return d
    return None


def save_custom_drink_permanently(custom_id):
    """Mark a custom drink as saved so it never expires."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE custom_drinks SET is_saved = 1 WHERE id = ?", (custom_id,)
        )


def bump_custom_drink_expiry(custom_id):
    """Reset expiry to now + EXPIRY_DAYS when reordered."""
    new_expiry = datetime.now() + timedelta(days=CUSTOM_DRINK_EXPIRY_DAYS)
    with get_connection() as conn:
        conn.execute(
            """UPDATE custom_drinks
               SET expires_at = ?, times_ordered = times_ordered + 1
               WHERE id = ?""",
            (new_expiry.isoformat(), custom_id)
        )


def _purge_expired_custom_drinks():
    """Delete expired, unsaved custom drinks silently."""
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM custom_drinks WHERE is_saved = 0 AND expires_at <= CURRENT_TIMESTAMP"
        )


# ─────────────────────────────────────────────
#  ORDERS
# ─────────────────────────────────────────────

def create_order(recipe_name, ingredients, is_custom=False, recipe_id=None):
    """Insert a new order and return its id."""
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO orders (recipe_id, recipe_name, is_custom, ingredients, status)
               VALUES (?, ?, ?, ?, 'pending')""",
            (recipe_id, recipe_name, int(is_custom), json.dumps(ingredients))
        )
        return cursor.lastrowid


def update_order_status(order_id, status):
    """Update order status: pending | dispensing | done | aborted."""
    completed_at = None
    if status in ("done", "aborted"):
        completed_at = datetime.now().isoformat()
    with get_connection() as conn:
        conn.execute(
            "UPDATE orders SET status = ?, completed_at = ? WHERE id = ?",
            (status, completed_at, order_id)
        )


def get_recent_orders(limit=20):
    """Return the most recent orders for the admin view."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM orders ORDER BY ordered_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(row) for row in rows]


def get_order_by_id(order_id):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM orders WHERE id = ?", (order_id,)
        ).fetchone()
    return dict(row) if row else None


# ─────────────────────────────────────────────
#  BOTTLE CONFIG  (maps bottle slots to liquid names)
# ─────────────────────────────────────────────

def get_bottle_labels():
    """Bottle label map sourced from config.py."""
    return config.BOTTLE_LABELS


# ─────────────────────────────────────────────
#  ENTRY POINT  (run directly to init)
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("[DB] Tables ready.")
    recipes = get_all_recipes()
    print(f"[DB] {len(recipes)} recipes loaded:")
    for r in recipes:
        print(f"     {r['emoji']}  {r['name']} ({r['category']})")
