"""
app.py — Flask Backend
CocktailCraft | Raspberry Pi
Serves the kiosk web UI and handles all API routes.
Uses Server-Sent Events (SSE) to push real-time machine status to the UI.
"""

import json
import queue
import threading
import time
from flask import Flask, render_template, request, jsonify, Response, stream_with_context

import db
import mqtt_client
import recipe_manager

app = Flask(__name__, template_folder=".")
app.secret_key = "cocktailcraft_secret_2025"

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


def _on_status_change(state):
    """Called by mqtt_client when ESP32 sends a status update."""
    _push_event("status", {
        "machine_status": state["machine_status"],
        "progress":       state["progress"],
        "message":        state["message"],
        "order_id":       state["current_order_id"],
    })
    # If order completed/aborted, update DB
    order_id = state.get("current_order_id")
    if order_id and state["machine_status"] == "done":
        recipe_manager.complete_order(order_id, "done")
    elif order_id and state["machine_status"] == "error":
        recipe_manager.complete_order(order_id, "aborted")


def _on_sensor_update(state):
    """Called by mqtt_client when ESP32 sends sensor data."""
    _push_event("sensor", {
        "glass_present": state["glass_present"],
        "bottle_levels": state["bottle_levels"],
    })


# ─────────────────────────────────────────────
#  ROUTES — UI
# ─────────────────────────────────────────────

@app.route("/")
def index():
    """Main kiosk screen."""
    return render_template("index.html")


@app.route("/stream")
def stream():
    """SSE endpoint — browser connects here for real-time updates."""
    def event_generator():
        q = queue.Queue(maxsize=20)
        with _sse_lock:
            _sse_clients.append(q)

        # Send initial state immediately on connect
        state = mqtt_client.get_state()
        init_payload = json.dumps({
            "machine_status": state["machine_status"],
            "progress":       state["progress"],
            "message":        state["message"],
            "glass_present":  state["glass_present"],
            "bottle_levels":  state["bottle_levels"],
            "connected":      state["connected"],
        })
        yield f"event: init\ndata: {init_payload}\n\n"

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
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


# ─────────────────────────────────────────────
#  ROUTES — API
# ─────────────────────────────────────────────

@app.route("/api/menu")
def api_menu():
    """Return full menu grouped by category."""
    try:
        menu = recipe_manager.get_menu()
        bottle_labels = db.get_bottle_labels()
        return jsonify({"menu": menu, "bottle_labels": bottle_labels})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/recipes")
def api_recipes():
    """Return flat list of all built-in recipes."""
    try:
        recipes = db.get_all_recipes()
        return jsonify({"recipes": recipes})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/recipe/<int:recipe_id>")
def api_recipe_detail(recipe_id):
    recipe = recipe_manager.get_recipe_detail(recipe_id=recipe_id)
    if not recipe:
        return jsonify({"error": "Recipe not found"}), 404
    return jsonify(recipe)


@app.route("/api/order", methods=["POST"])
def api_place_order():
    """
    Place a drink order.
    Body: {
        "recipe_id": 1,          // OR custom_id
        "custom_id": null,
        "options": {"ice": true, "lime": false}
    }
    """
    data       = request.get_json() or {}
    recipe_id  = data.get("recipe_id")
    custom_id  = data.get("custom_id")
    options    = data.get("options", {"ice": False, "lime": False})

    # Check machine is idle
    state = mqtt_client.get_state()
    if state["machine_status"] not in ("idle", "done", "error"):
        return jsonify({
            "error": f"Machine is busy ({state['machine_status']}). Please wait."
        }), 409

    order, error = recipe_manager.place_order(
        recipe_id=recipe_id,
        custom_id=custom_id,
        options=options,
    )
    if error:
        return jsonify({"error": error}), 400

    # Publish to ESP32 via MQTT
    mqtt_client.publish_order(
        order_id=order["order_id"],
        recipe_name=order["recipe_name"],
        ingredients=order["ingredients"],
        options=order["options"],
    )

    # Push SSE to UI immediately
    _push_event("order_placed", {
        "order_id":    order["order_id"],
        "recipe_name": order["recipe_name"],
        "options":     order["options"],
    })

    return jsonify({
        "success":     True,
        "order_id":    order["order_id"],
        "recipe_name": order["recipe_name"],
    })


@app.route("/api/abort", methods=["POST"])
def api_abort():
    """Emergency abort — stop all dispensing immediately."""
    mqtt_client.publish_abort()
    state = mqtt_client.get_state()
    order_id = state.get("current_order_id")
    if order_id:
        recipe_manager.complete_order(order_id, "aborted")
    return jsonify({"success": True, "message": "Abort signal sent."})


@app.route("/api/custom", methods=["POST"])
def api_create_custom():
    """
    Create a custom drink.
    Body: {
        "name": "My Special Mix",
        "ingredients": {"bottle_1": 30, "bottle_2": 20, ...}
    }
    """
    data        = request.get_json() or {}
    name        = data.get("name", "").strip()
    ingredients = data.get("ingredients", {})

    custom_id, error = recipe_manager.build_custom_drink(name, ingredients)
    if error:
        return jsonify({"error": error}), 400

    return jsonify({
        "success":   True,
        "custom_id": custom_id,
        "message":   f"'{name}' saved for 3 days!",
    })


@app.route("/api/custom")
def api_get_customs():
    """Return all active custom drinks."""
    customs = db.get_all_custom_drinks()
    return jsonify({"custom_drinks": customs})


@app.route("/api/custom/<int:custom_id>/save", methods=["POST"])
def api_save_custom(custom_id):
    """Permanently save a custom drink (never expires)."""
    db.save_custom_drink_permanently(custom_id)
    return jsonify({"success": True, "message": "Drink saved permanently!"})


@app.route("/api/clean", methods=["POST"])
def api_clean():
    """Trigger cleaning cycle."""
    data = request.get_json() or {}
    mode = data.get("mode", "periodic")
    mqtt_client.publish_clean(mode)
    return jsonify({"success": True, "message": f"Cleaning ({mode}) started."})


@app.route("/api/status")
def api_status():
    """Current machine + connection status."""
    state = mqtt_client.get_state()
    return jsonify({
        "connected":      state["connected"],
        "machine_status": state["machine_status"],
        "progress":       state["progress"],
        "message":        state["message"],
        "glass_present":  state["glass_present"],
        "bottle_levels":  state["bottle_levels"],
        "last_seen":      state["last_seen"],
    })


@app.route("/api/orders")
def api_orders():
    """Recent order history."""
    orders = recipe_manager.get_order_history(limit=20)
    return jsonify({"orders": orders})


@app.route("/api/bottles")
def api_bottles():
    """Bottle label config."""
    return jsonify({"bottles": db.get_bottle_labels()})


# ─────────────────────────────────────────────
#  STARTUP
# ─────────────────────────────────────────────

def create_app():
    db.init_db()
    mqtt_client.register_status_callback(_on_status_change)
    mqtt_client.register_sensor_callback(_on_sensor_update)
    mqtt_client.start()
    return app


if __name__ == "__main__":
    application = create_app()
    print("[APP] CocktailCraft starting on http://localhost:5000")
    application.run(
        host="0.0.0.0",
        port=5000,
        debug=False,        # set True during dev, False in production
        threaded=True,
        use_reloader=False, # must be False — MQTT loop can't handle reloader
    )
