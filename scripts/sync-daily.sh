#!/bin/bash
# Daily sync — transactions + received inventory + all data
# Runs daily at 2:00 AM via launchd
# Hits the NestJS server at localhost:8080
#
# Uses 2-day transaction lookback (yesterday + buffer)
# Uses 30-day received inventory lookback

LOG_DIR="$(dirname "$0")/../logs"
mkdir -p "$LOG_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running daily sync" >> "$LOG_DIR/sync-daily.log"

curl -s -X POST http://localhost:8080/wg-pos/run-sync-job \
  -H "Content-Type: application/json" \
  -d '{
    "continue_on_error": false,
    "retries": 3,
    "default_from_days_ago": 2,
    "receivedinventory_from_days_ago": 30,
    "to_days_ahead": 1
  }' \
  >> "$LOG_DIR/sync-daily.log" 2>&1

echo "" >> "$LOG_DIR/sync-daily.log"
