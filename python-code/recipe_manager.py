"""
recipe_manager.py — Business Logic Layer
Cocktail-Craft Bartender | Raspberry Pi

Resolves recipes to physical pump commands (with duration_ms calculated
from the pump's calibrated flow rate), validates availability, and
manages order lifecycle.
"""

import json

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

    commands_by_pump = {}
    missing = []

    for ing in ingredients:
        amount_ml = ing["amount_ml"]
        ing_id = ing["id"]
        ing_name = ing["name"]

        if amount_ml <= 0:
            continue

        pump_info = pump_map.get(ing_id)
        if not pump_info:
            missing.append(ing_name)
            continue

        flow_rate = float(pump_info["flow_rate_ml_per_s"])
        if flow_rate <= 0:
            return None, f"Pump {pump_info['pump_number']} has an invalid flow-rate calibration."

        pump_number = int(pump_info["pump_number"])
        duration_ms = round((float(amount_ml) / flow_rate) * 1000)
        existing = commands_by_pump.get(pump_number)
        if existing:
            # A duplicate ingredient in a custom recipe must still become one
            # pump entry: the ESP32 rejects duplicate ``pump`` values.
            existing["amount_ml"] += amount_ml
            existing["duration_ms"] += duration_ms
        else:
            commands_by_pump[pump_number] = {
                "pump": pump_number,
                "ingredient": ing_name,
                "amount_ml": amount_ml,
                "duration_ms": duration_ms,
            }

    if missing:
        return None, f"No pump assigned for: {', '.join(missing)}. Please configure pumps in Admin Panel."

    commands = list(commands_by_pump.values())
    if not commands:
        return None, "Recipe has no valid ingredients."

    too_long = [str(command["pump"]) for command in commands if not 1 <= command["duration_ms"] <= config.MAX_PUMP_TIME_MS]
    if too_long:
        return None, (
            f"Pump run time for pump(s) {', '.join(too_long)} is outside the firmware limit "
            f"of 1-{config.MAX_PUMP_TIME_MS} ms. Recalibrate the pump or reduce the amount."
        )

    # Sort by pump number for deterministic order
    commands.sort(key=lambda c: c["pump"])
    return commands, None


# ─────────────────────────────────────────────
#  ORDER PLACEMENT
# ─────────────────────────────────────────────

def prepare_order(recipe_id: int):
    """Resolve a recipe into a validated, but not yet persisted, order."""
    recipe = db.get_recipe_by_id(recipe_id)
    if not recipe:
        return None, "Recipe not found."

    commands, error = resolve_pump_commands(recipe["ingredients"])
    if error:
        return None, error

    return {
        "recipe_id": recipe_id,
        "recipe_name": recipe["name"],
        "pump_commands": commands,
        "price": recipe.get("price", 0.0),
        "ingredients_snapshot": recipe.get("ingredients", []),
    }, None


def prepare_custom_order(ingredients: list):
    """Resolve a custom drink into a validated, but not persisted, order."""
    err = validate_recipe_ingredients(ingredients)
    if err:
        return None, err

    commands, error = resolve_pump_commands(ingredients)
    if error:
        return None, error

    return {
        "recipe_id": None,
        "recipe_name": "Custom Drink",
        "pump_commands": commands,
        "price": 0.0,
        "ingredients_snapshot": ingredients,
    }, None


def persist_prepared_order(prepared_order: dict):
    """Create an order only after hardware availability checks have passed."""
    order_id = db.create_order(
        recipe_id=prepared_order["recipe_id"],
        recipe_name=prepared_order["recipe_name"],
        pump_commands=prepared_order["pump_commands"],
        price=prepared_order["price"],
        ingredients_snapshot=prepared_order["ingredients_snapshot"],
    )
    return {**prepared_order, "order_id": order_id}


def validate_liquid_availability(pump_commands: list, liquid_levels: dict):
    """Validate only the pumps used by an order against sensor + volume data.

    ``CHECK_LEVELS`` always returns six raw values, but unrelated pumps are
    intentionally ignored. A pump must (1) physically read above its configured
    baseline and (2) have enough admin-tracked volume for this drink. The
    baseline is a start-of-order threshold; it is not an additional amount that
    must remain after dispensing.
    """
    pump_configs = {int(p["pump_number"]): p for p in db.get_all_pumps()}
    errors = []

    for command in pump_commands:
        pump_number = int(command["pump"])
        required_ml = float(command["amount_ml"])
        pump = pump_configs.get(pump_number)
        if not pump:
            errors.append(f"Pump {pump_number} is not configured.")
            continue

        ingredient = pump.get("ingredient_name") or f"Pump {pump_number}"
        baseline_ml = float(pump.get("baseline_volume_ml") or 0)
        current_ml = float(pump.get("current_volume_ml") or 0)
        above_value = pump.get("level_above_baseline_value")
        raw_level = liquid_levels.get(f"ls{pump_number}")

        if above_value not in (0, 1):
            errors.append(f"{ingredient} (pump {pump_number}) has no liquid-sensor polarity configured.")
        elif raw_level not in (0, 1):
            errors.append(f"{ingredient} (pump {pump_number}) returned no valid liquid-level reading.")
        elif raw_level != above_value:
            errors.append(f"{ingredient} (pump {pump_number}) is not above its {baseline_ml:g} ml baseline.")

        if current_ml < baseline_ml:
            errors.append(f"{ingredient} (pump {pump_number}) estimate is below its {baseline_ml:g} ml baseline.")
        elif current_ml < required_ml:
            errors.append(
                f"{ingredient} (pump {pump_number}) has an estimated {current_ml:g} ml, "
                f"but this drink needs {required_ml:g} ml."
            )

    return "; ".join(errors) if errors else None


def place_order(recipe_id: int):
    """Legacy helper: prepare and immediately persist a recipe order."""
    prepared, error = prepare_order(recipe_id)
    if error:
        return None, error
    return persist_prepared_order(prepared), None


def place_custom_order(ingredients: list):
    """
    Validate and create a custom order.
    `ingredients` format: [{"id": 1, "name": "Vodka", "amount_ml": 50}, ...]
    """
    prepared, error = prepare_custom_order(ingredients)
    if error:
        return None, error
    return persist_prepared_order(prepared), None


# ─────────────────────────────────────────────
#  ORDER STATUS
# ─────────────────────────────────────────────

def complete_order(order_id: int, status: str = "done"):
    """Mark an order as done, aborted, or error."""
    if status == "done":
        order = db.get_order_by_id(order_id)
        if order and order["status"] == "pending":
            try:
                db.deduct_pump_inventory(json.loads(order["pump_commands"] or "[]"))
            except (TypeError, ValueError):
                # Status completion must not fail if an old order has an invalid snapshot.
                pass
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
