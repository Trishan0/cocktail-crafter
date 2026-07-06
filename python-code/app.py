"""
app.py — Flask Backend
Cocktail-Craft Bartender | Raspberry Pi

Serves the React kiosk UI via CORS-enabled API endpoints.
Uses Server-Sent Events (SSE) to push real-time machine status to the UI.
Communication with the ESP32 is via hardware_controller (wired USB/UART or simulator).
"""

import json
import queue
import threading
import time
import os
import uuid
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from werkzeug.utils import secure_filename
from flask_cors import CORS

import db
import hardware_controller
import machine_state as ms
import recipe_manager
import config

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}, r"/stream": {"origins": "*"}})
app.secret_key = config.SECRET_KEY

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads", "drinks")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# The active hardware controller — instantiated in create_app()
_controller: hardware_controller.HardwareController = None
_controller_lock = threading.Lock()


def _swap_controller(simulator: bool):
    """
    Stop the current controller, switch mode, and start a new one.
    Thread-safe: called from an admin API endpoint.
    """
    global _controller
    with _controller_lock:
        try:
            _controller.stop()
        except Exception:
            pass

        # Persist choice
        db.set_setting("simulator_mode", "1" if simulator else "0")
        config.SIMULATOR_MODE = simulator

        new_ctrl = hardware_controller.SimulatorController() if simulator else hardware_controller.SerialController()
        hardware_controller.register_status_callback(_on_status_change)
        hardware_controller.register_sensor_callback(_on_sensor_update)
        new_ctrl.start()
        _controller = new_ctrl
    print(f"[APP] Controller swapped -> {'SIMULATOR' if simulator else 'SERIAL'}")
    db.log_event("mode_change", "simulator" if simulator else "serial")


# ─────────────────────────────────────────────
#  SERVER-SENT EVENTS  (real-time push to UI)
# ─────────────────────────────────────────────

_sse_clients = []
_sse_lock    = threading.Lock()


def _push_event(event_type: str, data: dict):
    """Push an SSE event to all connected browser clients."""
    payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


def _on_status_change(state: dict):
    """Called by hardware_controller when the machine sends a STATUS update."""
    _push_event("status", {
        "machine_status": state["machine_status"],
        "progress":       state["progress"],
        "message":        state["message"],
        "order_id":       state["current_order_id"],
    })
    order_id = state.get("current_order_id")
    if order_id:
        if state["machine_status"] == "idle":
            # Only mark done if the machine successfully reached idle
            # and it wasn't already marked aborted/error.
            order = db.get_order_by_id(order_id)
            if order and order["status"] == "pending":
                recipe_manager.complete_order(order_id, "done")
        elif state["machine_status"] == "error":
            recipe_manager.complete_order(order_id, "error")
        elif state["machine_status"] == "aborted":
            recipe_manager.complete_order(order_id, "aborted")


def _on_sensor_update(state: dict):
    """Called by hardware_controller when the machine sends a SENSOR update."""
    _push_event("sensor", {
        "glass_state": state.get("glass_state", "no_glass"),
    })


# ─────────────────────────────────────────────
#  SSE STREAM ENDPOINT
# ─────────────────────────────────────────────

@app.route("/stream")
def stream():
    """SSE endpoint — the React UI connects here for real-time updates."""
    def event_generator():
        q = queue.Queue(maxsize=30)
        with _sse_lock:
            _sse_clients.append(q)

        # Send current state immediately on connect
        state = _controller.get_state()
        init_data = json.dumps({
            "machine_status": state["machine_status"],
            "progress":       state["progress"],
            "message":        state["message"],
            "glass_state":    state.get("glass_state", "no_glass"),
            "connected":      state["connected"],
        })
        yield f"event: init\ndata: {init_data}\n\n"

        try:
            while True:
                try:
                    msg = q.get(timeout=25)
                    yield msg
                except queue.Empty:
                    yield ": heartbeat\n\n"   # keep connection alive
        except GeneratorExit:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return Response(
        stream_with_context(event_generator()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )


# ─────────────────────────────────────────────
#  CUSTOMER API
# ─────────────────────────────────────────────

@app.route("/api/menu")
def api_menu():
    """Return visible recipes for the customer drink menu."""
    try:
        menu = recipe_manager.get_menu()
        return jsonify({"drinks": menu})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/order", methods=["POST"])
def api_place_order():
    """
    Place a drink order.
    Body: {"recipe_id": 1, "ice": false}

    Flow:
      1. Resolve recipe → pump commands (with duration_ms)
      2. Check machine is idle
      3. Save order to DB
      4. Send ORDER command to ESP32 via controller
      5. Push SSE event to UI
    """
    data      = request.get_json() or {}
    recipe_id = data.get("recipe_id")
    ice       = bool(data.get("ice", False))

    if not recipe_id:
        return jsonify({"error": "recipe_id is required."}), 400

    # Check machine is free — only accept orders from idle (or post-error/abort)
    state = _controller.get_state()
    if not ms.can_accept_order(state["machine_status"]):
        return jsonify({
            "error": f"Machine is busy ({state['machine_status']}). Please wait."
        }), 409

    order, error = recipe_manager.place_order(recipe_id=recipe_id)
    if error:
        return jsonify({"error": error}), 400

    # Send to ESP32 (or simulator)
    _controller.send_order(
        order_id=order["order_id"],
        recipe_name=order["recipe_name"],
        pump_commands=order["pump_commands"],
        ice=ice,
    )

    # Notify all UI clients immediately
    _push_event("order_placed", {
        "order_id":    order["order_id"],
        "recipe_name": order["recipe_name"],
        "pump_commands": order["pump_commands"],
    })

    return jsonify({
        "success":       True,
        "order_id":      order["order_id"],
        "recipe_name":   order["recipe_name"],
        "pump_commands": order["pump_commands"],
    })


@app.route("/api/order/custom", methods=["POST"])
def api_place_custom_order():
    """
    Place a custom drink order.
    Body: {"ingredients": [{"id": 1, "name": "Vodka", "amount_ml": 50}], "ice": false}
    """
    data        = request.get_json() or {}
    ingredients = data.get("ingredients")
    ice         = bool(data.get("ice", False))

    if not ingredients or not isinstance(ingredients, list):
        return jsonify({"error": "ingredients array is required."}), 400

    # Check machine is free
    state = _controller.get_state()
    if not ms.can_accept_order(state["machine_status"]):
        return jsonify({
            "error": f"Machine is busy ({state['machine_status']}). Please wait."
        }), 409

    order, error = recipe_manager.place_custom_order(ingredients=ingredients)
    if error:
        return jsonify({"error": error}), 400

    _controller.send_order(
        order_id=order["order_id"],
        recipe_name=order["recipe_name"],
        pump_commands=order["pump_commands"],
        ice=ice,
    )

    _push_event("order_placed", {
        "order_id":    order["order_id"],
        "recipe_name": order["recipe_name"],
        "pump_commands": order["pump_commands"],
    })

    return jsonify({
        "success":       True,
        "order_id":      order["order_id"],
        "recipe_name":   order["recipe_name"],
        "pump_commands": order["pump_commands"],
    })


@app.route("/api/abort", methods=["POST"])
def api_abort():
    """Emergency abort — stop all dispensing immediately."""
    _controller.send_abort()
    state    = _controller.get_state()
    order_id = state.get("current_order_id")
    if order_id:
        recipe_manager.complete_order(order_id, "aborted")
    return jsonify({"success": True, "message": "Abort signal sent."})


@app.route("/api/status")
def api_status():
    """Current machine + connection status."""
    state = _controller.get_state()
    return jsonify({
        "connected":      state["connected"],
        "machine_status": state["machine_status"],
        "progress":       state["progress"],
        "message":        state["message"],
        "glass_state":    state.get("glass_state", "no_glass"),
        "last_seen":      state["last_seen"],
    })


@app.route("/api/orders")
def api_orders():
    """Recent order history."""
    orders = recipe_manager.get_order_history(limit=30)
    return jsonify({"orders": orders})


# ─────────────────────────────────────────────
#  ADMIN API — Ingredients
# ─────────────────────────────────────────────

@app.route("/api/admin/ingredients", methods=["GET"])
def api_get_ingredients():
    """Return all known ingredients."""
    return jsonify({"ingredients": db.get_all_ingredients()})


@app.route("/api/admin/ingredients", methods=["POST"])
def api_create_ingredient():
    """Create a new ingredient. Body: {"name": "...", "description": "..."}"""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "name is required."}), 400
    try:
        ing_id = db.create_ingredient(name, data.get("description", ""))
        return jsonify({"success": True, "id": ing_id})
    except Exception as e:
        return jsonify({"error": f"Ingredient '{name}' may already exist. {e}"}), 409


@app.route("/api/admin/ingredients/<int:ingredient_id>", methods=["PUT"])
def api_update_ingredient(ingredient_id):
    """Update ingredient name/description. Body: {"name": "...", "description": "..."}"""
    data = request.get_json() or {}
    db.update_ingredient(
        ingredient_id,
        name=data.get("name"),
        description=data.get("description"),
    )
    return jsonify({"success": True})


@app.route("/api/admin/ingredients/<int:ingredient_id>", methods=["DELETE"])
def api_delete_ingredient(ingredient_id):
    """Delete an ingredient (also removes it from any recipes and pump assignments)."""
    db.delete_ingredient(ingredient_id)
    return jsonify({"success": True})


# ─────────────────────────────────────────────
#  ADMIN API — Pumps
# ─────────────────────────────────────────────

@app.route("/api/admin/pumps", methods=["GET"])
def api_get_pumps():
    """Return all 6 pump slots with their current assignment."""
    return jsonify({"pumps": db.get_all_pumps()})


@app.route("/api/admin/pumps/<int:pump_number>/assign", methods=["POST"])
def api_assign_pump(pump_number):
    """
    Assign an ingredient to a pump.
    Body: {"ingredient_id": 3}   (or null to unassign)
    """
    data          = request.get_json() or {}
    ingredient_id = data.get("ingredient_id")   # None = unassign
    db.assign_pump(pump_number, ingredient_id)
    return jsonify({"success": True})


@app.route("/api/admin/pumps/<int:pump_number>/flowrate", methods=["PUT"])
def api_update_flowrate(pump_number):
    """
    Update a pump's calibrated flow rate.
    Body: {"flow_rate_ml_per_s": 1.8}
    """
    data      = request.get_json() or {}
    flow_rate = data.get("flow_rate_ml_per_s")
    if flow_rate is None or float(flow_rate) <= 0:
        return jsonify({"error": "flow_rate_ml_per_s must be a positive number."}), 400
    db.update_pump_flow_rate(pump_number, float(flow_rate))
    return jsonify({"success": True})


# ─────────────────────────────────────────────
#  ADMIN API — Recipes
# ─────────────────────────────────────────────

@app.route("/api/admin/recipes", methods=["GET"])
def api_admin_get_recipes():
    """Return ALL recipes (visible and hidden) for the admin panel."""
    return jsonify({"recipes": db.get_all_recipes(visible_only=False)})


@app.route("/api/admin/recipes", methods=["POST"])
def api_create_recipe():
    """
    Create a new recipe.
    Body: {
        "name": "Mojito",
        "description": "...",
        "category": "classic",
        "price": 12.0,
        "ingredients": [
            {"ingredient_id": 1, "amount_ml": 50},
            {"ingredient_id": 4, "amount_ml": 25}
        ]
    }
    """
    data        = request.get_json() or {}
    name        = data.get("name", "").strip()
    description = data.get("description", "")
    category    = data.get("category", "classic")
    price       = float(data.get("price", 0.0))
    ingredients = data.get("ingredients", [])

    if not name:
        return jsonify({"error": "name is required."}), 400

    err = recipe_manager.validate_recipe_ingredients(ingredients)
    if err:
        return jsonify({"error": err}), 400

    try:
        recipe_id = db.create_recipe(name, description, category, price, ingredients)
        return jsonify({"success": True, "id": recipe_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 409


@app.route("/api/admin/recipes/<int:recipe_id>", methods=["PUT"])
def api_update_recipe(recipe_id):
    """
    Update a recipe. All fields optional.
    Body: {
        "name": "...",
        "description": "...",
        "category": "...",
        "price": 0.0,
        "is_visible": 1,
        "ingredients": [...]
    }
    """
    data        = request.get_json() or {}
    ingredients = data.get("ingredients")

    if ingredients is not None:
        err = recipe_manager.validate_recipe_ingredients(ingredients)
        if err:
            return jsonify({"error": err}), 400

    db.update_recipe(
        recipe_id,
        name=data.get("name"),
        description=data.get("description"),
        category=data.get("category"),
        price=data.get("price"),
        is_visible=data.get("is_visible"),
        ingredients=ingredients,
    )
    return jsonify({"success": True})


@app.route("/api/admin/recipes/<int:recipe_id>", methods=["DELETE"])
def api_delete_recipe(recipe_id):
    """Delete a recipe permanently."""
    db.delete_recipe(recipe_id)
    return jsonify({"success": True})


@app.route("/api/admin/recipes/<int:recipe_id>/image", methods=["POST"])
def api_upload_recipe_image(recipe_id):
    """Upload an image for a recipe."""
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    ext = file.filename.split('.')[-1] if '.' in file.filename else 'png'
    filename = f"{uuid.uuid4().hex}.{ext}"
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(file_path)

    image_url = f"/uploads/drinks/{filename}"
    db.update_recipe(recipe_id, image_url=image_url)

    return jsonify({"success": True, "image_url": image_url})


@app.route("/uploads/drinks/<path:filename>")
def serve_drink_image(filename):
    """Serve uploaded drink images."""
    return send_from_directory(UPLOAD_FOLDER, filename)


# ─────────────────────────────────────────────
#  ADMIN API — Machine Controls
# ─────────────────────────────────────────────

@app.route("/api/admin/mode", methods=["GET"])
def api_get_mode():
    """Return the current controller mode."""
    is_sim = isinstance(_controller, hardware_controller.SimulatorController)
    return jsonify({"simulator": is_sim})


@app.route("/api/admin/mode", methods=["POST"])
def api_set_mode():
    """
    Switch between simulator and live (serial) mode.
    Body: {"simulator": true|false}
    Only allowed when machine is idle.
    """
    state = _controller.get_state()
    if state["machine_status"] != "idle":
        return jsonify({"error": f"Cannot switch mode while machine is {state['machine_status']}."}), 409

    data = request.get_json() or {}
    if "simulator" not in data:
        return jsonify({"error": "Missing 'simulator' field."}), 400

    simulator = bool(data["simulator"])
    threading.Thread(target=_swap_controller, args=(simulator,), daemon=True, name="ctrl-swap").start()
    return jsonify({"ok": True, "simulator": simulator})


@app.route("/api/admin/events", methods=["GET"])
def api_get_events():
    """Get the most recent system events."""
    limit = int(request.args.get("limit", 50))
    events = db.get_recent_events(limit=limit)
    return jsonify(events)


@app.route("/api/admin/clean", methods=["POST"])
def api_clean():
    """
    Trigger a manual cleaning cycle (admin-initiated, line-only — no container wash).
    Body: {"mode": "all"} or {"mode": "single", "pump": 3}
    Only allowed when machine_status == "idle".
    """
    state = _controller.get_state()
    if state["machine_status"] != "idle":
        return jsonify({
            "error": f"Cannot clean while machine is {state['machine_status']}. Wait until idle."
        }), 409

    data = request.get_json() or {}
    mode = data.get("mode", "all")
    pump = data.get("pump")

    if mode == "single" and pump is None:
        return jsonify({"error": "pump number is required when mode is 'single'."}), 400

    _controller.send_clean(trigger="manual", mode=mode, pump=pump)
    pump_desc = f"pump {pump}" if mode == "single" else "all pumps"
    return jsonify({"success": True, "message": f"Manual clean ({pump_desc}) started."})


def get_admin_pin():
    """Helper to get the current PIN from DB, falling back to config default."""
    return db.get_setting("admin_pin", config.ADMIN_PIN)


@app.route("/api/admin/pin/verify", methods=["POST"])
def api_verify_pin():
    """Verify admin PIN. Body: {"pin": "1234"}"""
    data = request.get_json() or {}
    pin  = data.get("pin", "")
    if pin == get_admin_pin():
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Incorrect PIN."}), 401


@app.route("/api/admin/pin/change", methods=["POST"])
def api_change_pin():
    """
    Change admin PIN.
    Body: {"current_pin": "1234", "new_pin": "5678"}
    """
    data        = request.get_json() or {}
    current_pin = data.get("current_pin", "")
    new_pin     = data.get("new_pin", "")

    if current_pin != get_admin_pin():
        return jsonify({"error": "Current PIN is incorrect."}), 401
    if len(new_pin) != 4 or not new_pin.isdigit():
        return jsonify({"error": "New PIN must be exactly 4 digits."}), 400

    db.set_setting("admin_pin", new_pin)
    return jsonify({"success": True, "message": "PIN changed successfully."})


# ─────────────────────────────────────────────
#  STARTUP
# ─────────────────────────────────────────────

def create_app():
    global _controller

    db.init_db()

    # Seed simulator_mode from config if not already in DB
    if db.get_setting("simulator_mode") is None:
        db.set_setting("simulator_mode", "1" if config.SIMULATOR_MODE else "0")

    # Instantiate the correct controller based on config.SIMULATOR_MODE
    _controller = hardware_controller.create_controller()

    # Wire up callbacks so hardware events push to SSE clients
    hardware_controller.register_status_callback(_on_status_change)
    hardware_controller.register_sensor_callback(_on_sensor_update)

    _controller.start()
    return app


if __name__ == "__main__":
    application = create_app()
    print(f"[APP] Cocktail-Craft Bartender starting on http://localhost:{config.FLASK_PORT}")
    application.run(
        host=config.FLASK_HOST,
        port=config.FLASK_PORT,
        debug=False,
        threaded=True,
        use_reloader=False,   # must be False — hardware thread can't handle reloader
    )
