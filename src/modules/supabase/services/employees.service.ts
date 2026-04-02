// src/modules/employees/services/employees.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { EmployeeDto } from '../dtos/employee.dto';
import stores from '../../../../config/stores.json';

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
  const base = `[employees] ${label} ${done}/${total} (faltan ${left})`;
  if (t0) {
    const ms = Date.now() - t0;
    logger.log(`${base} • ${fmtMs(ms)}`);
  } else {
    logger.log(base);
  }
}

function isBlank(v: any): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function looksLikeEmail(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (!s.includes('@')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

// ====== store_id resolution (sin aliases) ======
type Store = {
  id: string;
  name: string;
  location: string;
  is_active: boolean;
  dutchie_store_id?: string;
};

function buildStoreLocationMap(): Map<string, number> {
  const map = new Map<string, number>();

  for (const s of stores as Store[]) {
    if (!s?.is_active) continue;
    const key = String(s.name ?? '').trim().toLowerCase();
    const id = Number(s.id);
    if (!key || !Number.isFinite(id)) continue;
    map.set(key, id);
  }

  return map;
}

const STORE_LOCATION_MAP = buildStoreLocationMap();

const storeAliases: Record<string, string> = {
  'Wellgreens - Balboa': 'Wellgreens - Kearny Mesa',
  'Wellgreens - Home': 'Wellgreens - City Heights',
};

function aliasStoreName(name: string): string {
  const trimmed = (name ?? '').trim();
  return storeAliases[trimmed] ?? trimmed;
}

function normalizeStoreName(name: string): string {
  return (name ?? '').trim().toLowerCase();
}

// "X - X - Y" -> "X - Y"
function dedupeLeadingPrefix(value?: string | null): string {
  const v = (value ?? '').trim();
  if (!v) return v;

  const parts = v.split(/\s*-\s*/).filter(Boolean);
  while (parts.length >= 2 && parts[0] === parts[1]) {
    parts.shift();
  }
  return parts.join(' - ');
}

function resolveStoreIdFromPermissionsLocation(locationValue: any): number {
  const raw = String(locationValue ?? '').trim();
  if (!raw) {
    throw new Error('permissionsLocation vacío');
  }

  // 1) quitar repetición "Wellgreens - Wellgreens - X"
  const deduped = dedupeLeadingPrefix(raw);

  // 2) aplicar aliases (Balboa/Home)
  const aliased = aliasStoreName(deduped);

  // 3) intento match completo contra stores.json.name
  const normalizedFull = normalizeStoreName(aliased);
  const idFull = STORE_LOCATION_MAP.get(normalizedFull);
  if (idFull) return idFull;

  // 4) fallback: match por último segmento (por si stores.json.name es "Chula Vista")
  const lastSegment = aliased.split(/\s*-\s*/).filter(Boolean).pop() ?? '';
  const normalizedLast = normalizeStoreName(lastSegment);
  const idLast = STORE_LOCATION_MAP.get(normalizedLast);
  if (idLast) return idLast;

  throw new Error(
    `store_id no encontrado para permissionsLocation="${raw}" (deduped="${deduped}", aliased="${aliased}", normalizedFull="${normalizedFull}", normalizedLast="${normalizedLast}")`,
  );
}

@Injectable()
export class ReportingEmployeesService {
  private readonly logger = new Logger(ReportingEmployeesService.name);
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) { }

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

  async importMany(payloads: EmployeeDto[]) {
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('EmployeeDto[] requerido');
    }

    const total = payloads.length;
    if (!total) {
      this.logger.log('[employees] No hay employees que procesar.');
      return { ok: true, processed: 0, insertedOrUpdated: 0, skippedNoEmail: 0, deduped: 0 };
    }

    const t0 = Date.now();
    this.logger.log(`[employees] Importando lote: ${total} employees (raw)`);

    const byId = new Map<number, { id: number; email: string; full_name: string | null }>();

    let skippedNoEmail = 0;
    let invalidId = 0;

    const tBuild = Date.now();

    for (let i = 0; i < total; i++) {
      const p = payloads[i];

      if (!Number.isFinite(p?.userId as any)) {
        invalidId++;
        continue;
      }

      const loginId = (p?.loginId ?? '').toString();
      if (isBlank(loginId) || !looksLikeEmail(loginId)) {
        skippedNoEmail++;
      }

      const email = normalizeEmail(loginId);
      const id = Number(p.userId);

      if (!byId.has(id)) {
        byId.set(id, {
          id,
          email,
          full_name: p?.fullName ? String(p.fullName) : null,
        });
      }

      if ((i + 1) % 250 === 0 || i + 1 === total) {
        logStep(this.logger, 'armando', i + 1, total, tBuild);
      }
    }

    if (invalidId) {
      this.logger.warn(`[employees] Registros con userId inválido ignorados: ${invalidId}`);
    }

    const rows = Array.from(byId.values()).map((x) => ({
      id: x.id,
      login: x.email,
      email: x.email,
      full_name: x.full_name,
    }));

    const validEmailRows = total - skippedNoEmail - invalidId;
    const dedupedCount = Math.max(0, validEmailRows - rows.length);

    if (!rows.length) {
      const elapsed = Date.now() - t0;
      this.logger.warn(
        `[employees] No hay filas con email válido. skippedNoEmail=${skippedNoEmail}, invalidId=${invalidId} • ${fmtMs(
          elapsed,
        )}`,
      );
      return {
        ok: true,
        processed: total,
        insertedOrUpdated: 0,
        skippedNoEmail,
        invalidId,
        deduped: dedupedCount,
        elapsedMs: elapsed,
      };
    }

    this.logger.log(
      `[employees] Listo para upsert: raw=${total} | conEmail=${validEmailRows} | dedup=${dedupedCount} | final=${rows.length}`,
    );

    await this.upsertWithProgress('employees', rows, 'id');

    const elapsed = Date.now() - t0;
    this.logger.log(`[employees] Lote completado (${rows.length} filas) • ${fmtMs(elapsed)}`);

    return {
      ok: true,
      processed: total,
      insertedOrUpdated: rows.length,
      skippedNoEmail,
      invalidId,
      deduped: dedupedCount,
      elapsedMs: elapsed,
    };
  }

  // =========================
  // IMPORT RAW (Dutchie)
  // =========================
  async importManyRaw(payloads: EmployeeDto[]) {
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('EmployeeDto[] requerido');
    }

    const total = payloads.length;
    if (!total) {
      this.logger.log('[employees] No hay employees que procesar.');
      return { ok: true, processed: 0, insertedOrUpdated: 0, invalidId: 0, elapsedMs: 0 };
    }

    const t0 = Date.now();
    this.logger.log(`[employees] Importando lote: ${total} employees (raw)`);

    let invalidId = 0;
    let invalidStore = 0;

    const tBuild = Date.now();

    const rows: any[] = [];

    for (let i = 0; i < total; i++) {
      const p = payloads[i];

      if (!Number.isFinite(p?.userId as any)) {
        invalidId++;
        continue;
      }

      try {
        const storeId = resolveStoreIdFromPermissionsLocation((p as any).permissionsLocation);

        const rawGroups: unknown = (p as any).groups;

        const groups =
          Array.isArray(rawGroups)
            ? rawGroups.map((x) => String(x).trim()).filter(Boolean)
            : typeof rawGroups === 'string'
              ? rawGroups
                .trim()
                .replace(/^\[/, '')
                .replace(/\]$/, '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
              : null;

        rows.push({
          store_id: storeId,
          user_id: (p as any).userId,
          global_user_id: (p as any).globalUserId ?? null,
          login_id: (p as any).loginId ?? null,
          full_name: (p as any).fullName ?? null,
          default_location: (p as any).defaultLocation ?? null,
          status: (p as any).status ?? null,
          state_id: (p as any).stateId ?? null,
          mmj_expiration: (p as any).mmjExpiration ?? null,
          permissions_location: (p as any).permissionsLocation ?? null,
          groups,
        });
      } catch {
        invalidStore++;
        continue;
      }

      if ((i + 1) % 250 === 0 || i + 1 === total) {
        logStep(this.logger, 'armando', i + 1, total, tBuild);
      }
    }

    if (invalidId) {
      this.logger.warn(`[employees] Registros con userId inválido ignorados: ${invalidId}`);
    }
    if (invalidStore) {
      this.logger.warn(`[employees] Registros con store_id no resoluble ignorados: ${invalidStore}`);
    }

    if (!rows.length) {
      const elapsed = Date.now() - t0;
      this.logger.warn(
        `[employees] No hay filas válidas para dutchie_employees_raw. invalidId=${invalidId}, invalidStore=${invalidStore} • ${fmtMs(
          elapsed,
        )}`,
      );
      return {
        ok: true,
        processed: total,
        insertedOrUpdated: 0,
        invalidId,
        invalidStore,
        elapsedMs: elapsed,
      };
    }

    this.logger.log(
      `[employees] Listo para upsert RAW: raw=${total} | final=${rows.length} | invalidId=${invalidId} | invalidStore=${invalidStore}`,
    );

    // upsert a tu tabla RAW, usando tu unique (store_id, user_id)
    await this.upsertWithProgress('dutchie_employees_raw', rows, 'store_id,user_id');

    const elapsed = Date.now() - t0;
    this.logger.log(`[employees] Lote RAW completado (${rows.length} filas) • ${fmtMs(elapsed)}`);

    return {
      ok: true,
      processed: total,
      insertedOrUpdated: rows.length,
      invalidId,
      invalidStore,
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