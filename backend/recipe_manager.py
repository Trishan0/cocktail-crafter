"""
recipe_manager.py — Business Logic Layer
Cocktail-Craft Bartender | Raspberry Pi

Resolves recipes to physical pump commands (with duration_ms calculated
from the pump's calibrated flow rate), validates availability, and
manages order lifecycle.
"""

import math

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

    # Saved recipes need the same physical-volume validation as custom ones.
    # The total is later used for the glass-capacity interlock.
    error = validate_recipe_ingredients(recipe["ingredients"])
    if error:
        return None, error

    commands, error = resolve_pump_commands(recipe["ingredients"])
    if error:
        return None, error

    return {
        "recipe_id": recipe_id,
        "recipe_name": recipe["name"],
        "pump_commands": commands,
        "total_volume_ml": sum(float(ingredient["amount_ml"]) for ingredient in recipe["ingredients"]),
        "price": recipe.get("price", 0.0),
        "ingredients_snapshot": recipe.get("ingredients", []),
    }, None


def prepare_custom_order(ingredients: list):
    """Resolve a custom drink into a validated, but not persisted, order."""
    canonical_ingredients, err = canonicalise_custom_ingredients(ingredients)
    if err:
        return None, err

    err = validate_recipe_ingredients(canonical_ingredients)
    if err:
        return None, err

    commands, error = resolve_pump_commands(canonical_ingredients)
    if error:
        return None, error

    return {
        "recipe_id": None,
        "recipe_name": "Custom Drink",
        "pump_commands": commands,
        "total_volume_ml": sum(float(ingredient["amount_ml"]) for ingredient in canonical_ingredients),
        "price": 0.0,
        "ingredients_snapshot": canonical_ingredients,
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
    intentionally ignored. A pump must (1) physically read above the one fixed
    sensor line shared by all bottles and (2) have enough admin-tracked volume
    for this drink plus the fixed reserve margin. The raw sensor and tracked
    estimate are independent checks; both must pass before an ORDER is sent.
    """
    pump_configs = {int(p["pump_number"]): p for p in db.get_all_pumps()}
    above_value = db.get_setting("liquid_level_above_value")
    errors = []

    for command in pump_commands:
        pump_number = int(command["pump"])
        required_ml = float(command["amount_ml"])
        pump = pump_configs.get(pump_number)
        if not pump:
            errors.append(f"Pump {pump_number} is not configured.")
            continue

        ingredient = pump.get("ingredient_name") or f"Pump {pump_number}"
        current_ml = float(pump.get("current_volume_ml") or 0)
        minimum_ml = required_ml + config.LIQUID_RESERVE_MARGIN_ML
        raw_level = liquid_levels.get(f"ls{pump_number}")

        if above_value not in (0, 1):
            errors.append("The shared liquid-level sensor polarity is not configured in Admin Hardware.")
        elif raw_level not in (0, 1):
            errors.append(f"{ingredient} (pump {pump_number}) returned no valid liquid-level reading.")
        elif raw_level != above_value:
            errors.append(f"{ingredient} (pump {pump_number}) is below its fixed liquid-level sensor line.")

        if current_ml < minimum_ml:
            errors.append(
                f"{ingredient} (pump {pump_number}) has {current_ml:g} ml tracked, but this "
                f"drink needs {required_ml:g} ml plus the {config.LIQUID_RESERVE_MARGIN_ML:g} ml "
                f"safety reserve ({minimum_ml:g} ml total). Refill the bottle or update its "
                "volume in Admin → Pumps."
            )

    return "; ".join(errors) if errors else None


def reserve_liquid_inventory(pump_commands: list):
    """Atomically deduct a placed order while preserving the safety margin."""
    shortages = db.reserve_pump_inventory(
        pump_commands,
        config.LIQUID_RESERVE_MARGIN_ML,
    )
    if not shortages:
        return None

    errors = []
    for shortage in shortages:
        errors.append(
            f"{shortage['ingredient']} (pump {shortage['pump']}) has "
            f"{shortage['current_ml']:g} ml tracked, but this drink needs "
            f"{shortage['required_ml']:g} ml plus the "
            f"{config.LIQUID_RESERVE_MARGIN_ML:g} ml safety reserve "
            f"({shortage['minimum_ml']:g} ml total). Refill the bottle or update its "
            "volume in Admin → Pumps."
        )
    return "; ".join(errors)


def restore_liquid_inventory(pump_commands: list):
    """Restore a reservation when the Pi could not send the order."""
    db.restore_pump_inventory(pump_commands)


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
    """Mark an order as done, aborted, or error.

    Inventory is reserved when the order is placed, before physical movement,
    so completion must never deduct it a second time.
    """
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

    # Enrich with assignment and Pi-tracked volume availability. The physical
    # fixed-level sensor is still checked synchronously when Confirm is pressed.
    pump_map = db.get_pump_assignments()

    enriched = []
    for r in recipes:
        availability_errors = []
        for ingredient in r["ingredients"]:
            amount_ml = float(ingredient["amount_ml"])
            if amount_ml <= 0:
                continue
            pump = pump_map.get(ingredient["id"])
            if not pump or not bool(pump.get("is_active")):
                availability_errors.append(f"{ingredient['name']} is not assigned to an active pump.")
                continue
            current_ml = float(pump.get("current_volume_ml") or 0)
            minimum_ml = amount_ml + config.LIQUID_RESERVE_MARGIN_ML
            if current_ml < minimum_ml:
                availability_errors.append(
                    f"{ingredient['name']} needs {minimum_ml:g} ml available "
                    f"({amount_ml:g} ml + {config.LIQUID_RESERVE_MARGIN_ML:g} ml reserve); "
                    f"{current_ml:g} ml is tracked."
                )
        enriched.append({
            **r,
            "available": not availability_errors,
            "availability_reason": " ".join(availability_errors) or None,
        })

    return enriched


# ─────────────────────────────────────────────
#  VALIDATION HELPERS
# ─────────────────────────────────────────────

def canonicalise_custom_ingredients(ingredients: list):
    """Trust database ingredient IDs, not the browser's ingredient names.

    Duplicate IDs are deliberately combined before limits are checked. This
    prevents two 100 ml entries for the same pump from bypassing the 100 ml
    per-ingredient safety limit.
    """
    if not isinstance(ingredients, list) or not ingredients:
        return None, "Custom drink needs at least one ingredient."

    grouped_amounts: dict[int, float] = {}
    for item in ingredients:
        if not isinstance(item, dict):
            return None, "Each custom ingredient must be an object."
        try:
            ingredient_id = int(item["id"])
            amount_ml = float(item["amount_ml"])
        except (KeyError, TypeError, ValueError):
            return None, "Each custom ingredient needs a valid id and amount_ml."
        if not math.isfinite(amount_ml):
            return None, "Ingredient amount must be a finite number."
        grouped_amounts[ingredient_id] = grouped_amounts.get(ingredient_id, 0.0) + amount_ml

    known_ingredients = db.get_ingredients_by_ids(list(grouped_amounts))
    unknown_ids = sorted(set(grouped_amounts) - set(known_ingredients))
    if unknown_ids:
        return None, f"Unknown ingredient id(s): {', '.join(map(str, unknown_ids))}."

    return [
        {
            "id": ingredient_id,
            "name": known_ingredients[ingredient_id]["name"],
            "amount_ml": amount_ml,
        }
        for ingredient_id, amount_ml in sorted(grouped_amounts.items())
    ], None

def validate_recipe_ingredients(ingredients: list):
    """
    Validate a list of {ingredient_id, amount_ml} pairs.
    Returns error string or None if valid.
    """
    if not ingredients:
        return "Recipe must have at least one ingredient."

    total = 0
    for ing in ingredients:
        try:
            amount = float(ing.get("amount_ml", 0))
        except (AttributeError, TypeError, ValueError):
            return "Ingredient amount must be a number."
        if not math.isfinite(amount):
            return "Ingredient amount must be a finite number."
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
