// src/modules/inventory/services/reporting-inventory-transactions.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { InventoryTransactionDto } from '../dtos/inventory-transaction.dto';

/* ---------------- helpers de logging ---------------- */

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
    label: string,
    done: number,
    total: number,
    t0?: number,
) {
    const left = total - done;
    const base = `[inv_tx] ${label} ${done}/${total} (faltan ${left})`;
    if (t0) {
        const ms = Date.now() - t0;
        logger.log(`${base} • ${fmtMs(ms)}`);
    } else {
        logger.log(base);
    }
}


@Injectable()
export class InventoryTransactionsService {
    private readonly logger = new Logger(InventoryTransactionsService.name);

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
                    if (
                        this.isStatementTimeout(e) &&
                        chunkSize > this.MIN_CHUNK &&
                        attempt < this.MAX_RETRIES
                    ) {
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
     * Importa / upsertea transacciones de inventario en
     * public.stores_inventory_transactions
     *
     * Clave lógica:
     *   inventory_transaction_id
     */
    async importMany(storeId: number, payloads: InventoryTransactionDto[]) {
        if (!Array.isArray(payloads)) {
            throw new BadRequestException('InventoryTransactionDto[] requerido');
        }

        if (!Number.isFinite(storeId as any)) {
            throw new BadRequestException(`storeId inválido: ${storeId}`);
        }

        const totalOriginal = payloads.length;
        if (!totalOriginal) {
            this.logger.log('[inv_tx] No hay transacciones que procesar.');
            return { ok: true, processed: 0, elapsedMs: 0 };
        }

        const t0 = Date.now();
        this.logger.log(
            `[inv_tx] Importando lote: ${totalOriginal} transacciones para store_id=${storeId}`,
        );

        const rows: any[] = [];

        for (let i = 0; i < totalOriginal; i++) {
            const p = payloads[i];

            if (!Number.isFinite(p.inventoryTransactionId as any)) {
                throw new BadRequestException(
                    `inventoryTransactionId inválido en índice ${i}`,
                );
            }
            if (!Number.isFinite(p.productId as any)) {
                throw new BadRequestException(`productId inválido en índice ${i}`);
            }
            if (!Number.isFinite(p.inventoryId as any)) {
                throw new BadRequestException(`inventoryId inválido en índice ${i}`);
            }
            if (!p.transactionDate) {
                throw new BadRequestException(
                    `transactionDate requerido en índice ${i}`,
                );
            }

            rows.push({
                inventory_transaction_id: p.inventoryTransactionId,
                store_id: storeId,

                transaction_type: p.transactionType ?? null,
                product: p.product ?? null,
                sku: p.sku ?? null,
                product_id: p.productId,
                unit: p.unit ?? null,
                package_id: p.packageId ?? null,
                external_package_id: p.externalPackageId ?? null,
                batch_id: p.batchId ?? null,
                batch_name: p.batchName ?? null,

                quantity: p.quantity ?? null,
                from_quantity: p.fromQuantity ?? null,
                to_quantity: p.toQuantity ?? null,
                reason: p.reason ?? null,

                receive_inventory_history_id:
                    p.receiveInventoryHistoryId ?? null,

                from_location: p.fromLocation ?? null,
                from_room: p.fromRoom ?? null,
                to_location: p.toLocation ?? null,
                to_room: p.toRoom ?? null,

                conversion_transaction_id:
                    p.conversionTransactionId ?? null,

                transaction_by: p.transactionBy ?? null,
                transaction_date: p.transactionDate,

                unit_cost: p.unitCost ?? null,
                purchase_order_id: p.purchaseOrderId ?? null,

                inventory_id: p.inventoryId,
            });

            if ((i + 1) % 500 === 0 || i + 1 === totalOriginal) {
                logStep(this.logger, 'armando payload', i + 1, totalOriginal);
            }
        }

        await this.upsertWithProgress(
            'stores_inventory_transactions',
            rows,
            'inventory_transaction_id',
        );

        const elapsed = Date.now() - t0;
        this.logger.log(
            `[inv_tx] Lote completado (${rows.length} transacciones, store_id=${storeId}) • ${fmtMs(elapsed)}`,
        );

        return { ok: true, processed: rows.length, elapsedMs: elapsed };
    }

    private async upsertWithProgress(
        table: string,
        rows: any[],
        onConflict: string,
    ) {
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
