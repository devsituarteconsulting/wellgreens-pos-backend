# Wellgreens POS — Cron Jobs

Registro de los jobs programados localmente para sincronización de datos.
Usa **launchd** (nativo macOS) + **pmset** wake para garantizar ejecución.

---

## Requisitos previos

- Node.js 20 (via `nvm`)
- `pm2` instalado globalmente
- Proyecto en `/Users/<usuario>/Desktop/Wellgreens/wellgreens-pos-backend`
- Scripts en `/Users/<usuario>/Desktop/Wellgreens/`

> En una nueva Mac, reemplaza `/Users/axelabimael04` por la ruta del usuario correspondiente en todos los archivos.

---

## Scheduler: launchd (NO crontab)

Se usa `launchd` en vez de `cron` porque:
- **launchd ejecuta jobs pendientes** cuando la Mac despierta (cron no)
- Es el scheduler nativo de macOS
- Más robusto para Macs que duermen de noche

Los plists viven en `~/Library/LaunchAgents/`:

| Plist | Schedule | Script |
|-------|----------|--------|
| `com.wellgreens.sync-received-inventory.plist` | Mar–Dom 2 AM | `sync-received-inventory.sh` |
| `com.wellgreens.run-sync-job.plist` | Lunes 2 AM | `run-sync-job.sh` |

### Comandos útiles launchd

```bash
launchctl list | grep wellgreens                    # Ver agents cargados
launchctl load ~/Library/LaunchAgents/com.wellgreens.*.plist    # Cargar
launchctl unload ~/Library/LaunchAgents/com.wellgreens.*.plist  # Descargar
```

---

## Wake automático: pmset

La Mac se programa para **despertar sola** a la 1:58 AM todos los días:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 01:58:00
```

Verificar:
```bash
sudo pmset -g sched
```

---

## Scripts instalados

| Archivo | Descripción |
|---------|-------------|
| `start-wellgreens-pos.sh` | Arranca el servidor NestJS vía pm2 (carga nvm) |
| `sync-received-inventory.sh` | Sincroniza received inventory (ventana de logs si sesión activa) |
| `run-sync-job.sh` | Corre el sync job completo (ventana de logs si sesión activa) |

---

## Job 1: `sync-received-inventory.sh`

**Cuándo:** Martes a Domingo a las 2:00 AM
**Endpoint:** `POST /wg-pos/sync/inventory/receivedinventory`
**Parámetros:** ventana rodante — `from_utc = hoy - 30 días`, `to_utc = mañana`
**Log:** `logs/sync-received-inventory.log`

```bash
#!/bin/bash
FROM=$(date -v-30d +%Y-%m-%d)
TO=$(date -v+1d +%Y-%m-%d)

LOG_DIR="/Users/axelabimael04/Desktop/Wellgreens/logs"
mkdir -p "$LOG_DIR"

if [ "$(stat -f "%Su" /dev/console 2>/dev/null)" = "$(whoami)" ]; then
  osascript -e "tell application \"Terminal\" to do script \"tail -f $LOG_DIR/sync-received-inventory.log\""
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running sync from=$FROM to=$TO" >> "$LOG_DIR/sync-received-inventory.log"

curl -s -X POST http://localhost:8080/wg-pos/sync/inventory/receivedinventory \
  -H "Content-Type: application/json" \
  -d "{\"from_utc\":\"$FROM\",\"to_utc\":\"$TO\"}" \
  >> "$LOG_DIR/sync-received-inventory.log" 2>&1

echo "" >> "$LOG_DIR/sync-received-inventory.log"
```

---

## Job 2: `run-sync-job.sh`

**Cuándo:** Lunes a las 2:00 AM
**Endpoint:** `POST /wg-pos/run-sync-job`
**Parámetros:** ninguno (usa defaults — incluye received inventory)
**Log:** `logs/run-sync-job.log`

```bash
#!/bin/bash
LOG_DIR="/Users/axelabimael04/Desktop/Wellgreens/logs"
mkdir -p "$LOG_DIR"

if [ "$(stat -f "%Su" /dev/console 2>/dev/null)" = "$(whoami)" ]; then
  osascript -e "tell application \"Terminal\" to do script \"tail -f $LOG_DIR/run-sync-job.log\""
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running wg-pos/run-sync-job" >> "$LOG_DIR/run-sync-job.log"

curl -s -X POST http://localhost:8080/wg-pos/run-sync-job \
  -H "Content-Type: application/json" \
  -d '{}' \
  >> "$LOG_DIR/run-sync-job.log" 2>&1

echo "" >> "$LOG_DIR/run-sync-job.log"
```

---

## Servidor NestJS con pm2

El servidor corre en `http://localhost:8080` y se gestiona con pm2.

```bash
# Wrapper script (start-wellgreens-pos.sh)
#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20
cd /Users/axelabimael04/Desktop/Wellgreens/wellgreens-pos-backend
npm run start:dev
```

### Comandos útiles pm2

```bash
pm2 status                      # Ver procesos activos
pm2 logs wellgreens-pos         # Ver logs en tiempo real
pm2 restart wellgreens-pos      # Reiniciar servidor
pm2 stop wellgreens-pos         # Detener servidor
```

---

## Setup en una Mac nueva

```bash
# 1. Instalar nvm y node 20
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 20
nvm use 20

# 2. Instalar pm2
npm install -g pm2

# 3. Copiar los scripts y ajustar rutas (reemplazar axelabimael04 por el usuario)
# Editar start-wellgreens-pos.sh, sync-received-inventory.sh, run-sync-job.sh

# 4. Dar permisos de ejecución
chmod +x start-wellgreens-pos.sh sync-received-inventory.sh run-sync-job.sh

# 5. Registrar el servidor en pm2
pm2 start start-wellgreens-pos.sh --name "wellgreens-pos"
pm2 save
pm2 startup
# → Ejecutar el comando sudo que genera

# 6. Copiar los plists a ~/Library/LaunchAgents/
cp com.wellgreens.sync-received-inventory.plist ~/Library/LaunchAgents/
cp com.wellgreens.run-sync-job.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.wellgreens.sync-received-inventory.plist
launchctl load ~/Library/LaunchAgents/com.wellgreens.run-sync-job.plist

# 7. Programar wake automático a la 1:58 AM
sudo pmset repeat wakeorpoweron MTWRFSU 01:58:00
```

---

## Notas

- **pmset** despierta la Mac a la 1:58 AM → launchd ejecuta a las 2:00 AM en punto
- **Failsafe**: si la Mac estaba apagada a las 2 AM, launchd ejecuta el job pendiente al despertar
- Si la Mac está desbloqueada, `osascript` abrirá Terminal con `tail -f` del log automáticamente
- No hay timeout en los scripts — los endpoints pueden tardar hasta 1 hora
- Los logs se acumulan en `logs/` — limpiarlos manualmente si crecen demasiado
