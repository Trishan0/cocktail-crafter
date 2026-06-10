"""
main.py — Entry Point
ATRIA Bartender | Raspberry Pi
"""
from app import create_app
import config

if __name__ == "__main__":
    application = create_app()
    print(f"[APP] ATRIA Bartender starting on http://localhost:{config.FLASK_PORT}")
    application.run(
        host=config.FLASK_HOST,
        port=config.FLASK_PORT,
        debug=False,
        threaded=True,
        use_reloader=False,
    )
