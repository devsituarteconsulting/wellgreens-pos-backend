// src/modules/dutchie/services/dutchie-transactions-import.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { TransactionDto } from '../dtos/transaction.dto';

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
function logStep(logger: Logger, storeId: number, label: string, done: number, total: number, t0?: number) {
    const left = total - done;
    const base = `[store:${storeId}] ${label} ${done}/${total} (faltan ${left})`;
    if (t0) {
        const ms = Date.now() - t0;
        logger.log(`${base} • ${fmtMs(ms)}`);
    } else {
        logger.log(base);
    }
}
function chunk<T>(arr: T[], size: number): T[][] {
    if (!arr.length) return [];
    if (size <= 0 || arr.length <= size) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}
const toBigintArray = (arr: any[] | null | undefined): number[] | null => {
    if (!Array.isArray(arr)) return null;
    const out = arr.map((v) => Number(v)).filter(Number.isFinite);
    return out.length ? out : []; // o null si prefieres guardar null
};

@Injectable()
export class TransactionsImportService {
    private readonly logger = new Logger(TransactionsImportService.name);
    constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) { }

    // Tamaños de lote (ajustados)
    private readonly UPSERT_CHUNK = 2000;
    private readonly ID_CHUNK = 100;
    private readonly INSERT_CHUNK = 2000;

    // Límites para adaptación
    private readonly MIN_CHUNK = 100;          // no bajar de esto
    private readonly MAX_RETRIES = 4;          // por batch
    private readonly INTER_BATCH_SLEEP_MS = 25;

    private readonly ID_CHUNK_BY_TABLE: Record<string, number> = {
        transaction_item_taxes: 120,
        transaction_item_discounts: 40,
        transaction_discounts: 60,           // <- más conservador
        transaction_fees_donations: 150,
        transaction_tax_summary: 120,
        transaction_manual_payments: 150,
        transaction_integrated_payments: 150,
    };


    private async sleep(ms: number) {
        await new Promise((res) => setTimeout(res, ms));
    }

    private isStatementTimeout(e: any): boolean {
        const code = e?.code || e?.details?.code || e?.error?.code;
        const msg = e?.message || e?.error?.message;
        return code === '57014' || /statement timeout/i.test(msg ?? '');
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
                        this.logger.warn(`[ADAPT] ${label}: timeout, bajo chunk ${prev} -> ${chunkSize} (retry ${attempt + 1})`);
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

    private readonly deleteRpcByTable: Record<string, string> = {
        transaction_item_taxes: 'delete_transaction_item_taxes_by_txids',           // si no usa store_id
        transaction_item_discounts: 'delete_transaction_item_discounts_by_txids',   // ahora recibe store
        transaction_discounts: 'delete_transaction_discounts_by_txids',
        transaction_fees_donations: 'delete_transaction_fees_donations_by_txids',
        transaction_tax_summary: 'delete_transaction_tax_summary_by_txids',
        transaction_manual_payments: 'delete_transaction_manual_payments_by_txids',
        transaction_integrated_payments: 'delete_transaction_integrated_payments_by_txids',
    };


    private async rpcDeleteByTxIds(table: string, storeId: number, ids: number[]) {
        const fn = this.deleteRpcByTable[table];
        if (!fn) throw new Error(`no hay rpc de borrado para la tabla: ${table}`);
        const args: any = { t_ids: ids };
        if (table === 'transaction_item_discounts') {
            args.p_store_id = storeId; // <- pasa store
        }
        const r = await this.sb.rpc(fn, args);
        if (r.error) {
            r.error.message = `[${table}] ${r.error.message}`;
            throw r.error;
        }
    }



    /**
     * Importa SIEMPRE un array de transacciones para una tienda.
     * - stores_transactions: UPSERT (sin borrar)
     * - transaction_items: UPSERT (sin borrar)
     * - Hijas: DELETE por set de transaction_id + INSERT en bulk (con progreso)
     */
    async importMany(payloads: TransactionDto[], storeIdStr: string) {
        if (!Array.isArray(payloads)) throw new BadRequestException('TransactionDto[] requerido');
        const storeId = Number.parseInt(storeIdStr);
        if (!Number.isFinite(storeId) || storeId <= 0) throw new BadRequestException(`storeId inválido: ${storeId}`);

        const total = payloads.length;
        if (!total) {
            this.logger.log(`[store:${storeId}] No hay transacciones que procesar.`);
            return { ok: true, processed: 0 };
        }

        const t0 = Date.now();
        this.logger.log(`[store:${storeId}] Importando lote: ${total} transacciones`);

        // Buffers
        const txRows: any[] = [];
        const itemRows: any[] = [];

        const itemDiscountRows: any[] = [];  // descuentos de items
        const itemTaxRows: any[] = [];       // impuestos de items

        const txDiscountRows: any[] = [];    // descuentos a nivel transacción
        const feeRows: any[] = [];
        const taxSumRows: any[] = [];
        const manualPayRows: any[] = [];
        const integratedPayRows: any[] = [];

        const txids: number[] = [];

        // ---------- 1) Armado (con progreso) ----------
        const tBuild = Date.now();
        for (let i = 0; i < total; i++) {
            const p = payloads[i];
            const txid = p.transactionId;
            if (!Number.isFinite(txid)) throw new BadRequestException(`transactionId inválido: ${p?.transactionId}`);
            txids.push(txid);

            // stores_transactions (UPSERT)
            txRows.push({
                transaction_id: p.transactionId,
                store_id: storeId,
                customer_id: p.customerId ?? null,
                employee_id: p.employeeId ?? null,
                transaction_date: p.transactionDate,
                void_date: p.voidDate ?? null,
                is_void: p.isVoid ?? false,

                subtotal: p.subtotal,
                total_discount: p.totalDiscount,
                total_before_tax: p.totalBeforeTax,
                tax: p.tax,
                tip_amount: p.tipAmount ?? null,
                total: p.total,
                paid: p.paid,
                change_due: p.changeDue,

                total_items: p.totalItems,
                terminal_name: p.terminalName ?? null,
                check_in_date: p.checkInDate ?? null,
                invoice_number: p.invoiceNumber ?? null,

                is_tax_inclusive: p.isTaxInclusive ?? false,
                transaction_type: p.transactionType ?? null,

                loyalty_earned: p.loyaltyEarned ?? null,
                loyalty_spent: p.loyaltySpent ?? null,

                last_modified_date_utc: p.lastModifiedDateUTC,

                cash_paid: p.cashPaid ?? null,
                debit_paid: p.debitPaid ?? null,
                electronic_paid: p.electronicPaid ?? null,
                electronic_payment_method: p.electronicPaymentMethod ?? null,
                check_paid: p.checkPaid ?? null,
                credit_paid: p.creditPaid ?? null,
                gift_paid: p.giftPaid ?? null,
                mmap_paid: p.mmapPaid ?? null,
                pre_payment_amount: p.prePaymentAmount ?? null,

                revenue_fees_and_donations: p.revenueFeesAndDonations ?? null,
                non_revenue_fees_and_donations: p.nonRevenueFeesAndDonations ?? null,

                return_on_transaction_id: p.returnOnTransactionId ?? null,
                adjustment_for_transaction_id: p.adjustmentForTransactionId ?? null,

                order_type: p.orderType ?? null,
                was_pre_ordered: p.wasPreOrdered ?? false,
                order_source: p.orderSource ?? null,
                order_method: p.orderMethod ?? null,
                invoice_name: p.invoiceName ?? null,

                is_return: p.isReturn ?? false,
                auth_code: p.authCode ?? null,

                customer_type_id: p.customerTypeId,
                is_medical: p.isMedical ?? false,

                order_ids: toBigintArray(p.orderIds),

                total_credit: p.totalCredit,
                completed_by_user: p.completedByUser ?? null,
                responsible_for_sale_user_id: p.responsibleForSaleUserId,

                transaction_date_local_time: p.transactionDateLocalTime,
                est_time_arrival_local: p.estTimeArrivalLocal ?? null,
                est_delivery_date_local: p.estDeliveryDateLocal ?? null,

                reference_id: p.referenceId ?? null,
            });

            // transaction_items (UPSERT)
            for (const it of p.items || []) {
                const qids = Array.isArray(it.qualifiedForDiscountIds)
                    ? it.qualifiedForDiscountIds.map(Number).filter(Number.isFinite)
                    : null;

                itemRows.push({
                    transaction_id: txid,
                    transaction_item_id: it.transactionItemId ?? null,
                    store_id: storeId,

                    product_id: it.productId,
                    inventory_id: it.inventoryId ?? null,
                    unit_id: it.unitId ?? null,

                    total_price: it.totalPrice,
                    quantity: it.quantity,
                    unit_price: it.unitPrice,
                    unit_cost: it.unitCost ?? null,

                    package_id: it.packageId ?? null,
                    source_package_id: it.sourcePackageId ?? null,
                    batch_name: it.batchName ?? null,

                    total_discount: it.totalDiscount ?? null,

                    unit_weight: it.unitWeight ?? null,
                    unit_weight_unit: it.unitWeightUnit ?? null,
                    flower_equivalent: it.flowerEquivalent ?? null,
                    flower_equivalent_unit: it.flowerEquivalentUnit ?? null,

                    return_date: it.returnDate ?? null,
                    is_returned: it.isReturned ?? false,
                    returned_by_transaction_id: it.returnedByTransactionId ?? null,
                    return_reason: it.returnReason ?? null,

                    vendor: it.vendor ?? null,
                    is_coupon: it.isCoupon ?? false,

                    qualified_for_discount_ids: toBigintArray(qids && qids.length ? qids : null),
                });

                // descuentos de item
                for (const d of it.discounts || []) {
                    itemDiscountRows.push({
                        transaction_id: txid,
                        transaction_item_id: it.transactionItemId ?? null,
                        store_id: storeId,
                        discount_id: d.discountId ?? null,
                        discount_name: d.discountName ?? null,
                        discount_reason: d.discountReason ?? null,
                        amount: d.amount,
                    });
                }
                // impuestos de item
                for (const t of it.taxes || []) {
                    itemTaxRows.push({
                        transaction_id: txid,
                        transaction_item_id: it.transactionItemId ?? null,
                        store_id: storeId,
                        rate_name: t.rateName ?? null,
                        rate: t.rate,
                        amount: t.amount,
                    });
                }
            }

            // nivel transacción
            for (const d of p.discounts || []) {
                txDiscountRows.push({
                    transaction_id: txid,
                    store_id: storeId,
                    discount_id: d.discountId ?? null,
                    discount_name: d.discountName ?? null,
                    discount_reason: d.discountReason ?? null,
                    amount: d.amount,
                    transaction_item_id: d.transactionItemId ?? null,
                });
            }
            for (const f of p.feesAndDonations || []) {
                feeRows.push({
                    transaction_id: txid,
                    store_id: storeId,
                    fee_donation_id: f.feeDonationId ?? null,
                    description: f.description ?? null,
                    amount: f.amount,
                    is_revenue: f.isRevenue,
                });
            }
            for (const t of p.taxSummary || []) {
                taxSumRows.push({
                    transaction_id: txid,
                    store_id: storeId,
                    rate_name: t.rateName ?? null,
                    amount: t.amount,
                });
            }
            for (const m of p.manualPayments || []) {
                manualPayRows.push({
                    transaction_id: txid,
                    store_id: storeId,
                    manual_payment_processor_name: m.manualPaymentProcessorName ?? null,
                    manual_paid: m.manualPaid,
                });
            }
            for (const i of p.integratedPayments || []) {
                integratedPayRows.push({
                    transaction_id: txid,
                    store_id: storeId,
                    integration_type: i.integrationType ?? null,
                    integrated_paid: i.integratedPaid,
                    external_payment_id: i.externalPaymentId ?? null,
                });
            }

            if ((i + 1) % 200 === 0 || i + 1 === total) {
                logStep(this.logger, storeId, 'armando', i + 1, total, tBuild);
            }
        }

        // ---------- 2) UPSERT raíz (adaptativo) ----------
        await this.upsertWithProgress('stores_transactions', txRows, storeId, 'transaction_id');

        // ---------- 3) UPSERT items (adaptativo) ----------
        await this.upsertWithProgress(
            'transaction_items',
            itemRows,
            storeId,
            'store_id,transaction_id,transaction_item_id',
        );

        // ---------- 4) DELETE hijas por IN (adaptativo) ----------
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_item_taxes`);
        await this.deleteByTxIdsWithProgress('transaction_item_taxes', 'borrando item_taxes', txids, storeId);
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_item_discounts`);
        await this.deleteByTxIdsWithProgress('transaction_item_discounts', 'borrando item_discounts', txids, storeId);
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_discounts`);
        await this.deleteByTxIdsWithProgress('transaction_discounts', 'borrando tx_discounts', txids, storeId);
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_fees_donations`);
        await this.deleteByTxIdsWithProgress('transaction_fees_donations', 'borrando fees_donations', txids, storeId);
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_tax_summary`);
        await this.deleteByTxIdsWithProgress('transaction_tax_summary', 'borrando tax_summary', txids, storeId);
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_manual_payments`);
        await this.deleteByTxIdsWithProgress('transaction_manual_payments', 'borrando manual_payments', txids, storeId);
        this.logger.log(`[store:${storeId}] >>> DELETE stage on: transaction_integrated_payments`);
        await this.deleteByTxIdsWithProgress('transaction_integrated_payments', 'borrando integrated_payments', txids, storeId);

        // ---------- 5) INSERT hijas (adaptativo) ----------
        await this.insertWithProgress('transaction_item_taxes', 'insertando item_taxes', itemTaxRows, storeId);
        await this.insertWithProgress('transaction_item_discounts', 'insertando item_discounts', itemDiscountRows, storeId);
        await this.insertWithProgress('transaction_discounts', 'insertando tx_discounts', txDiscountRows, storeId);
        await this.insertWithProgress('transaction_fees_donations', 'insertando fees_donations', feeRows, storeId);
        await this.insertWithProgress('transaction_tax_summary', 'insertando tax_summary', taxSumRows, storeId);
        await this.insertWithProgress('transaction_manual_payments', 'insertando manual_payments', manualPayRows, storeId);
        await this.insertWithProgress('transaction_integrated_payments', 'insertando integrated_payments', integratedPayRows, storeId);

        // ---------- Fin ----------
        const elapsed = Date.now() - t0;
        this.logger.log(`[store:${storeId}] Lote completado (${total} tx) • ${fmtMs(elapsed)}`);
        return { ok: true, processed: total, elapsedMs: elapsed };
    }

    // ===== helpers con progreso (ADAPTATIVOS) =====
    private async upsertWithProgress(table: string, rows: any[], storeId: number, onConflict: string) {
        if (!rows.length) return;
        const total = rows.length;
        const t0 = Date.now();
        let done = 0;

        await this.execWithAdaptiveRetry<any>(
            `upsert ${table} [store:${storeId}]`,
            this.UPSERT_CHUNK,
            rows,
            async (batch) => {
                const r = await this.sb.from(table).upsert(batch, { onConflict });
                if (r.error) throw r.error;
                done += batch.length;
                logStep(this.logger, storeId, `upserting ${table}`, done, total, t0);
            },
        );
    }

    private async deleteByTxIdsWithProgress(table: string, label: string, txids: number[], storeId: number) {
        if (!txids.length) return;
        const total = txids.length;
        const t0 = Date.now();
        let done = 0;

        const chunkSize = this.ID_CHUNK_BY_TABLE[table] ?? this.ID_CHUNK; // usar override

        await this.execWithAdaptiveRetry<number>(
            `${label} ${table} [store:${storeId}]`,
            chunkSize,
            txids,
            async (ids) => {
                await this.rpcDeleteByTxIds(table, storeId, ids,);
                done += ids.length;
                logStep(this.logger, storeId, label, done, total, t0);
            },
        );
    }


    private async insertWithProgress(table: string, label: string, rows: any[], storeId: number) {
        if (!rows.length) return;
        const total = rows.length;
        const t0 = Date.now();
        let done = 0;

        await this.execWithAdaptiveRetry<any>(
            `${label} ${table} [store:${storeId}]`,
            this.INSERT_CHUNK,
            rows,
            async (batch) => {
                const r = await this.sb.from(table).insert(batch);
                if (r.error) throw r.error;
                done += batch.length;
                logStep(this.logger, storeId, label, done, total, t0);
            },
        );
    }
}
