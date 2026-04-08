"""
recipe_manager.py — Business Logic Layer
CocktailCraft | Raspberry Pi
Validates recipes, builds order payloads, checks bottle availability.
"""

import db

MAX_BOTTLE_ML   = 60    # max ml per bottle per drink
MIN_BOTTLE_ML   = 5     # ignore anything below this (treat as 0)
TOTAL_MAX_ML    = 180   # max total volume per drink


# ─────────────────────────────────────────────
#  RECIPE QUERIES
# ─────────────────────────────────────────────

def get_menu():
    """
    Return all recipes + custom drinks grouped by category.
    Used by the UI to render the drink menu.
    """
    recipes = db.get_all_recipes()
    customs = db.get_all_custom_drinks()

    grouped = {}
    for r in recipes:
        cat = r["category"].capitalize()
        grouped.setdefault(cat, []).append({**r, "is_custom": False})

    if customs:
        grouped["My Creations"] = [
            {**c, "is_custom": True, "color": "#9b59b6", "emoji": "✨"}
            for c in customs
        ]

    return grouped


def get_recipe_detail(recipe_id=None, custom_id=None):
    """Fetch a single recipe or custom drink by id."""
    if recipe_id is not None:
        recipe = db.get_recipe_by_id(recipe_id)
        if recipe:
            recipe["is_custom"] = False
        return recipe
    if custom_id is not None:
        custom = db.get_custom_drink_by_id(custom_id)
        if custom:
            custom["is_custom"] = True
        return custom
    return None


# ─────────────────────────────────────────────
#  CUSTOM DRINK CREATION
# ─────────────────────────────────────────────

def build_custom_drink(name: str, ingredient_map: dict):
    """
    Validate and save a custom drink.
    ingredient_map: {"bottle_1": 25, "bottle_2": 0, ...}
    Returns: (custom_id, None) on success  |  (None, error_message) on failure
    """
    name = name.strip()
    if not name:
        return None, "Drink name cannot be empty."
    if len(name) > 40:
        return None, "Drink name is too long (max 40 characters)."

    cleaned = _validate_ingredients(ingredient_map)
    if isinstance(cleaned, str):
        return None, cleaned   # error message

    custom_id = db.create_custom_drink(name, cleaned)
    return custom_id, None


def _validate_ingredients(ingredient_map: dict):
    """
    Sanitize and validate ingredient volumes.
    Returns cleaned dict or an error string.
    """
    bottles = db.get_bottle_labels()
    cleaned = {}
    total   = 0

    for key in bottles:
        raw = ingredient_map.get(key, 0)
        try:
            ml = int(raw)
        except (ValueError, TypeError):
            ml = 0

        if ml < 0:
            ml = 0
        if ml > MAX_BOTTLE_ML:
            return f"Max {MAX_BOTTLE_ML}ml per bottle. '{key}' exceeds this."
        if 0 < ml < MIN_BOTTLE_ML:
            ml = 0   # snap tiny values to 0

        cleaned[key] = ml
        total += ml

    if total == 0:
        return "Please add at least one ingredient."
    if total > TOTAL_MAX_ML:
        return f"Total volume exceeds {TOTAL_MAX_ML}ml. Current total: {total}ml."

    return cleaned


# ─────────────────────────────────────────────
#  ORDER BUILDING
# ─────────────────────────────────────────────

def place_order(recipe_id=None, custom_id=None, options=None):
    """
    Validate availability and create an order.
    options: {"ice": bool, "lime": bool}
    Returns: (order_dict, None) | (None, error_message)
    """
    options = options or {"ice": False, "lime": False}

    # ── Fetch the drink ───────────────────────
    if recipe_id is not None:
        drink = db.get_recipe_by_id(recipe_id)
        is_custom = False
    elif custom_id is not None:
        drink = db.get_custom_drink_by_id(custom_id)
        is_custom = True
    else:
        return None, "No recipe or custom drink specified."

    if not drink:
        return None, "Drink not found."

    ingredients = drink["ingredients"]

    # ── Check bottle availability ─────────────
    bottle_levels = _get_bottle_levels()
    unavailable   = check_bottle_availability(ingredients, bottle_levels)
    if unavailable:
        labels = db.get_bottle_labels()
        names  = [labels.get(b, b) for b in unavailable]
        return None, f"Ingredient(s) unavailable or empty: {', '.join(names)}"

    # ── Create order record ───────────────────
    order_id = db.create_order(
        recipe_name=drink["name"],
        ingredients=ingredients,
        is_custom=is_custom,
        recipe_id=recipe_id,
    )

    # ── Bump custom drink expiry ──────────────
    if is_custom and custom_id:
        db.bump_custom_drink_expiry(custom_id)

    order = {
        "order_id":    order_id,
        "recipe_name": drink["name"],
        "ingredients": ingredients,
        "options":     options,
        "is_custom":   is_custom,
    }

    return order, None


def _get_bottle_levels():
    """
    Import here to avoid circular import.
    Pull current bottle state from mqtt_client's shared state.
    """
    try:
        import mqtt_client
        return mqtt_client.get_state().get("bottle_levels", {})
    except Exception:
        # If MQTT not ready, assume all bottles full
        return {f"bottle_{i}": True for i in range(1, 7)}


def check_bottle_availability(ingredients: dict, bottle_levels: dict):
    """
    Returns a list of bottle keys that are needed but marked empty.
    Empty list = all good.
    """
    unavailable = []
    for bottle, ml in ingredients.items():
        if ml > 0:
            if not bottle_levels.get(bottle, True):
                unavailable.append(bottle)
    return unavailable


# ─────────────────────────────────────────────
#  ORDER STATUS
# ─────────────────────────────────────────────

def complete_order(order_id, status="done"):
    """Mark order as done or aborted."""
    db.update_order_status(order_id, status)


def get_order_history(limit=20):
    return db.get_recent_orders(limit)
