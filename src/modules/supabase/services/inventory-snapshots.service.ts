// src/modules/inventory/services/reporting-inventory-snapshots.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { InventorySnapshotDto } from '../dtos/inventory-snapshot.dto';

// ------- helpers de logging -------
function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h ${m}m ${ss}s`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function logStep(logger: Logger, label: string, done: number, total: number, t0?: number) {
  const left = total - done;
  const base = `[inv_snap] ${label} ${done}/${total} (faltan ${left})`;
  if (t0) {
    const ms = Date.now() - t0;
    logger.log(`${base} • ${fmtMs(ms)}`);
  } else {
    logger.log(base);
  }
}

@Injectable()
export class InventorySnapshotsService {
  private readonly logger = new Logger(InventorySnapshotsService.name);

  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  private readonly UPSERT_CHUNK = 2000;
  private readonly MIN_CHUNK = 100;
  private readonly MAX_RETRIES = 4;
  private readonly INTER_BATCH_SLEEP_MS = 25;

  private async sleep(ms: number) {
    await new Promise((res) => setTimeout(res, ms));
  }

  private isStatementTimeout(e: any): boolean {
    const code = e?.code || e?.details?.code || e?.error?.code;
    const msg = e?.message || e?.error?.message;
    return code === '57014' || /statement timeout/i.test(msg ?? '');
  }

  private async execWithAdaptiveRetry<T>(
    label: string,
    initialChunkSize: number,
    rows: T[],
    runner: (batch: T[]) => Promise<void>,
  ): Promise<void> {
    let chunkSize = initialChunkSize;
    let offset = 0;

    while (offset < rows.length) {
      const end = Math.min(offset + chunkSize, rows.length);
      const slice = rows.slice(offset, end);

      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await runner(slice);
          break;
        } catch (e: any) {
          if (this.isStatementTimeout(e) && chunkSize > this.MIN_CHUNK && attempt < this.MAX_RETRIES) {
            const prev = chunkSize;
            chunkSize = Math.max(this.MIN_CHUNK, Math.floor(chunkSize / 2));
            this.logger.warn(
              `[ADAPT] ${label}: timeout, bajo chunk ${prev} -> ${chunkSize} (retry ${attempt + 1})`,
            );
            attempt++;
            continue;
          }
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
   * Importa / upsertea snapshots en `stores_inventory_snapshots`.
   * Clave lógica (y UNIQUE en SQL):
   *   (store_id, package_id, sku, product_id, snapshot_date, room_id)
   */
  async importMany(storeId: number, payloads: InventorySnapshotDto[]) {
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('InventorySnapshotDto[] requerido');
    }

    if (!Number.isFinite(storeId as any)) {
      throw new BadRequestException(`storeId inválido: ${storeId}`);
    }

    const totalOriginal = payloads.length;
    if (!totalOriginal) {
      this.logger.log('[inv_snap] No hay snapshots que procesar.');
      return { ok: true, processed: 0, elapsedMs: 0 };
    }

    const t0 = Date.now();
    this.logger.log(
      `[inv_snap] Importando lote: ${totalOriginal} snapshots crudos para store_id=${storeId}`,
    );

    const tBuild = Date.now();
    const dedupMap = new Map<string, any>();

    for (let i = 0; i < totalOriginal; i++) {
      const p = payloads[i];
      const pkg = p.packageId == null ? '' : `${p.packageId}`.trim();
      p.packageId = pkg || '0'; // normaliza packageId faltante

      // Validaciones mínimas de identidad
      if (!Number.isFinite(p.inventoryId as any)) {
        throw new BadRequestException(`inventoryId inválido en índice ${i}: ${p?.inventoryId}`);
      }
      if (!p.packageId) {
        throw new BadRequestException(`packageId requerido para inventoryId=${p?.inventoryId} en índice ${i}`);
      }
      if (!p.snapshotDate) {
        throw new BadRequestException(`snapshotDate requerido para inventoryId=${p?.inventoryId} en índice ${i}`);
      }
      if (!Number.isFinite(p.productId as any)) {
        throw new BadRequestException(`productId inválido en índice ${i}: ${p?.productId}`);
      }
      if (!Number.isFinite(p.roomId as any)) {
        throw new BadRequestException(`roomId inválido en índice ${i}: ${p?.roomId}`);
      }
      if (!p.sku) {
        throw new BadRequestException(`sku requerido para inventoryId=${p?.inventoryId} en índice ${i}`);
      }
      if (!p.product) {
        throw new BadRequestException(`product requerido para inventoryId=${p?.inventoryId} en índice ${i}`);
      }
      if (!p.room) {
        throw new BadRequestException(`room requerido para inventoryId=${p?.inventoryId} en índice ${i}`);
      }
      if (!p.unit) {
        throw new BadRequestException(`unit requerida para inventoryId=${p?.inventoryId} en índice ${i}`);
      }
      if (!Number.isFinite(p.unitId as any)) {
        throw new BadRequestException(`unitId inválido en índice ${i}: ${p?.unitId}`);
      }
      if (!Number.isFinite(p.quantity as any)) {
        throw new BadRequestException(`quantity inválida en índice ${i}: ${p?.quantity}`);
      }

      // Clave lógica alineada con la UNIQUE:
      // (store_id, package_id, sku, product_id, snapshot_date, room_id)
      const key = [
        storeId,
        p.packageId,
        p.sku,
        p.productId,
        p.snapshotDate,
        p.roomId,
      ].join('|');

      const baseRow = {
        store_id: storeId,
        inventory_id: p.inventoryId,
        package_id: p.packageId,
        sku: p.sku,
        product: p.product,
        product_id: p.productId,
        room: p.room,
        room_id: p.roomId,
        quantity: p.quantity,
        unit: p.unit,
        unit_id: p.unitId,
        snapshot_date: p.snapshotDate,
        vendor: p.vendor ?? null,
        batch_name: p.batchName ?? null,
        batch_id: p.batchId ?? null,
        total_cost: p.totalCost ?? null,
        status: p.status ?? null,
      };

      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, baseRow);
      } else {
        // Si hay duplicado exacto en el mismo snapshot, agregamos cantidades
        existing.quantity += p.quantity;

        if (baseRow.total_cost != null || existing.total_cost != null) {
          const prev = existing.total_cost ?? 0;
          const cur = baseRow.total_cost ?? 0;
          existing.total_cost = prev + cur;
        }
        // Los demás campos asumimos que son iguales;
        // aquí podrías agregar checks si quisieras validar inconsistencias.
      }

      if ((i + 1) % 200 === 0 || i + 1 === totalOriginal) {
        logStep(this.logger, 'armando/dedup', i + 1, totalOriginal, tBuild);
      }
    }

    const rows = Array.from(dedupMap.values());
    this.logger.log(
      `[inv_snap] Después de deduplicar: ${rows.length} snapshots únicos (de ${totalOriginal} crudos) para store_id=${storeId}`,
    );

    await this.upsertWithProgress(
      'stores_inventory_snapshots',
      rows,
      'store_id,package_id,sku,product_id,snapshot_date,room_id',
    );

    const elapsed = Date.now() - t0;
    this.logger.log(
      `[inv_snap] Lote completado (${rows.length} snapshots únicos, store_id=${storeId}) • ${fmtMs(elapsed)}`,
    );
    return { ok: true, processed: rows.length, elapsedMs: elapsed };
  }

  private async upsertWithProgress(table: string, rows: any[], onConflict: string) {
    if (!rows.length) return;
    const total = rows.length;
    const t0 = Date.now();
    let done = 0;

    await this.execWithAdaptiveRetry<any>(
      `upsert ${table}`,
      this.UPSERT_CHUNK,
      rows,
      async (batch) => {
        const r = await this.sb.from(table).upsert(batch, { onConflict });
        if (r.error) throw r.error;
        done += batch.length;
        logStep(this.logger, `upserting ${table}`, done, total, t0);
      },
    );
  }
}
