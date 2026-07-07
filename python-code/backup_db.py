"""
backup_db.py — Automated SQLite Backup
Cocktail-Craft Bartender | Raspberry Pi

Usage:
    python backup_db.py               # copies to ./backups/ next to the DB
    python backup_db.py --dest /mnt/usb/backups   # explicit destination
    python backup_db.py --keep 14     # keep last 14 backups (default: 7)
    python backup_db.py --dest /mnt/usb/backups --keep 14

Designed to run from cron every hour. Safe to call while Flask is running
because it uses SQLite's built-in backup API (reads a live, consistent
snapshot without locking writes).

Crontab (edit with `crontab -e`):
    # Backup every hour, keep last 7 days of hourly copies
    0 * * * * /home/pi/luxe-bar-scribe/python-code/.venv/bin/python \
              /home/pi/luxe-bar-scribe/python-code/backup_db.py \
              --dest /home/pi/db-backups --keep 168 >> /home/pi/backup.log 2>&1
"""

import argparse
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


# ─── Path to the live DB ───────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
DB_PATH    = SCRIPT_DIR / "Cocktail-Craft.db"


def parse_args():
    parser = argparse.ArgumentParser(description="Back up the Cocktail-Craft SQLite database.")
    parser.add_argument(
        "--dest",
        type=Path,
        default=SCRIPT_DIR / "backups",
        help="Directory to write backups to (created if it doesn't exist). "
             "Default: ./backups/ next to the DB.",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=7,
        help="Number of most-recent backups to keep. Older ones are deleted. Default: 7.",
    )
    return parser.parse_args()


def backup(src: Path, dest_dir: Path) -> Path:
    """
    Copy `src` to `dest_dir` using SQLite's online backup API.
    Returns the path of the new backup file.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest_file = dest_dir / f"Cocktail-Craft_{timestamp}.db"

    src_conn  = sqlite3.connect(str(src))
    dest_conn = sqlite3.connect(str(dest_file))
    try:
        src_conn.backup(dest_conn, pages=256, progress=None)
    finally:
        dest_conn.close()
        src_conn.close()

    return dest_file


def prune(dest_dir: Path, keep: int):
    """Delete the oldest backups in dest_dir, keeping only the `keep` most recent."""
    backups = sorted(dest_dir.glob("Cocktail-Craft_*.db"), key=lambda p: p.stat().st_mtime)
    to_delete = backups[:-keep] if len(backups) > keep else []
    for f in to_delete:
        f.unlink()
    return to_delete


def main():
    args = parse_args()

    if not DB_PATH.exists():
        print(f"[BACKUP] ERROR: source database not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"[BACKUP] {datetime.now().isoformat()} -- Backing up {DB_PATH} -> {args.dest}")

    try:
        dest_file = backup(DB_PATH, args.dest)
        size_kb   = dest_file.stat().st_size // 1024
        print(f"[BACKUP] OK: {dest_file.name} ({size_kb} KB)")
    except Exception as e:
        print(f"[BACKUP] ERROR during backup: {e}", file=sys.stderr)
        sys.exit(1)

    deleted = prune(args.dest, args.keep)
    if deleted:
        print(f"[BACKUP] Pruned {len(deleted)} old backup(s): {[f.name for f in deleted]}")

    remaining = sorted(args.dest.glob("Cocktail-Craft_*.db"))
    print(f"[BACKUP] {len(remaining)} backup(s) retained in {args.dest}")


if __name__ == "__main__":
    main()
