// src/modules/homebase/services/homebase-timecards-import.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { HomebaseTimecardDto } from '../dtos/timecard.dto';

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
  const base = `[hb_timecards] ${label} ${done}/${total} (faltan ${left})`;
  if (t0) {
    const ms = Date.now() - t0;
    logger.log(`${base} • ${fmtMs(ms)}`);
  } else {
    logger.log(base);
  }
}

@Injectable()
export class HomebaseTimecardsImportService {
  private readonly logger = new Logger(HomebaseTimecardsImportService.name);

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
   * Importa/upsertea timecards, labor y timebreaks de Homebase.
   *
   * Tablas:
   * - stores_homebase_timecards        PK: (store_id, id)
   * - homebase_timecards_labor         PK: (store_id, timecard_id)
   * - homebase_timecards_timebreaks    PK: (store_id, id)
   */
  async importMany(storeId: number, payloads: HomebaseTimecardDto[]) {
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('HomebaseTimecardDto[] requerido');
    }
    if (!Number.isFinite(storeId as any)) {
      throw new BadRequestException(`storeId inválido: ${storeId}`);
    }

    const totalOriginal = payloads.length;
    if (!totalOriginal) {
      this.logger.log('[hb_timecards] No hay timecards que procesar.');
      return { ok: true, processed: 0, elapsedMs: 0 };
    }

    const t0 = Date.now();
    this.logger.log(`[hb_timecards] Importando lote: ${totalOriginal} timecards para store_id=${storeId}`);

    // 1) Construcción / validación / dedup
    const tBuild = Date.now();
    const timecardsMap = new Map<number, any>();
    const laborMap = new Map<number, any>();
    const breaksMap = new Map<number, any>(); // break.id -> row
    const breaksByTimecard = new Map<number, number[]>(); // timecard_id -> [break ids]

    for (let i = 0; i < totalOriginal; i++) {
      const p = payloads[i];

      if (!Number.isFinite(p?.id as any)) {
        throw new BadRequestException(`timecard.id inválido en índice ${i}: ${p?.id}`);
      }
      if (!Number.isFinite(p?.user_id as any)) {
        throw new BadRequestException(`timecard.user_id inválido en índice ${i}: ${p?.user_id}`);
      }

      const timecardId = Number(p.id);

      // --- row principal ---
      const tcRow = {
        store_id: storeId,
        id: timecardId,
        user_id: Number(p.user_id),
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        payroll_id: p.payroll_id ?? null,
        job_id: p.job_id == null ? null : Number(p.job_id),
        shift_id: p.shift_id == null ? null : Number(p.shift_id),
        role: p.role ?? null,
        department: p.department ?? null,
        approved: !!p.approved,
        created_at: p.created_at ?? null,
        updated_at: p.updated_at ?? null,
        clock_in: p.clock_in ?? null,
        clock_out: p.clock_out ?? null,
      };

      // si vienen duplicados del mismo timecard en el mismo lote, preferimos el más nuevo por updated_at
      const existingTc = timecardsMap.get(timecardId);
      if (!existingTc) {
        timecardsMap.set(timecardId, tcRow);
      } else {
        const prevUpd = existingTc.updated_at ? Date.parse(existingTc.updated_at) : 0;
        const curUpd = tcRow.updated_at ? Date.parse(tcRow.updated_at) : 0;
        if (curUpd >= prevUpd) {
          timecardsMap.set(timecardId, tcRow);
        }
      }

      // --- labor (1:1) ---
      if (p.labor) {
        const l = p.labor;
        laborMap.set(timecardId, {
          store_id: storeId,
          timecard_id: timecardId,
          wage_type: l.wage_type ?? null,
          break_penalty: l.break_penalty ?? null,
          costs: l.costs ?? null,
          cash_tips: l.cash_tips ?? null,
          credit_tips: l.credit_tips ?? null,
          weekly_overtime: l.weekly_overtime ?? null,
          paid_time_off_hours: l.paid_time_off_hours ?? null,
          time_off_hours: l.time_off_hours ?? null,
          unpaid_break_hours: l.unpaid_break_hours ?? null,
          regular_hours: l.regular_hours ?? null,
          paid_hours: l.paid_hours ?? null,
          scheduled_hours: l.scheduled_hours ?? null,
          daily_overtime: l.daily_overtime ?? null,
          double_overtime: l.double_overtime ?? null,
          seventh_day_overtime_15: l.seventh_day_overtime_15 ?? null,
          seventh_day_overtime_20: l.seventh_day_overtime_20 ?? null,
          wage_rate: l.wage_rate ?? null,
        });
      }

      // --- breaks (1:N) ---
      const breaks = Array.isArray(p.timebreaks) ? p.timebreaks : [];
      const keepIds: number[] = [];

      for (const b of breaks) {
        if (!Number.isFinite(b?.id as any)) {
          throw new BadRequestException(`timebreak.id inválido (timecard=${timecardId})`);
        }
        if (!Number.isFinite(b?.timecard_id as any)) {
          throw new BadRequestException(`timebreak.timecard_id inválido (break=${b?.id})`);
        }

        const breakId = Number(b.id);
        keepIds.push(breakId);

        breaksMap.set(breakId, {
          store_id: storeId,
          id: breakId,
          timecard_id: timecardId,
          mandated_break_id: b.mandated_break_id == null ? null : Number(b.mandated_break_id),
          paid: !!b.paid,
          duration: b.duration == null ? null : Number(b.duration),
          work_period: b.work_period == null ? null : Number(b.work_period),
          created_at: b.created_at ?? null,
          updated_at: b.updated_at ?? null,
          start_at: b.start_at ?? null,
          end_at: b.end_at ?? null,
        });
      }

      breaksByTimecard.set(timecardId, keepIds);

      if ((i + 1) % 200 === 0 || i + 1 === totalOriginal) {
        logStep(this.logger, 'armando', i + 1, totalOriginal, tBuild);
      }
    }

    const timecardRows = Array.from(timecardsMap.values());
    const laborRows = Array.from(laborMap.values());
    const breakRows = Array.from(breaksMap.values());

    this.logger.log(
      `[hb_timecards] Listo para upsert: timecards=${timecardRows.length} labor=${laborRows.length} breaks=${breakRows.length}`,
    );

    // 2) Upsert en orden: timecards -> labor -> breaks
    await this.upsertWithProgress('stores_homebase_timecards', timecardRows, 'store_id,id');

    if (laborRows.length) {
      await this.upsertWithProgress('homebase_timecards_labor', laborRows, 'store_id,timecard_id');
    }

    if (breakRows.length) {
      await this.upsertWithProgress('homebase_timecards_timebreaks', breakRows, 'store_id,id');
    }

    // 3) Cleanup de breaks por timecard (borra breaks viejos que ya no vienen)
    await this.cleanupBreaks(storeId, breaksByTimecard);

    const elapsed = Date.now() - t0;
    this.logger.log(
      `[hb_timecards] Lote completado (timecards=${timecardRows.length}) store_id=${storeId} • ${fmtMs(elapsed)}`,
    );

    return {
      ok: true,
      processed: timecardRows.length,
      timecards: timecardRows.length,
      labor: laborRows.length,
      breaks: breakRows.length,
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

  private async cleanupBreaks(storeId: number, breaksByTimecard: Map<number, number[]>) {
    const timecardIds = Array.from(breaksByTimecard.keys());
    if (!timecardIds.length) return;

    const t0 = Date.now();
    this.logger.log(`[hb_timecards] Limpieza breaks: ${timecardIds.length} timecards`);

    let done = 0;

    for (const timecardId of timecardIds) {
      const keepIds = breaksByTimecard.get(timecardId) ?? [];

      let q = this.sb
        .from('homebase_timecards_timebreaks')
        .delete()
        .eq('store_id', storeId)
        .eq('timecard_id', timecardId);

      if (keepIds.length) {
        q = q.not('id', 'in', `(${keepIds.join(',')})`);
      }

      const res = await q;
      if (res.error) throw res.error;

      done++;
      if (done % 50 === 0 || done === timecardIds.length) {
        logStep(this.logger, 'cleanup breaks', done, timecardIds.length, t0);
      }

      if (this.INTER_BATCH_SLEEP_MS) {
        await this.sleep(this.INTER_BATCH_SLEEP_MS);
      }
    }
  }
}
