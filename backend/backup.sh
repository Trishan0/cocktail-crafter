#!/usr/bin/env bash
# backup.sh — Thin shell wrapper around backup_db.py
# Drop this file anywhere and call it from cron, systemd, or manually.
#
# USAGE:
#   chmod +x backup.sh
#   ./backup.sh
#
# CRONTAB (run `crontab -e` and paste one of the lines below):
#
#   Every hour, keep last 168 copies (~7 days of hourly backups):
#   0 * * * * /home/pi/luxe-bar-scribe/backend/backup.sh >> /home/pi/backup.log 2>&1
#
#   Every 15 minutes, keep last 96 copies (~1 day):
#   */15 * * * * /home/pi/luxe-bar-scribe/backend/backup.sh >> /home/pi/backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${SCRIPT_DIR}/.venv/bin/python"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup_db.py"
DEST="${HOME}/db-backups"
KEEP=168   # 7 days of hourly copies

exec "${PYTHON}" "${BACKUP_SCRIPT}" --dest "${DEST}" --keep "${KEEP}"
