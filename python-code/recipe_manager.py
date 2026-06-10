"""
recipe_manager.py — Business Logic Layer
ATRIA Bartender | Raspberry Pi

Resolves recipes to physical pump commands (with duration_ms calculated
from the pump's calibrated flow rate), validates availability, and
manages order lifecycle.
"""

import db
import config


# ─────────────────────────────────────────────
#  PUMP COMMAND RESOLUTION
# ─────────────────────────────────────────────

def resolve_pump_commands(ingredients: list):
    """
    Given a list of ingredients [{"id": 1, "name": "Vodka", "amount_ml": 50}], 
    return the list of pump commands to send to the ESP32.

    Algorithm:
      1. Fetch current pump assignments (ingredient_id → pump_number + flow_rate)
      2. For each ingredient, find the assigned pump
      3. Calculate duration_ms = (amount_ml / flow_rate_ml_per_s) * 1000

    Returns:
      (commands, None)  on success
      (None, error_msg) if any required ingredient has no pump assigned
    """
    pump_map = db.get_pump_assignments()   # ingredient_id → {pump_number, flow_rate_ml_per_s}

    commands = []
    missing = []

    for ing in ingredients:
        amount_ml    = ing["amount_ml"]
        ing_id       = ing["id"]
        ing_name     = ing["name"]

        if amount_ml <= 0:
            continue

        pump_info = pump_map.get(ing_id)
        if not pump_info:
            missing.append(ing_name)
            continue

        flow_rate   = pump_info["flow_rate_ml_per_s"]
        duration_ms = int((amount_ml / flow_rate) * 1000)

        commands.append({
            "pump":        pump_info["pump_number"],
            "ingredient":  ing_name,
            "amount_ml":   amount_ml,
            "duration_ms": duration_ms,
        })

    if missing:
        return None, f"No pump assigned for: {', '.join(missing)}. Please configure pumps in Admin Panel."

    if not commands:
        return None, "Recipe has no valid ingredients."

    # Sort by pump number for deterministic order
    commands.sort(key=lambda c: c["pump"])
    return commands, None


# ─────────────────────────────────────────────
#  ORDER PLACEMENT
# ─────────────────────────────────────────────

def place_order(recipe_id: int):
    """
    Validate and create an order.

    Returns:
      (order_dict, None)      on success
      (None, error_message)   on failure

    order_dict contains everything needed to send to the ESP32 and the UI.
    """
    # 1. Fetch recipe details
    recipe = db.get_recipe_by_id(recipe_id)
    if not recipe:
        return None, "Recipe not found."

    # 2. Resolve pump commands — this also validates pump assignments
    commands, error = resolve_pump_commands(recipe["ingredients"])
    if error:
        return None, error

    # 3. Persist order to DB
    order_id = db.create_order(
        recipe_id=recipe_id,
        recipe_name=recipe["name"],
        pump_commands=commands,
    )

    return {
        "order_id":    order_id,
        "recipe_id":   recipe_id,
        "recipe_name": recipe["name"],
        "pump_commands": commands,
    }, None


def place_custom_order(ingredients: list):
    """
    Validate and create a custom order.
    `ingredients` format: [{"id": 1, "name": "Vodka", "amount_ml": 50}, ...]
    """
    # 1. Validate total volume limits
    err = validate_recipe_ingredients(ingredients)
    if err:
        return None, err

    # 2. Resolve pump commands
    commands, error = resolve_pump_commands(ingredients)
    if error:
        return None, error

    # 3. Persist order to DB (no recipe_id)
    order_id = db.create_order(
        recipe_id=None,
        recipe_name="Custom Drink",
        pump_commands=commands,
    )

    return {
        "order_id":    order_id,
        "recipe_id":   None,
        "recipe_name": "Custom Drink",
        "pump_commands": commands,
    }, None


# ─────────────────────────────────────────────
#  ORDER STATUS
# ─────────────────────────────────────────────

def complete_order(order_id: int, status: str = "done"):
    """Mark an order as done, aborted, or error."""
    db.update_order_status(order_id, status)


def get_order_history(limit=20):
    return db.get_recent_orders(limit)


# ─────────────────────────────────────────────
#  MENU (customer-facing)
# ─────────────────────────────────────────────

def get_menu():
    """
    Return visible recipes formatted for the customer UI.
    Groups by category. Each recipe includes its ingredient list.
    """
    recipes = db.get_all_recipes(visible_only=True)

    # Enrich with pump-availability check
    pump_map = db.get_pump_assignments()
    assigned_ingredient_ids = set(pump_map.keys())

    enriched = []
    for r in recipes:
        # Check if ALL ingredients in this recipe have a pump assigned
        all_available = all(
            ing["id"] in assigned_ingredient_ids
            for ing in r["ingredients"]
            if ing["amount_ml"] > 0
        )
        enriched.append({**r, "available": all_available})

    return enriched


# ─────────────────────────────────────────────
#  VALIDATION HELPERS
# ─────────────────────────────────────────────

def validate_recipe_ingredients(ingredients: list):
    """
    Validate a list of {ingredient_id, amount_ml} pairs.
    Returns error string or None if valid.
    """
    if not ingredients:
        return "Recipe must have at least one ingredient."

    total = 0
    for ing in ingredients:
        amount = ing.get("amount_ml", 0)
        if amount < 0:
            return "Ingredient amount cannot be negative."
        if 0 < amount < config.MIN_ML_PER_INGREDIENT:
            return f"Minimum amount is {config.MIN_ML_PER_INGREDIENT}ml per ingredient."
        if amount > config.MAX_ML_PER_INGREDIENT:
            return f"Maximum amount is {config.MAX_ML_PER_INGREDIENT}ml per ingredient."
        total += amount

    if total == 0:
        return "Total recipe volume cannot be zero."
    if total > config.MAX_ML_TOTAL:
        return f"Total volume {total}ml exceeds maximum {config.MAX_ML_TOTAL}ml."

    return None
