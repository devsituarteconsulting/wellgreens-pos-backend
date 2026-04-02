import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { ReceivedInventoryDto } from '../dtos/received-inventory.dto';

// ------- helpers de logging y chunking -------
function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h ${m}m ${ss}s`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function logStep(
  logger: Logger,
  storeId: number,
  label: string,
  done: number,
  total: number,
  t0?: number
) {
  const left = total - done;
  const base = `[store:${storeId}] ${label} ${done}/${total} (faltan ${left})`;
  if (t0) {
    const ms = Date.now() - t0;
    logger.log(`${base} • ${fmtMs(ms)}`);
  } else {
    logger.log(base);
  }
}

@Injectable()
export class ReceivedInventoryService {
  private readonly logger = new Logger(ReceivedInventoryService.name);
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  // Tamaños de lote (ajustados)
  private readonly UPSERT_CHUNK = 2000;

  // Límites para adaptación
  private readonly MIN_CHUNK = 100;
  private readonly MAX_RETRIES = 4;
  private readonly INTER_BATCH_SLEEP_MS = 25;

  // Logs para debugging
  private readonly MAX_KEYS_LOG = 30;
  private readonly MAX_ROWS_LOG = 3;

  private async sleep(ms: number) {
    await new Promise((res) => setTimeout(res, ms));
  }

  private isStatementTimeout(e: any): boolean {
    const code = e?.code || e?.details?.code || e?.error?.code;
    const msg = e?.message || e?.error?.message;
    return code === '57014' || /statement timeout/i.test(msg ?? '');
  }

  private isUpsertAffectsRowTwice(e: any): boolean {
    const code = e?.code || e?.details?.code || e?.error?.code;
    const msg = e?.message || e?.error?.message;
    return code === '21000' || /cannot affect row a second time/i.test(msg ?? '');
  }

  /**
   * Convierte "store_id,received_inventory_id,external_package_id"
   * en una key estable por fila.
   */
  private makeConflictKey(row: any, onConflict: string): string {
    const cols = onConflict.split(',').map((s) => s.trim()).filter(Boolean);
    return cols.map((c) => `${c}=${row?.[c] ?? 'NULL'}`).join('|');
  }

  /**
   * Encuentra llaves duplicadas dentro de un batch para un onConflict.
   * Devuelve mapa: key -> indices en el batch.
   */
  private findDuplicateConflictKeys(rows: any[], onConflict: string): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const k = this.makeConflictKey(rows[i], onConflict);
      const arr = map.get(k);
      if (arr) arr.push(i);
      else map.set(k, [i]);
    }
    // filtra solo los que tienen 2+
    for (const [k, arr] of [...map.entries()]) {
      if (arr.length < 2) map.delete(k);
    }
    return map;
  }

  // ===== dedupe helpers =====

  /**
   * Reduce el ruido en logs (onConflict + extras relevantes).
   */
  private slimRow(r: any, conflictCols: string[]) {
    const base: any = {};
    for (const c of conflictCols) base[c] = r?.[c] ?? null;

    // extras útiles para items
    if (r?.sku != null) base.sku = r.sku;
    if (r?.product_name != null) base.product_name = r.product_name;
    if (r?.quantity != null) base.quantity = r.quantity;
    if (r?.unit_cost != null) base.unit_cost = r.unit_cost;
    if (r?.total_cost != null) base.total_cost = r.total_cost;

    // extras útiles para raíz
    if (r?.title != null) base.title = r.title;
    if (r?.status != null) base.status = r.status;

    return base;
  }

  /**
   * Comparación rápida para detectar "misma key pero filas distintas".
   * (Política final es last-wins, solo sirve para log limitado.)
   */
  private shallowEqualAllKeys(a: any, b: any) {
    const ka = Object.keys(a || {});
    const kb = Object.keys(b || {});
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a?.[k] !== b?.[k]) return false;
    return true;
  }

  /**
   * Deduplica por onConflict.
   * Política: last-wins (seguro para eliminar duplicados idénticos y evita 21000).
   * Log limitado si detecta misma key con filas distintas.
   */
  private dedupeByOnConflict(rows: any[], onConflict: string, storeId: number, table: string) {
    if (rows.length < 2) return rows;

    const cols = onConflict.split(',').map((s) => s.trim()).filter(Boolean);
    const map = new Map<string, any>();

    let removed = 0;
    let conflictsDifferent = 0;
    const MAX_CONFLICTS_DIFF_LOG = 3;

    for (const r of rows) {
      const k = cols.map((c) => `${c}=${r?.[c] ?? 'NULL'}`).join('|');
      const prev = map.get(k);

      if (!prev) {
        map.set(k, r);
        continue;
      }

      // misma key: last wins
      if (conflictsDifferent < MAX_CONFLICTS_DIFF_LOG && !this.shallowEqualAllKeys(prev, r)) {
        conflictsDifferent++;
        this.logger.warn(
          `[store:${storeId}] dedupe ${table}: misma key pero filas distintas (last-wins) key="${k}"`
        );
        this.logger.warn(`[store:${storeId}] prev=${JSON.stringify(this.slimRow(prev, cols))}`);
        this.logger.warn(`[store:${storeId}] next=${JSON.stringify(this.slimRow(r, cols))}`);
      }

      map.set(k, r);
      removed++;
    }

    if (removed > 0) {
      this.logger.warn(
        `[store:${storeId}] dedupe aplicado en ${table}: original=${rows.length} deduped=${map.size} removed=${removed}`
      );
    }

    return Array.from(map.values());
  }

  /**
   * Loggea un error de Supabase/Postgres con contexto útil.
   */
  private logSupabaseErrorContext(params: {
    table: string;
    storeId: number;
    onConflict: string;
    batch: any[];
    error: any;
    label: string;
  }) {
    const { table, storeId, onConflict, batch, error, label } = params;

    const code = error?.code ?? error?.details?.code ?? error?.error?.code ?? 'unknown';
    const msg = error?.message ?? error?.error?.message ?? String(error);
    const hint = error?.hint ?? error?.error?.hint ?? null;
    const details = error?.details ?? error?.error?.details ?? null;

    this.logger.error(
      `[store:${storeId}] ERROR en ${label} | table=${table} | code=${code} | message=${msg}`
    );
    if (hint) this.logger.error(`[store:${storeId}] hint=${hint}`);
    if (details) this.logger.error(`[store:${storeId}] details=${JSON.stringify(details)}`);

    // Para 21000: muestra duplicados dentro del batch
    if (this.isUpsertAffectsRowTwice(error)) {
      const dupes = this.findDuplicateConflictKeys(batch, onConflict);

      if (dupes.size) {
        const keys = [...dupes.keys()].slice(0, this.MAX_KEYS_LOG);
        this.logger.error(
          `[store:${storeId}] Duplicados detectados dentro del batch para onConflict="${onConflict}" | dupKeys=${dupes.size} | mostrando=${keys.length}`
        );
        this.logger.error(keys.join(' || '));

        // Muestra algunas filas (cortas) para ver el origen
        let printed = 0;
        for (const k of keys) {
          if (printed >= this.MAX_ROWS_LOG) break;
          const idxs = dupes.get(k) ?? [];
          const sampleIdxs = idxs.slice(0, 2); // las dos primeras que chocan
          const sampleRows = sampleIdxs.map((i) => batch[i]);

          // Reduce el ruido: imprime solo columnas del onConflict + extras útiles
          const cols = onConflict.split(',').map((s) => s.trim()).filter(Boolean);
          const slim = sampleRows.map((r) => this.slimRow(r, cols));

          this.logger.error(
            `[store:${storeId}] sample dup key="${k}" idxs=${sampleIdxs.join(',')} rows=${JSON.stringify(slim)}`
          );
          printed++;
        }
      } else {
        this.logger.error(
          `[store:${storeId}] Error 21000 pero no encontré duplicados en el batch. Posible mismatch entre onConflict y unique constraint real.`
        );
      }
    }
  }

  /**
   * Ejecuta una operación sobre un batch con reintentos y división de chunk
   * si aparece 57014.
   */
  private async execWithAdaptiveRetry<T>(
    label: string,
    initialChunkSize: number,
    rowsOrIds: T[],
    runner: (batch: T[]) => Promise<void>,
  ): Promise<void> {
    let chunkSize = initialChunkSize;
    let offset = 0;

    while (offset < rowsOrIds.length) {
      const end = Math.min(offset + chunkSize, rowsOrIds.length);
      const slice = rowsOrIds.slice(offset, end);

      let attempt = 0;
      while (true) {
        try {
          await runner(slice);
          break; // batch OK
        } catch (e: any) {
          if (this.isStatementTimeout(e) && chunkSize > this.MIN_CHUNK && attempt < this.MAX_RETRIES) {
            const prev = chunkSize;
            chunkSize = Math.max(this.MIN_CHUNK, Math.floor(chunkSize / 2));
            this.logger.warn(
              `[ADAPT] ${label}: timeout, bajo chunk ${prev} -> ${chunkSize} (retry ${attempt + 1})`
            );
            attempt++;
            continue;
          }
          // otro error o ya no podemos reducir más
          throw e;
        }
      }

      offset = end;
      if (this.INTER_BATCH_SLEEP_MS) {
        await this.sleep(this.INTER_BATCH_SLEEP_MS);
      }
    }
  }

  /**
   * Importa SIEMPRE un array de inventario recibido para una tienda.
   * - stores_received_inventory: UPSERT (sin borrar)
   * - received_inventory_item: UPSERT (sin borrar)
   */
  async importMany(payloads: ReceivedInventoryDto[], storeIdStr: string) {
    if (!Array.isArray(payloads)) throw new BadRequestException('ReceivedInventoryDto[] requerido');
    const storeId = Number.parseInt(storeIdStr);
    if (!Number.isFinite(storeId) || storeId <= 0) throw new BadRequestException(`storeId inválido: ${storeId}`);

    const total = payloads.length;
    if (!total) {
      this.logger.log(`[store:${storeId}] No hay inventario que procesar.`);
      return { ok: true, processed: 0 };
    }

    const t0 = Date.now();
    this.logger.log(`[store:${storeId}] Importando lote: ${total} inventario recibido`);

    // Buffers
    const txRows: any[] = [];
    const itemRows: any[] = [];
    const txids: number[] = [];

    // ---------- 1) Armado (con progreso) ----------
    const tBuild = Date.now();
    for (let i = 0; i < total; i++) {
      const p = payloads[i];
      const txid = p.receiveInventoryHistoryId;
      if (!Number.isFinite(txid)) {
        throw new BadRequestException(`receivedInventoryId inválido: ${p?.receiveInventoryHistoryId}`);
      }
      txids.push(txid);

      // stores_received_inventory (UPSERT)
      txRows.push({
        received_inventory_id: p.receiveInventoryHistoryId,
        store_id: storeId,
        title: p.title ?? null,
        status: p.status ?? null,
        failure_message: p.failureMessage ?? null,
        delivered_on: p.deliveredOn ?? null,
        added_on: p.addedOn ?? null,
        vendor: p.vendor ?? null,
        vendor_license: p.vendorLicense ?? null,
        transaction_id: p.transactionId ?? null,
        external_id: p.externalId ?? null,
        note: p.note ?? null,
        delivered_by: p.deliveredBy ?? null,
        purchase_order_id: p.purchaseOrderId ?? null,
        vendor_id: p.vendorId ?? null,
        vendor_global_id: p.vendorGlobalId ?? null,
        total_credit: p.totalCredit ?? 0,
        shipping_charge: p.shippingCharge ?? 0,
      });

      // received_inventory_item (UPSERT)
      for (const it of p.items || []) {
        itemRows.push({
          received_inventory_id: p.receiveInventoryHistoryId,
          store_id: storeId,
          product_name: it.product ?? null,
          sku: it.sku,
          product_id: it.productId,
          type: it.type ?? null,
          quantity: it.quantity ?? null,
          unit_abbreviation: it.unitAbbreviation ?? null,
          unit: it.unit ?? null,
          unit_cost: it.unitCost ?? null,
          unit_tax: it.unitTax ?? null,
          total_cost: it.totalCost ?? null,
          package_id: it.packageId ?? null,
          external_package_id: it.externalPackageId ?? it.packageId,
          batch_name: it.batchName ?? null,
          batch_id: it.batchId ?? null,
          room: it.room ?? null,
          room_id: it.roomId ?? null,
        });
      }

      if ((i + 1) % 200 === 0 || i + 1 === total) {
        logStep(this.logger, storeId, 'armando', i + 1, total, tBuild);
      }
    }

    // ---------- 2) UPSERT raíz (dedupe + adaptativo) ----------
    await this.upsertWithProgress(
      'dutchie_received_inventory_raw',
      txRows,
      storeId,
      'store_id,received_inventory_id',
    );

    // ---------- 3) UPSERT items (dedupe + adaptativo) ---------- 
    await this.upsertWithProgress(
      'dutchie_received_inventory_items_raw',
      itemRows,
      storeId,
      'store_id,received_inventory_id,external_package_id,product_id',
    );

    // ---------- Fin -----------
    const elapsed = Date.now() - t0;
    this.logger.log(`[store:${storeId}] Lote completado (${total} tx) • ${fmtMs(elapsed)}`);
    return { ok: true, processed: total, elapsedMs: elapsed };
  }

  // ===== helpers con progreso (ADAPTATIVOS) =====
  private async upsertWithProgress(table: string, rows: any[], storeId: number, onConflict: string) {
    if (!rows.length) return;

    // DEDUPE GLOBAL ANTES DE CHUNKEAR (evita 21000 y mantiene progreso consistente)
    const dedupedRows = this.dedupeByOnConflict(rows, onConflict, storeId, table);

    const total = dedupedRows.length;
    const t0 = Date.now();
    let done = 0;

    await this.execWithAdaptiveRetry<any>(
      `upsert ${table} [store:${storeId}]`,
      this.UPSERT_CHUNK,
      dedupedRows,
      async (batch) => {
        try {
          // Debug preventivo: si el batch trae duplicados (no debería tras dedupe)
          const dupes = this.findDuplicateConflictKeys(batch, onConflict);
          if (dupes.size) {
            const keys = [...dupes.keys()].slice(0, this.MAX_KEYS_LOG);
            this.logger.warn(
              `[store:${storeId}] WARN: batch con posibles duplicados para ${table} onConflict="${onConflict}" dupKeys=${dupes.size} (mostrando ${keys.length})`
            );
            this.logger.warn(keys.join(' || '));
          }

          const r = await this.sb.from(table).upsert(batch, { onConflict });
          if (r.error) {
            this.logSupabaseErrorContext({
              table,
              storeId,
              onConflict,
              batch,
              error: r.error,
              label: `upsert ${table}`,
            });
            throw r.error;
          }

          done += batch.length;
          logStep(this.logger, storeId, `upserting ${table}`, done, total, t0);
        } catch (e: any) {
          this.logSupabaseErrorContext({
            table,
            storeId,
            onConflict,
            batch,
            error: e,
            label: `upsert ${table}`,
          });
          throw e;
        }
      },
    );
  }
}
