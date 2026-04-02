// src/modules/homebase/services/homebase-employees-import.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { HomebaseEmployeeDto } from '../dtos/homebase_employee.dto';

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

function toTextOrNull(v: any): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}

function logStep(logger: Logger, label: string, done: number, total: number, t0?: number) {
    const left = total - done;
    const base = `[hb_employees] ${label} ${done}/${total} (faltan ${left})`;
    if (t0) {
        const ms = Date.now() - t0;
        logger.log(`${base} • ${fmtMs(ms)}`);
    } else {
        logger.log(base);
    }
}

function parseIsoMs(s?: string | null): number {
    if (!s) return 0;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
}

function toUuidOrNull(v: any): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}

@Injectable()
export class HomebaseEmployeesImportService {
    private readonly logger = new Logger(HomebaseEmployeesImportService.name);

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
     * Importa/upsertea empleados y jobs de Homebase.
     *
     * Tablas:
     * - homebase_employees       PK: (store_id, homebase_employee_id)
     * - homebase_employee_jobs   PK: (store_id, homebase_job_id)
     *                            UNIQUE: (store_id, homebase_employee_id)  -- 1 job por empleado
     */
    async importMany(storeId: number, payloads: HomebaseEmployeeDto[]) {
        if (!Array.isArray(payloads)) {
            throw new BadRequestException('HomebaseEmployeeDto[] requerido');
        }
        if (!Number.isFinite(storeId as any)) {
            throw new BadRequestException(`storeId inválido: ${storeId}`);
        }

        const totalOriginal = payloads.length;
        if (!totalOriginal) {
            this.logger.log('[hb_employees] No hay employees que procesar.');
            return { ok: true, processed: 0, employees: 0, jobs: 0, elapsedMs: 0 };
        }

        const t0 = Date.now();
        this.logger.log(`[hb_employees] Importando lote: ${totalOriginal} employees para store_id=${storeId}`);

        // 1) build / validate / dedup
        const tBuild = Date.now();
        const employeesMap = new Map<number, any>();
        const jobsMap = new Map<number, any>();

        for (let i = 0; i < totalOriginal; i++) {
            const p = payloads[i];

            if (!Number.isFinite(p?.id as any)) {
                throw new BadRequestException(`employee.id inválido en índice ${i}: ${p?.id}`);
            }

            const employeeId = Number(p.id);

            const employeeRow = {
                store_id: storeId,
                homebase_employee_id: employeeId,
                first_name: p.first_name ?? null,
                last_name: p.last_name ?? null,
                email: p.email ?? null,
                phone: p.phone ?? null,
                created_at: p.created_at ?? null,
                updated_at: p.updated_at ?? null,
            };

            // dedup por employee_id, preferimos el más nuevo por updated_at
            const existingEmp = employeesMap.get(employeeId);
            if (!existingEmp) {
                employeesMap.set(employeeId, employeeRow);
            } else {
                const prevUpd = parseIsoMs(existingEmp.updated_at);
                const curUpd = parseIsoMs(employeeRow.updated_at);
                if (curUpd >= prevUpd) {
                    employeesMap.set(employeeId, employeeRow);
                }
            }

            // job (1:1)
            if (p.job && Number.isFinite(p.job.id as any)) {
                const job = p.job;
                const jobId = Number(job.id);

                const jobRow = {
                    store_id: storeId,
                    homebase_employee_id: employeeId,
                    homebase_job_id: jobId,
                    level: job.level ?? null,
                    default_role: job.default_role ?? null,
                    pin: job.pin ?? null,
                    pos_partner_id: job.pos_partner_id ?? null,
                    payroll_id: toTextOrNull(job.payroll_id),
                    wage_rate: job.wage_rate == null ? null : Number(job.wage_rate),
                    wage_type: job.wage_type ?? null,
                    roles: Array.isArray(job.roles) ? job.roles : [],
                    archived_at: job.archived_at ?? null,
                    location_uuid: toUuidOrNull(job.location_uuid),
                };

                // dedup por job_id; como no viene job.updated_at, usamos employee.updated_at como proxy
                const existingJob = jobsMap.get(jobId);
                if (!existingJob) {
                    jobsMap.set(jobId, jobRow);
                } else {
                    const prevUpd = parseIsoMs(existingJob.__employee_updated_at);
                    const curUpd = parseIsoMs(employeeRow.updated_at);
                    if (curUpd >= prevUpd) {
                        jobsMap.set(jobId, { ...jobRow, __employee_updated_at: employeeRow.updated_at ?? null });
                    }
                }

                // guardamos proxy solo internamente
                const current = jobsMap.get(jobId);
                if (current && current.__employee_updated_at == null) {
                    current.__employee_updated_at = employeeRow.updated_at ?? null;
                }
            }

            if ((i + 1) % 200 === 0 || i + 1 === totalOriginal) {
                logStep(this.logger, 'armando', i + 1, totalOriginal, tBuild);
            }
        }

        const employeeRows = Array.from(employeesMap.values());
        const jobRows = Array.from(jobsMap.values()).map((r) => {
            const { __employee_updated_at, ...clean } = r;
            return clean;
        });

        this.logger.log(
            `[hb_employees] Listo para upsert: employees=${employeeRows.length} jobs=${jobRows.length}`,
        );

        // 2) upsert en orden: employees -> jobs
        await this.upsertWithProgress(
            'homebase_employees',
            employeeRows,
            'store_id,homebase_employee_id',
        );

        if (jobRows.length) {
            await this.upsertWithProgress(
                'homebase_employee_jobs',
                jobRows,
                'store_id,homebase_employee_id',
            );
        }

        const elapsed = Date.now() - t0;
        this.logger.log(
            `[hb_employees] Lote completado store_id=${storeId} • ${fmtMs(elapsed)} (employees=${employeeRows.length} jobs=${jobRows.length})`,
        );

        return {
            ok: true,
            processed: employeeRows.length,
            employees: employeeRows.length,
            jobs: jobRows.length,
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
