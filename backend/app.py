"""
app.py — Flask Backend
Cocktail-Craft Bartender | Raspberry Pi

Serves the React kiosk UI via CORS-enabled API endpoints.
Uses Server-Sent Events (SSE) to push real-time machine status to the UI.
Communication with the ESP32 is via hardware_controller (wired USB/UART or simulator).
"""

import json
import math
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


def _is_powered_on() -> bool:
    return bool(db.get_setting("machine_powered_on", False))


def _power_state_payload() -> dict:
    return {"powered_on": _is_powered_on()}


def _connection_error(state: dict) -> str | None:
    """Return the connection prerequisite that currently prevents an ORDER."""
    if not state.get("connected"):
        return "ESP32 is not connected. Please contact staff."
    return None

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


def _pump_inventory_payload() -> dict:
    pumps = db.get_all_pumps()
    margin = float(config.LIQUID_RESERVE_MARGIN_ML)
    enriched = [
        {
            **pump,
            "orderable_volume_ml": max(0.0, float(pump.get("current_volume_ml") or 0) - margin),
        }
        for pump in pumps
    ]
    return {"pumps": enriched, "reserve_margin_ml": margin}


def _push_inventory_event():
    """Keep the kiosk and an open Admin panel in sync after any volume change."""
    try:
        _push_event("inventory", _pump_inventory_payload())
    except Exception as exc:
        # A UI refresh failure must never turn an already-submitted order into
        # an HTTP error or alter its inventory reservation.
        print(f"[APP] Could not publish inventory update: {exc}")


def _on_status_change(state: dict):
    """Called by hardware_controller when the machine sends a STATUS update."""
    _push_event("status", {
        "machine_status": state["machine_status"],
        "progress":       state["progress"],
        "message":        state["message"],
        "order_id":       state["current_order_id"],
        "connected":      state.get("connected", False),
        "firmware_ready": state.get("firmware_ready", False),
        "required_glass": state.get("required_glass"),
        "order_volume_ml": state.get("order_volume_ml"),
        "powered_on":     _is_powered_on(),
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
    """Forward raw firmware sensor-query values to SSE clients."""
    _push_event("sensor", {
        "glass_state":  state.get("glass_state", "unknown"),
        "lower_sensor": state.get("lower_sensor", False),
        "upper_sensor": state.get("upper_sensor", False),
        "liquid_levels": state.get("liquid_levels", {}),
        "fluid_lines_primed": state.get("fluid_lines_primed"),
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
            "glass_state":    state.get("glass_state", "unknown"),
            "lower_sensor":   state.get("lower_sensor", False),
            "upper_sensor":   state.get("upper_sensor", False),
            "liquid_levels":  state.get("liquid_levels", {}),
            "fluid_lines_primed": state.get("fluid_lines_primed"),
            "connected":      state["connected"],
            "firmware_ready": state.get("firmware_ready", False),
            "required_glass": state.get("required_glass"),
            "order_volume_ml": state.get("order_volume_ml"),
            "powered_on":     _is_powered_on(),
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
#  DEV PANEL API
# ─────────────────────────────────────────────

@app.route("/api/dev/simulate-message", methods=["POST"])
def api_dev_simulate_message():
    """Simulate a hardware message (STATUS or SENSOR) via UI DevPanel."""
    data = request.get_json() or {}
    msg_type = data.get("type", "").upper()
    try:
        if msg_type == "STATUS":
            hardware_controller._handle_status(data)
        elif msg_type == "SENSOR":
            hardware_controller._handle_sensor(data)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
#  CUSTOMER API
# ─────────────────────────────────────────────

def _validate_order_liquids(pump_commands: list):
    """Run the ESP32 threshold check before persisting or starting an order."""
    try:
        levels = _controller.read_liquid_levels()
    except Exception as exc:
        return f"Could not verify liquid levels: {exc}", 503

    availability_error = recipe_manager.validate_liquid_availability(pump_commands, levels)
    if availability_error:
        return availability_error, 409
    return None, None

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
      3. Check each required raw level sensor and tracked volume + 15 ml reserve
      4. Atomically deduct the recipe amounts and save the order
      5. Send ORDER to ESP32; restore the deduction if the send fails
      6. Poll the verified IR sensors after the initialized response; send
         START automatically only when a valid glass is detected.
    """
    data      = request.get_json() or {}
    recipe_id = data.get("recipe_id")
    ice       = bool(data.get("ice", False))

    if not recipe_id:
        return jsonify({"error": "recipe_id is required."}), 400

    if not _is_powered_on():
        return jsonify({"error": "Machine is powered off. Please ask staff to power it on."}), 409

    # Check machine is free — only accept orders from idle (or post-error/abort)
    state = _controller.get_state()
    connection_error = _connection_error(state)
    if connection_error:
        return jsonify({"error": connection_error}), 503
    if not ms.can_accept_order(state["machine_status"]):
        return jsonify({
            "error": f"Machine is busy ({state['machine_status']}). Please wait."
        }), 409

    prepared_order, error = recipe_manager.prepare_order(recipe_id=recipe_id)
    if error:
        return jsonify({"error": error}), 400

    error, status_code = _validate_order_liquids(prepared_order["pump_commands"])
    if error:
        return jsonify({"error": error}), status_code

    inventory_error = recipe_manager.reserve_liquid_inventory(prepared_order["pump_commands"])
    if inventory_error:
        return jsonify({"error": inventory_error}), 409

    order = None
    try:
        order = recipe_manager.persist_prepared_order(prepared_order)
        # The firmware owns its persistent feed-line priming state. Do not add
        # extra per-pump time on the Pi side.
        _controller.send_order(
            order_id=order["order_id"],
            recipe_name=order["recipe_name"],
            pump_commands=order["pump_commands"],
            ice=ice,
            total_volume_ml=order["total_volume_ml"],
        )
    except Exception as exc:
        recipe_manager.restore_liquid_inventory(prepared_order["pump_commands"])
        if order:
            recipe_manager.complete_order(order["order_id"], "error")
        _push_inventory_event()
        return jsonify({"error": f"Could not initialize order: {exc}"}), 503
    _push_inventory_event()
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

    if not _is_powered_on():
        return jsonify({"error": "Machine is powered off. Please ask staff to power it on."}), 409

    # Check machine is free
    state = _controller.get_state()
    connection_error = _connection_error(state)
    if connection_error:
        return jsonify({"error": connection_error}), 503
    if not ms.can_accept_order(state["machine_status"]):
        return jsonify({
            "error": f"Machine is busy ({state['machine_status']}). Please wait."
        }), 409

    prepared_order, error = recipe_manager.prepare_custom_order(ingredients=ingredients)
    if error:
        return jsonify({"error": error}), 400

    error, status_code = _validate_order_liquids(prepared_order["pump_commands"])
    if error:
        return jsonify({"error": error}), status_code

    inventory_error = recipe_manager.reserve_liquid_inventory(prepared_order["pump_commands"])
    if inventory_error:
        return jsonify({"error": inventory_error}), 409

    order = None
    try:
        order = recipe_manager.persist_prepared_order(prepared_order)
        _controller.send_order(
            order_id=order["order_id"],
            recipe_name=order["recipe_name"],
            pump_commands=order["pump_commands"],
            ice=ice,
            total_volume_ml=order["total_volume_ml"],
        )
    except Exception as exc:
        recipe_manager.restore_liquid_inventory(prepared_order["pump_commands"])
        if order:
            recipe_manager.complete_order(order["order_id"], "error")
        _push_inventory_event()
        return jsonify({"error": f"Could not initialize order: {exc}"}), 503
    _push_inventory_event()
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
    """Request the firmware's limited STOP behavior.

    STOP is not an emergency stop: the supplied firmware only requests that
    the oscillator complete its current leg and stops an active ice task.  It
    does not stop pumps, indexing, priming, valve movement, or reversal.
    """
    try:
        _controller.send_stop_request()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 503
    return jsonify({
        "success": True,
        "message": "STOP requested. Use the physical emergency-stop hardware for an immediate full halt.",
    })


@app.route("/api/status")
def api_status():
    """Current machine + connection status."""
    state = _controller.get_state()
    return jsonify({
        "connected":      state["connected"],
        "machine_status": state["machine_status"],
        "progress":       state["progress"],
        "message":        state["message"],
        "glass_state":    state.get("glass_state", "unknown"),
        "lower_sensor":   state.get("lower_sensor", False),
        "upper_sensor":   state.get("upper_sensor", False),
        "liquid_levels":  state.get("liquid_levels", {}),
        "fluid_lines_primed": state.get("fluid_lines_primed"),
        "required_glass": state.get("required_glass"),
        "order_volume_ml": state.get("order_volume_ml"),
        "last_seen":      state["last_seen"],
        "firmware_ready": state.get("firmware_ready", False),
        "powered_on":     _is_powered_on(),
    })


@app.route("/api/hardware/query", methods=["POST"])
def api_hardware_query():
    """Request one documented raw-sensor/state response from the ESP32."""
    data = request.get_json(silent=True) or {}
    command = str(data.get("command", "")).upper()
    if command not in {"CHECK_IR", "CHECK_LEVELS", "CHECK_LINE_STATE"}:
        return jsonify({"error": "command must be CHECK_IR, CHECK_LEVELS, or CHECK_LINE_STATE."}), 400
    try:
        _controller.query_sensors(command)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 503
    return jsonify({"success": True, "command": command})


@app.route("/api/admin/hardware/debug", methods=["POST"])
def api_admin_hardware_debug():
    """Run a documented, allow-listed ESP32 diagnostic command from Admin."""
    data = request.get_json(silent=True) or {}
    command = str(data.get("command", "")).upper()
    allowed = {"CHECK_IR", "CHECK_LEVELS", "CHECK_LINE_STATE", "ICE_STATUS", "ICE", "ICE_SET_OPEN", "ICE_SET_CLOSED"}
    if command not in allowed:
        return jsonify({"error": "Unsupported diagnostic command."}), 400

    # The firmware itself enforces this for ice commands. Reject it on the Pi
    # as well, so an accidental Admin click cannot start/alter ice mid-order.
    if command in {"ICE", "ICE_SET_OPEN", "ICE_SET_CLOSED"} and _controller.get_state()["machine_status"] != "idle":
        return jsonify({"error": "Ice diagnostics are available only while the machine is idle."}), 409

    try:
        _controller.send_debug_command(command)
        db.log_event("admin:hardware_debug", command)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 503
    return jsonify({"success": True, "command": command, "message": f"{command} sent. Check the diagnostic log for the ESP32 reply."})


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

def _pump_configuration_busy_error():
    if _controller is not None and _controller.get_state()["machine_status"] != "idle":
        return jsonify({"error": "Pump and bottle settings cannot be changed while an order or maintenance operation is active."}), 409
    return None

@app.route("/api/admin/pumps", methods=["GET"])
def api_get_pumps():
    """Return all 6 pump slots with their current assignment."""
    return jsonify(_pump_inventory_payload())


@app.route("/api/admin/pumps/<int:pump_number>/assign", methods=["POST"])
def api_assign_pump(pump_number):
    """
    Assign an ingredient to a pump.
    Body: {"ingredient_id": 3}   (or null to unassign)
    """
    busy_error = _pump_configuration_busy_error()
    if busy_error:
        return busy_error
    data          = request.get_json() or {}
    ingredient_id = data.get("ingredient_id")   # None = unassign
    try:
        db.assign_pump(pump_number, ingredient_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"success": True})


@app.route("/api/admin/pumps/<int:pump_number>/flowrate", methods=["PUT"])
def api_update_flowrate(pump_number):
    """
    Update a pump's calibrated flow rate.
    Body: {"flow_rate_ml_per_s": 1.8}
    """
    busy_error = _pump_configuration_busy_error()
    if busy_error:
        return busy_error
    data      = request.get_json() or {}
    flow_rate = data.get("flow_rate_ml_per_s")
    if flow_rate is None or float(flow_rate) <= 0:
        return jsonify({"error": "flow_rate_ml_per_s must be a positive number."}), 400
    db.update_pump_flow_rate(pump_number, float(flow_rate))
    return jsonify({"success": True})


@app.route("/api/admin/pumps/<int:pump_number>/inventory", methods=["PUT"])
def api_update_pump_inventory(pump_number):
    """Set a pump's manually measured current bottle volume."""
    if not 1 <= pump_number <= config.NUM_PUMPS:
        return jsonify({"error": f"pump_number must be between 1 and {config.NUM_PUMPS}."}), 400
    busy_error = _pump_configuration_busy_error()
    if busy_error:
        return busy_error

    data = request.get_json() or {}
    try:
        current_volume_ml = float(data["current_volume_ml"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "current_volume_ml is required."}), 400

    if not math.isfinite(current_volume_ml) or current_volume_ml < 0:
        return jsonify({"error": "Current volume must be a non-negative finite number."}), 400

    db.update_pump_inventory(pump_number, current_volume_ml)
    _push_inventory_event()
    return jsonify({
        "success": True,
        "pump_number": pump_number,
        "current_volume_ml": current_volume_ml,
        "orderable_volume_ml": max(0.0, current_volume_ml - config.LIQUID_RESERVE_MARGIN_ML),
        "reserve_margin_ml": config.LIQUID_RESERVE_MARGIN_ML,
    })


@app.route("/api/admin/hardware/liquid-level-config", methods=["GET", "PUT"])
def api_liquid_level_config():
    """Read or calibrate the single raw polarity shared by all level sensors."""
    if request.method == "GET":
        return jsonify({
            "above_value": db.get_setting("liquid_level_above_value"),
        })

    data = request.get_json() or {}
    try:
        above_value = int(data["above_value"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "above_value must be 0 (LOW) or 1 (HIGH)."}), 400
    if above_value not in {0, 1}:
        return jsonify({"error": "above_value must be 0 (LOW) or 1 (HIGH)."}), 400
    db.set_setting("liquid_level_above_value", above_value)
    return jsonify({"success": True, "above_value": above_value})


@app.route("/api/admin/hardware/glass-capacity", methods=["GET", "PUT"])
def api_glass_capacity_config():
    """Read or set the safe liquid capacity of the physically small glass."""
    if request.method == "GET":
        raw_capacity = db.get_setting("small_glass_max_ml", config.DEFAULT_SMALL_GLASS_MAX_ML)
        try:
            capacity = float(raw_capacity)
        except (TypeError, ValueError):
            capacity = float(config.DEFAULT_SMALL_GLASS_MAX_ML)
        return jsonify({"small_glass_max_ml": capacity})

    data = request.get_json() or {}
    try:
        capacity = float(data["small_glass_max_ml"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "small_glass_max_ml is required."}), 400
    if not math.isfinite(capacity) or not 0 < capacity <= config.MAX_ML_TOTAL:
        return jsonify({
            "error": f"small_glass_max_ml must be greater than 0 and no more than {config.MAX_ML_TOTAL} ml."
        }), 400

    db.set_setting("small_glass_max_ml", capacity)
    return jsonify({"success": True, "small_glass_max_ml": capacity})


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


@app.route("/api/admin/power", methods=["GET"])
def api_get_power():
    """Return admin-controlled soft power state."""
    return jsonify(_power_state_payload())


@app.route("/api/admin/power", methods=["POST"])
def api_set_power():
    """
    Toggle admin-controlled machine power.
    Power off is allowed only while idle and reverses the pump lines without running a rinse cycle.
    """
    state = _controller.get_state()
    if state["machine_status"] != "idle":
        return jsonify({"error": f"Cannot change power while machine is {state['machine_status']}."}), 409

    data = request.get_json() or {}
    if "powered_on" not in data:
        return jsonify({"error": "Missing 'powered_on' field."}), 400

    powered_on = bool(data["powered_on"])
    if powered_on:
        try:
            _controller.send_power(True)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 503
        db.set_setting("machine_powered_on", True)
        db.log_event("power:on")
    else:
        try:
            _controller.send_power(False)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 503
        db.set_setting("machine_powered_on", False)
        db.log_event("power:off", "REVERSE_PUMPS (firmware fixed 4000 ms per pump)")

    payload = _power_state_payload()
    _push_event("power", payload)
    return jsonify({"success": True, **payload})

@app.route("/api/admin/events", methods=["GET"])
def api_get_events():
    """Get the most recent system events."""
    limit = int(request.args.get("limit", 50))
    events = db.get_recent_events(limit=limit)
    return jsonify(events)


@app.route("/api/admin/clean", methods=["POST"])
def api_clean():
    """Run CLEAN while idle or while a firmware-initialized order is pending."""
    state = _controller.get_state()
    if state["machine_status"] not in {"idle", "waiting_glass"}:
        return jsonify({
            "error": f"Cannot clean while machine is {state['machine_status']}. Wait until idle or order initialization."
        }), 409

    data = request.get_json(silent=True) or {}
    if data.get("mode", "all") != "all" or data.get("pump") is not None:
        return jsonify({
            "error": "This firmware has no single-pump clean/test command. CLEAN runs pump 1 for 5000 ms."
        }), 400

    try:
        _controller.send_clean()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 503

    return jsonify({"success": True, "message": "CLEAN started (pump 1 for 5000 ms, then mixing and valve opening)."})


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

    if db.get_setting("machine_powered_on") is None:
        db.set_setting("machine_powered_on", False)
    # Seed simulator_mode from config if not already in DB
    if db.get_setting("simulator_mode") is None:
        db.set_setting("simulator_mode", "1" if config.SIMULATOR_MODE else "0")
    if db.get_setting("small_glass_max_ml") is None:
        db.set_setting("small_glass_max_ml", config.DEFAULT_SMALL_GLASS_MAX_ML)

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
