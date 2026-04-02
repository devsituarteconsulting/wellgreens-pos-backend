// src/modules/homebase/services/homebase-shifts-import.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { HomebaseShiftDto } from '../dtos/shifts.dto';

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
  const base = `[hb_shifts] ${label} ${done}/${total} (faltan ${left})`;
  if (t0) {
    const ms = Date.now() - t0;
    logger.log(`${base} • ${fmtMs(ms)}`);
  } else {
    logger.log(base);
  }
}

@Injectable()
export class HomebaseShiftsImportService {
  private readonly logger = new Logger(HomebaseShiftsImportService.name);

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
   * Importa/upsertea shifts y labor de Homebase.
   *
   * Tablas:
   * - stores_homebase_shifts   PK: (store_id, id)
   * - homebase_shifts_labor    PK: (store_id, shift_id)
   */
  async importMany(storeId: number, payloads: HomebaseShiftDto[]) {
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('HomebaseShiftDto[] requerido');
    }
    if (!Number.isFinite(storeId as any)) {
      throw new BadRequestException(`storeId inválido: ${storeId}`);
    }

    const totalOriginal = payloads.length;
    if (!totalOriginal) {
      this.logger.log('[hb_shifts] No hay shifts que procesar.');
      return { ok: true, processed: 0, elapsedMs: 0 };
    }

    const t0 = Date.now();
    this.logger.log(`[hb_shifts] Importando lote: ${totalOriginal} shifts para store_id=${storeId}`);

    // 1) Construcción / validación / dedup
    const tBuild = Date.now();
    const shiftsMap = new Map<number, any>();
    const laborMap = new Map<number, any>();

    for (let i = 0; i < totalOriginal; i++) {
      const p = payloads[i];

      if (!Number.isFinite(p?.id as any)) {
        throw new BadRequestException(`shift.id inválido en índice ${i}: ${p?.id}`);
      }

      const shiftId = Number(p.id);

      const shiftRow = {
        store_id: storeId,
        id: shiftId,
        timecard_id: p.timecard_id == null ? null : Number(p.timecard_id),
        open: !!p.open,
        role: p.role ?? null,
        department: p.department ?? null,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        job_id: p.job_id == null ? null : Number(p.job_id),
        user_id: p.user_id == null ? null : Number(p.user_id),
        wage_rate: p.wage_rate == null ? null : Number(p.wage_rate),
        published: !!p.published,
        scheduled: !!p.scheduled,
        created_at: p.created_at ?? null,
        updated_at: p.updated_at ?? null,
        start_at: p.start_at ?? null,
        end_at: p.end_at ?? null,
      };

      // dedup por shift.id, preferimos el más nuevo por updated_at
      const existing = shiftsMap.get(shiftId);
      if (!existing) {
        shiftsMap.set(shiftId, shiftRow);
      } else {
        const prevUpd = existing.updated_at ? Date.parse(existing.updated_at) : 0;
        const curUpd = shiftRow.updated_at ? Date.parse(shiftRow.updated_at) : 0;
        if (curUpd >= prevUpd) {
          shiftsMap.set(shiftId, shiftRow);
        }
      }

      // labor (1:1)
      if (p.labor) {
        const l = p.labor;
        laborMap.set(shiftId, {
          store_id: storeId,
          shift_id: shiftId,
          wage_type: l.wage_type ?? null,
          scheduled_hours: l.scheduled_hours ?? null,
          scheduled_overtime: l.scheduled_overtime ?? null,
          scheduled_regular: l.scheduled_regular ?? null,
          scheduled_daily_overtime: l.scheduled_daily_overtime ?? null,
          scheduled_weekly_overtime: l.scheduled_weekly_overtime ?? null,
          scheduled_double_overtimes: l.scheduled_double_overtimes ?? null,
          scheduled_seventh_day_overtime_15: l.scheduled_seventh_day_overtime_15 ?? null,
          scheduled_seventh_day_overtime_20: l.scheduled_seventh_day_overtime_20 ?? null,
          scheduled_unpaid_breaks_hours: l.scheduled_unpaid_breaks_hours ?? null,
          scheduled_costs: l.scheduled_costs ?? null,
          scheduled_overtime_costs: l.scheduled_overtime_costs ?? null,
          scheduled_spread_of_hours: l.scheduled_spread_of_hours ?? null,
          scheduled_blue_laws_hours: l.scheduled_blue_laws_hours ?? null,
        });
      }

      if ((i + 1) % 200 === 0 || i + 1 === totalOriginal) {
        logStep(this.logger, 'armando', i + 1, totalOriginal, tBuild);
      }
    }

    const shiftRows = Array.from(shiftsMap.values());
    const laborRows = Array.from(laborMap.values());

    this.logger.log(
      `[hb_shifts] Listo para upsert: shifts=${shiftRows.length} labor=${laborRows.length}`,
    );

    // 2) Upsert en orden: shifts -> labor (FK depende de shifts)
    await this.upsertWithProgress('stores_homebase_shifts', shiftRows, 'store_id,id');

    if (laborRows.length) {
      await this.upsertWithProgress('homebase_shifts_labor', laborRows, 'store_id,shift_id');
    }

    const elapsed = Date.now() - t0;
    this.logger.log(
      `[hb_shifts] Lote completado (shifts=${shiftRows.length}) store_id=${storeId} • ${fmtMs(elapsed)}`,
    );

    return {
      ok: true,
      processed: shiftRows.length,
      shifts: shiftRows.length,
      labor: laborRows.length,
      elapsedMs: elapsed,
    };
  }

  private async upsertWithProgress(table: string, rows: any[], onConflict: string) {
    if (!rows.length) return;

    const total = rows.length;
    const t0 = Date.now();
    let done = 0;

    await this.execWithAdaptiveRetry<any>(`upsert ${table}`, this.UPSERT_CHUNK, rows, async (batch) => {
      const r = await this.sb.from(table).upsert(batch, { onConflict });
      if (r.error) throw r.error;

      done += batch.length;
      logStep(this.logger, `upserting ${table}`, done, total, t0);
    });
  }
}
