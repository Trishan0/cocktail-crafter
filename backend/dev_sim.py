"""
dev_sim.py — Local UI testing entry point (no ESP32 / Raspberry Pi needed)
Cocktail-Craft Bartender

Runs the Flask backend with the built-in SimulatorController against a
throw-away copy of the database, so the kiosk and admin screens can be
exercised on a laptop without touching the real Cocktail-Craft.db.

    uv run python dev_sim.py                 # auto glass, phases slowed 3x
    uv run python dev_sim.py --manual-glass  # place/remove glass from the Dev Panel
    uv run python dev_sim.py --speed 1       # real simulator timing
    uv run python dev_sim.py --reset         # re-copy Cocktail-Craft.db first
"""
import argparse
import os
import shutil

import config
import db

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_DB = os.path.join(HERE, "Cocktail-Craft.db")
SIM_DB = os.path.join(HERE, "Cocktail-Craft.sim.db")

DEMO_BOTTLE_ML = 2000


def _prepare_database(reset: bool):
    if reset and os.path.exists(SIM_DB):
        os.remove(SIM_DB)
    if not os.path.exists(SIM_DB) and os.path.exists(SOURCE_DB):
        shutil.copyfile(SOURCE_DB, SIM_DB)
        print(f"[SIM] Copied {os.path.basename(SOURCE_DB)} -> {os.path.basename(SIM_DB)}")
    db.DB_PATH = SIM_DB
    db.init_db()

    # Make the happy path work: the simulator reports every level sensor as 1,
    # so treat 1 as "above the line" and give every bottle plenty of volume.
    db.set_setting("liquid_level_above_value", 1)
    db.set_setting("machine_powered_on", True)
    db.set_setting("simulator_mode", "1")
    for pump in db.get_all_pumps():
        if float(pump.get("current_volume_ml") or 0) < DEMO_BOTTLE_ML:
            db.update_pump_inventory(int(pump["pump_number"]), DEMO_BOTTLE_ML)


def main():
    parser = argparse.ArgumentParser(description="Run the backend with the hardware simulator.")
    parser.add_argument("--speed", type=float, default=3.0,
                        help="Multiply simulated phase durations (default 3 = slow enough to read each screen).")
    parser.add_argument("--manual-glass", action="store_true",
                        help="Do not auto-place/remove the glass; use the Dev Panel buttons instead.")
    parser.add_argument("--reset", action="store_true",
                        help="Discard the simulator database and copy Cocktail-Craft.db again.")
    args = parser.parse_args()

    config.SIMULATOR_MODE = True
    config.SIMULATOR_DELAY_SCALE = args.speed
    config.SIMULATOR_AUTO_GLASS = not args.manual_glass

    _prepare_database(args.reset)

    from app import create_app

    application = create_app()
    glass = "manual (Dev Panel)" if args.manual_glass else "automatic"
    print(f"[SIM] Simulator mode | speed x{args.speed:g} | glass: {glass} | db: {os.path.basename(SIM_DB)}")
    print(f"[APP] Cocktail-Craft Bartender starting on http://localhost:{config.FLASK_PORT}")
    application.run(
        host=config.FLASK_HOST,
        port=config.FLASK_PORT,
        debug=False,
        threaded=True,
        use_reloader=False,
    )


if __name__ == "__main__":
    main()
