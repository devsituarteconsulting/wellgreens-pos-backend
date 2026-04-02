#!/bin/bash
# Weekly full sync — 8-day transaction lookback + 60-day received inventory
# Runs Monday at 2:00 AM via launchd
# Catches anything the daily sync may have missed

LOG_DIR="$(dirname "$0")/../logs"
mkdir -p "$LOG_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running weekly full sync" >> "$LOG_DIR/sync-weekly.log"

curl -s -X POST http://localhost:8080/wg-pos/run-sync-job \
  -H "Content-Type: application/json" \
  -d '{
    "continue_on_error": false,
    "retries": 3,
    "default_from_days_ago": 8,
    "receivedinventory_from_days_ago": 60,
    "to_days_ahead": 1
  }' \
  >> "$LOG_DIR/sync-weekly.log" 2>&1

echo "" >> "$LOG_DIR/sync-weekly.log"
