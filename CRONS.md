# Wellgreens POS — Cron Jobs

Scheduled sync jobs via **launchd** (macOS native). Runs on whichever Mac hosts the NestJS server.

---

## Job Inventory

| Plist | Schedule | Script | What it syncs |
|-------|----------|--------|---------------|
| `com.wellgreens.pos-sync-daily.plist` | Tue–Sun 2:00 AM | `sync-daily.sh` | Full sync: transactions (2-day), inventory (30-day), products, customers, employees, homebase |
| `com.wellgreens.pos-sync-weekly.plist` | Monday 2:00 AM | `sync-weekly.sh` | Full sync: transactions (8-day catch-up), inventory (60-day), products, customers, employees, homebase |

Both jobs call `POST /wg-pos/run-sync-job` on `localhost:8080`.

---

## Daily Sync (`sync-daily.sh`)

**Schedule:** Tuesday through Sunday at 2:00 AM
**Endpoint:** `POST /wg-pos/run-sync-job`

```json
{
  "continue_on_error": false,
  "retries": 3,
  "default_from_days_ago": 2,
  "receivedinventory_from_days_ago": 30,
  "to_days_ahead": 1
}
```

Syncs yesterday's transactions plus a 1-day buffer. Received inventory uses a 30-day rolling window.

**Log:** `logs/sync-daily.log`

---

## Weekly Sync (`sync-weekly.sh`)

**Schedule:** Monday at 2:00 AM
**Endpoint:** `POST /wg-pos/run-sync-job`

```json
{
  "continue_on_error": false,
  "retries": 3,
  "default_from_days_ago": 8,
  "receivedinventory_from_days_ago": 60,
  "to_days_ahead": 1
}
```

Weekly catch-up with a full 8-day transaction lookback and 60-day received inventory window.

**Log:** `logs/sync-weekly.log`

---

## Setup

### Prerequisites

- Node.js 20 (via `nvm`)
- `pm2` installed globally
- NestJS server running at `http://localhost:8080`

### Install crons

```bash
# 1. Set REPO_DIR to wherever you cloned the repo
REPO_DIR="$HOME/automation/wellgreens-pos-backend"

# 2. Generate plists with correct paths
for f in "$REPO_DIR/scripts/plists/"*.plist; do
  DEST="$HOME/Library/LaunchAgents/$(basename "$f")"
  sed "s|__REPO_DIR__|$REPO_DIR|g" "$f" > "$DEST"
done

# 3. Load the jobs
launchctl load ~/Library/LaunchAgents/com.wellgreens.pos-sync-daily.plist
launchctl load ~/Library/LaunchAgents/com.wellgreens.pos-sync-weekly.plist

# 4. (Optional) Schedule Mac auto-wake at 1:58 AM
sudo pmset repeat wakeorpoweron MTWRFSU 01:58:00
```

### Start the NestJS server

```bash
cd "$REPO_DIR"
npm install
npm run build

# Via pm2:
pm2 start npm --name "wellgreens-pos" -- run start:prod
pm2 save
pm2 startup  # run the sudo command it generates
```

### Verify

```bash
# Check loaded jobs
launchctl list | grep pos-sync

# Check server health
curl http://localhost:8080/health

# Manual test (2-day sync)
curl -X POST http://localhost:8080/wg-pos/run-sync-job \
  -H "Content-Type: application/json" \
  -d '{"default_from_days_ago": 2, "receivedinventory_from_days_ago": 30, "to_days_ahead": 1}'
```

### Uninstall old crons

If migrating from the previous setup (`sync-received-inventory.sh` + `run-sync-job.sh`):

```bash
launchctl unload ~/Library/LaunchAgents/com.wellgreens.sync-received-inventory.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.wellgreens.run-sync-job.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.wellgreens.sync-received-inventory.plist
rm -f ~/Library/LaunchAgents/com.wellgreens.run-sync-job.plist
```

---

## Notes

- **pmset** wakes the Mac at 1:58 AM so launchd runs at 2:00 AM
- **Failsafe:** if the Mac was asleep at 2 AM, launchd runs the pending job on wake
- Logs accumulate in `logs/` — clean manually if they grow too large
- The NestJS server must be running for crons to work (`pm2 status` to check)
