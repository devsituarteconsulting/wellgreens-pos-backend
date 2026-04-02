// src/modules/wg-pos/services/receipts-import.service.ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from 'src/common/supabase/supabase.provider';
import { ReceiptsResolveService } from './receipts-resolve.service';
import { createHash } from 'crypto';

type Row = Record<string, any>;

@Injectable()
export class ReceiptsImportService {
    constructor(
        @Inject(SUPABASE) private readonly supabase: SupabaseClient,
        private readonly resolver: ReceiptsResolveService,
    ) { }

    async import(_buffer: Buffer): Promise<{
        total_rows: number;
        inserted: number;
        updated: number;
        unchanged: number;
        unresolved: number;
        failed: number;
        errors: Array<{ index: number; error: string }>;
        sample: Row[];
    }> {
        throw new Error('Este servicio espera recibir filas normalizadas. Usa importNormalized().');
    }

    async importNormalized(rowsNormalized: Record<string, any>[]) {


        const total_rows = rowsNormalized.length;

        // Resolver referencias previas (metric_id, received_inventory_id, etc.)
        const { resolved, errors: resolveWarnings } = await this.resolver.resolveAll(rowsNormalized);

        // Normaliza y calcula hash canónico de negocio (excluye received_inventory_id y paid)
        const rows = resolved.map((r, index) => {
            const storeId = Number(r['Store ID']);

            if (!Number.isFinite(storeId) || storeId <= 0) {
                // Importante: fallar temprano; es exactamente el problema que estás resolviendo.
                throw new BadRequestException(`Fila ${index + 1}: Store ID inválido para Location="${r['Location']}"`);
            }
            const metricId = r['Metric ID'] ?? r['Metric ID'] ?? null;
            const transactionId = r['Transaction ID'] ?? null;

            const base = {
                store_id: storeId,
                metric_id: metricId,
                transaction_id: transactionId,
                vendor_license: r['Vendor License'] ?? null,
                received_on: r['Received On'] ?? null,
                total_cost: r['Total Cost'] ?? null,
                vendor: r['Vendor'] ?? null,
                title: r['Title'] ?? null,
                status: r['Status'] ?? null,
                delivered_by: r['Delivered By'] ?? null,
                received_by: r['Received By'] ?? null,
                paid: !!r['paid'],
                products: Number.isFinite(r['Products']) ? r['Products'] : (r['Products'] ?? 0),
                due_date: r['Due Date'] ?? null,
                received_inventory_id: (r['received_inventory_id'] ?? null),
            };

            const row_hash = this.computeRowHash(base);
            return { ...base, row_hash };
        });

        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        let unresolved = 0;
        const insertErrors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const hasTracking = !!row.metric_id;
            const hasTransaction = !!row.transaction_id;

            try {
                if (hasTracking && hasTransaction) {
                    // ===== Grupo A: (store_id, metric_id, transaction_id) =====
                    // 1) Intento de PROMOCIÓN (mismo hash, solo elevar received_inventory_id)
                    const promoted = await this.tryPromotionUpdateA(row);
                    if (promoted) { updated++; continue; }

                    // 2) Intento de UPDATE por HASH distinto (marca is_updated=true, is_verified=false)
                    const changed = await this.tryHashUpdateA(row);
                    if (changed) { updated++; continue; }

                    // 3) ¿Existe? -> unchanged; si no existe -> insert
                    const exists = await this.existsA(row);
                    if (exists) { unchanged++; continue; }

                    const ins = await this.supabase
                        .from('stores_received_inventory_receipts')
                        .insert(this.buildInsertObject(row));
                    if (ins.error) throw ins.error;
                    inserted++;
                    continue;
                }

                if (hasTracking && !hasTransaction) {
                    // ===== Grupo B: (store_id, metric_id, received_on) con transaction_id NULL =====
                    if (!row.received_on) {
                        console.log({ row }, "B");

                        unresolved++; continue;
                    }

                    const promoted = await this.tryPromotionUpdateB(row);
                    if (promoted) { updated++; continue; }

                    const changed = await this.tryHashUpdateB(row);
                    if (changed) { updated++; continue; }

                    const exists = await this.existsB(row);
                    if (exists) { unchanged++; continue; }

                    const ins = await this.supabase
                        .from('stores_received_inventory_receipts')
                        .insert(this.buildInsertObject(row));
                    if (ins.error) throw ins.error;
                    inserted++;
                    continue;
                }

                if (!hasTracking && hasTransaction) {
                    // ===== Grupo C: (store_id, vendor_license, transaction_id, received_on) con metric_id NULL =====
                    if (!row.vendor_license || !row.received_on) {
                        console.log({ row }, "C");
                        unresolved++; continue;
                    }

                    const promoted = await this.tryPromotionUpdateC(row);
                    if (promoted) { updated++; continue; }

                    const changed = await this.tryHashUpdateC(row);
                    if (changed) { updated++; continue; }

                    const exists = await this.existsC(row);
                    if (exists) { unchanged++; continue; }

                    const ins = await this.supabase
                        .from('stores_received_inventory_receipts')
                        .insert(this.buildInsertObject(row));
                    if (ins.error) throw ins.error;
                    inserted++;
                    continue;
                }

                // if (!hasTracking || !hasTransaction) {
                // Caso D: sin metric_id y sin transaction_id → insertamos de todos modos
                // (Nuevo registro ⇒ is_verified=false, is_updated=false por buildInsertObject)
                const ins = await this.supabase
                    .from('stores_received_inventory_receipts')
                    .insert(this.buildInsertObject(row));

                if (ins.error) throw ins.error;
                inserted++;
                continue;
                // }
                // // Sin identidad suficiente
                // unresolved++;

            } catch (e: any) {
                insertErrors.push({ index: i, error: e?.message ?? String(e) });
            }
        }

        return {
            total_rows,
            inserted,
            updated,
            unchanged,
            unresolved,
            failed: insertErrors.length,
            errors: insertErrors.slice(0, 50),
            resolve_warnings: resolveWarnings.slice(0, 50),
            sample: rows.slice(0, 10),
        };
    }

    // ---------- INTENTOS DE UPDATE (promoción vs hash) ----------

    // A) promoción: mismo hash; si DB tiene received_inventory_id NULL/-1 y viene >0, promuévelo
    private async tryPromotionUpdateA(row: any): Promise<boolean> {
        if (!(Number.isFinite(row.received_inventory_id) && row.received_inventory_id > 0)) return false;

        // 1) NULL
        const updNull = await this.supabase.from('stores_received_inventory_receipts')
            .update({ received_inventory_id: row.received_inventory_id })
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('transaction_id', row.transaction_id)
            .is('received_inventory_id', null)
            .select('store_id');

        if (updNull.error) throw updNull.error;
        if ((updNull.data?.length ?? 0) > 0) return true;

        // 2) -1
        const updMinus1 = await this.supabase
            .from('stores_received_inventory_receipts')
            .update({ received_inventory_id: row.received_inventory_id })
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('transaction_id', row.transaction_id)
            .eq('received_inventory_id', -1)
            .select('store_id');

        if (updMinus1.error) throw updMinus1.error;
        return (updMinus1.data?.length ?? 0) > 0;
    }


    // A) promoción — tu versión ya está correcta (NULL → -1). Déjala igual.

    // A) update por cambio de contenido (hash distinto) SIN usar row_hash en WHERE
    private async tryHashUpdateA(row: any): Promise<boolean> {
        // 1) buscar por llave A
        const sel = await this.supabase
            .from('stores_received_inventory_receipts')
            .select('id, row_hash')
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('transaction_id', row.transaction_id)
            .maybeSingle();

        if (sel.error) throw sel.error;
        if (!sel.data) return false; // no existe → lo manejará exists/insert

        const same = (sel.data.row_hash ?? null) === (row.row_hash ?? null);
        if (same) return false; // unchanged

        // 2) cambió → actualiza campos + flags + nuevo hash
        const upd = await this.supabase
            .from('stores_received_inventory_receipts')
            .update(this.buildHashUpdateObject(row))
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('transaction_id', row.transaction_id)
            .select('id');

        if (upd.error) throw upd.error;
        return (upd.data?.length ?? 0) > 0;
    }


    private async existsA(row: any): Promise<boolean> {
        const ex = await this.supabase
            .from('stores_received_inventory_receipts')
            .select('store_id', { head: true, count: 'exact' })
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('transaction_id', row.transaction_id)
            .limit(1);
        if (ex.error) throw ex.error;
        return (ex.count ?? 0) > 0;
    }

    // B) promoción: (store_id, metric_id, received_on) con transaction_id IS NULL
    private async tryPromotionUpdateB(row: any): Promise<boolean> {
        if (!(Number.isFinite(row.received_inventory_id) && row.received_inventory_id > 0)) return false;
        if (!row.received_on) return false;

        // 1) NULL
        const u1 = await this.supabase
            .from('stores_received_inventory_receipts')
            .update({ received_inventory_id: row.received_inventory_id })
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('received_on', row.received_on)
            .is('transaction_id', null)
            .is('received_inventory_id', null)
            .select('id');

        if (u1.error) throw u1.error;
        if ((u1.data?.length ?? 0) > 0) return true;

        // 2) -1
        const u2 = await this.supabase
            .from('stores_received_inventory_receipts')
            .update({ received_inventory_id: row.received_inventory_id })
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('received_on', row.received_on)
            .is('transaction_id', null)
            .eq('received_inventory_id', -1)
            .select('id');

        if (u2.error) throw u2.error;
        return (u2.data?.length ?? 0) > 0;
    }

    private async tryHashUpdateB(row: any): Promise<boolean> {
        // 1) buscar por llave B
        const sel = await this.supabase
            .from('stores_received_inventory_receipts')
            .select('id, row_hash')
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('received_on', row.received_on)
            .is('transaction_id', null)
            .maybeSingle();

        if (sel.error) throw sel.error;
        if (!sel.data) return false;

        const same = (sel.data.row_hash ?? null) === (row.row_hash ?? null);
        if (same) return false;

        // 2) cambió → update
        const upd = await this.supabase
            .from('stores_received_inventory_receipts')
            .update(this.buildHashUpdateObject(row))
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('received_on', row.received_on)
            .is('transaction_id', null)
            .select('id');

        if (upd.error) throw upd.error;
        return (upd.data?.length ?? 0) > 0;
    }


    private async existsB(row: any): Promise<boolean> {
        const ex = await this.supabase
            .from('stores_received_inventory_receipts')
            .select('store_id', { head: true, count: 'exact' })
            .eq('store_id', row.store_id)
            .eq('metric_id', row.metric_id)
            .eq('received_on', row.received_on)
            .is('transaction_id', null)
            .limit(1);
        if (ex.error) throw ex.error;
        return (ex.count ?? 0) > 0;
    }

    // C) promoción: (store_id, vendor_license, transaction_id, received_on) con metric_id IS NULL
    private async tryPromotionUpdateC(row: any): Promise<boolean> {
        if (!(Number.isFinite(row.received_inventory_id) && row.received_inventory_id > 0)) return false;
        if (!row.vendor_license || !row.received_on) return false;

        // 1) NULL
        const u1 = await this.supabase
            .from('stores_received_inventory_receipts')
            .update({ received_inventory_id: row.received_inventory_id })
            .eq('store_id', row.store_id)
            .eq('vendor_license', row.vendor_license)
            .eq('transaction_id', row.transaction_id)
            .eq('received_on', row.received_on)
            .is('metric_id', null)
            .is('received_inventory_id', null)
            .select('id');

        if (u1.error) throw u1.error;
        if ((u1.data?.length ?? 0) > 0) return true;

        // 2) -1
        const u2 = await this.supabase
            .from('stores_received_inventory_receipts')
            .update({ received_inventory_id: row.received_inventory_id })
            .eq('store_id', row.store_id)
            .eq('vendor_license', row.vendor_license)
            .eq('transaction_id', row.transaction_id)
            .eq('received_on', row.received_on)
            .is('metric_id', null)
            .eq('received_inventory_id', -1)
            .select('id');

        if (u2.error) throw u2.error;
        return (u2.data?.length ?? 0) > 0;
    }

    private async tryHashUpdateC(row: any): Promise<boolean> {
        // 1) buscar por llave C
        const sel = await this.supabase
            .from('stores_received_inventory_receipts')
            .select('id, row_hash')
            .eq('store_id', row.store_id)
            .eq('vendor_license', row.vendor_license)
            .eq('transaction_id', row.transaction_id)
            .eq('received_on', row.received_on)
            .is('metric_id', null)
            .maybeSingle();

        if (sel.error) throw sel.error;
        if (!sel.data) return false;

        const same = (sel.data.row_hash ?? null) === (row.row_hash ?? null);
        if (same) return false;

        // 2) cambió → update
        const upd = await this.supabase
            .from('stores_received_inventory_receipts')
            .update(this.buildHashUpdateObject(row))
            .eq('store_id', row.store_id)
            .eq('vendor_license', row.vendor_license)
            .eq('transaction_id', row.transaction_id)
            .eq('received_on', row.received_on)
            .is('metric_id', null)
            .select('id');

        if (upd.error) throw upd.error;
        return (upd.data?.length ?? 0) > 0;
    }


    private async existsC(row: any): Promise<boolean> {
        const ex = await this.supabase
            .from('stores_received_inventory_receipts')
            .select('store_id', { head: true, count: 'exact' })
            .eq('store_id', row.store_id)
            .eq('vendor_license', row.vendor_license)
            .eq('transaction_id', row.transaction_id)
            .eq('received_on', row.received_on)
            .is('metric_id', null)
            .limit(1);
        if (ex.error) throw ex.error;
        return (ex.count ?? 0) > 0;
    }

    // ---------- Helpers de hash y payloads ----------

    /** Hash canónico de negocio (excluye received_inventory_id y paid). */
    private computeRowHash(src: any): string {
        const canon = {
            received_on: this.normDate(src.received_on),
            due_date: this.normDate(src.due_date),
            total_cost: this.normMoney(src.total_cost),
            products: this.normInt(src.products),
            vendor: this.normStr(src.vendor),
            vendor_license: this.normStr(src.vendor_license),
            title: this.normStr(src.title),
            status: this.normStr(src.status),
            delivered_by: this.normStr(src.delivered_by),
            received_by: this.normStr(src.received_by),
            metric_id: this.normStr(src.metric_id),
            transaction_id: this.normStr(src.transaction_id),
        };

        const json = JSON.stringify(canon);
        return createHash('sha256').update(json).digest('hex');
    }

    /** UPDATE por cambio de hash → is_updated=true, is_verified=false, row_hash nuevo + campos */
    private buildHashUpdateObject(src: any): Record<string, any> {
        const out: Record<string, any> = {};

        // Fechas / números
        if (src.received_on != null) out.received_on = src.received_on;
        if (src.total_cost != null) out.total_cost = src.total_cost;
        if (src.products != null) out.products = src.products;
        if (src.due_date != null) out.due_date = src.due_date;

        // Cadenas (no vacías)
        if (this.nonEmpty(src.vendor)) out.vendor = src.vendor;
        if (this.nonEmpty(src.vendor_license)) out.vendor_license = src.vendor_license;
        if (this.nonEmpty(src.title)) out.title = src.title;
        if (this.nonEmpty(src.status)) out.status = src.status;
        if (this.nonEmpty(src.delivered_by)) out.delivered_by = src.delivered_by;
        if (this.nonEmpty(src.received_by)) out.received_by = src.received_by;
        if (this.nonEmpty(src.metric_id)) out.metric_id = src.metric_id;

        // banderas según condición que pediste
        out.is_verified = false;
        out.is_updated = true;

        // row_hash nuevo
        if (this.nonEmpty(src.row_hash)) out.row_hash = src.row_hash;

        // received_inventory_id: solo si > 0 (si además cambió de hash, permitimos promover en el mismo update)
        if (Number.isFinite(src.received_inventory_id) && src.received_inventory_id > 0) {
            out.received_inventory_id = src.received_inventory_id;
        }

        // paid: no lo tocamos aquí (tu condición no lo pide)
        return out;
    }

    /** INSERT nuevo → is_verified=false, is_updated=false (según tu condición) */
    private buildInsertObject(src: any): Record<string, any> {
        return {
            store_id: src.store_id,
            metric_id: src.metric_id ?? null,
            transaction_id: src.transaction_id ?? null,
            vendor_license: src.vendor_license ?? null,
            received_on: src.received_on ?? null,
            total_cost: src.total_cost ?? null,
            vendor: src.vendor ?? null,
            title: src.title ?? null,
            status: src.status ?? null,
            delivered_by: src.delivered_by ?? null,
            received_by: src.received_by ?? null,
            paid: src.paid === true ? true : false,
            products: Number.isFinite(src.products) ? src.products : (src.products ?? 0),
            due_date: src.due_date ?? null,
            received_inventory_id: src.received_inventory_id ?? null,
            row_hash: src.row_hash ?? null,

            // banderas nuevas – NUEVO registro:
            is_verified: false,
            is_updated: false,
        };
    }

    private nonEmpty(x: any): boolean {
        return typeof x === 'string' ? x.trim().length > 0 : x != null;
    }

    private normStr(x: any): string | null {
        if (x == null) return null;
        const s = String(x).trim();
        return s.length ? s : null;
    }
    private normInt(x: any): number | null {
        if (x == null) return null;
        const n = Number(x);
        if (!Number.isFinite(n)) return null;
        return Math.trunc(n);
    }
    private normMoney(x: any): string | null {
        if (x == null) return null;
        const n = Number(String(x).replace(/[$, ]/g, ''));
        if (!Number.isFinite(n)) return null;
        return n.toFixed(2);
    }
    private normDate(x: any): string | null {
        if (x == null) return null;
        return String(x).trim();
    }


    // Dentro de ReceiptsImportService
    async updateOneManual(input: any): Promise<{
        ok: boolean;
        action: 'updated' | 'unchanged';
        id: number;
        prev_hash: string | null;
        new_hash: string | null;
    }> {
        const id = Number(input.id);
        if (!Number.isFinite(id) || id <= 0) {
            throw new BadRequestException(`id inválido: ${input.id}`);
        }

        // 1) Leer registro actual con campos necesarios para hash y banderas
        const sel = await this.supabase
            .from('stores_received_inventory_receipts')
            .select(`
      id, store_id, received_inventory_id, row_hash,
      received_on, due_date, total_cost, products,
      vendor, vendor_license, title, status, delivered_by, received_by,
      metric_id, transaction_id, paid, is_verified, is_updated
    `)
            .eq('id', id)
            .maybeSingle();

        if (sel.error) throw sel.error;
        const current = sel.data;
        if (!current) throw new BadRequestException(`Registro id=${id} no existe`);

        // 2) Construir "next" con posibles cambios del body (los de negocio que afectan hash)
        const next = {
            store_id: input.store_id ?? current.store_id,

            received_on: input.received_on ?? current.received_on,
            due_date: input.due_date ?? current.due_date,
            total_cost: input.total_cost ?? current.total_cost,
            products: input.products ?? current.products,

            vendor: input.vendor ?? current.vendor,
            vendor_license: input.vendor_license ?? current.vendor_license,
            title: input.title ?? current.title,
            status: input.status ?? current.status,
            delivered_by: input.delivered_by ?? current.delivered_by,
            received_by: input.received_by ?? current.received_by,

            metric_id: input.metric_id !== undefined ? input.metric_id : current.metric_id,
            transaction_id: input.transaction_id !== undefined ? input.transaction_id : current.transaction_id,

            // fuera del hash:
            received_inventory_id: input.received_inventory_id ?? current.received_inventory_id,
            paid: input.paid ?? current.paid,
        };

        // 3) Calcular nuevo hash (excluye paid, is_verified, is_updated, received_inventory_id)
        const canonForHash = {
            received_on: this.normDate(next.received_on),
            due_date: this.normDate(next.due_date),
            total_cost: this.normMoney(next.total_cost),
            products: this.normInt(next.products),
            vendor: this.normStr(next.vendor),
            vendor_license: this.normStr(next.vendor_license),
            title: this.normStr(next.title),
            status: this.normStr(next.status),
            delivered_by: this.normStr(next.delivered_by),
            received_by: this.normStr(next.received_by),
            metric_id: this.normStr(next.metric_id),
            transaction_id: this.normStr(next.transaction_id),
        };
        const new_hash = this.computeRowHash(canonForHash);
        const prev_hash = current.row_hash ?? null;
        const sameHash = (prev_hash ?? null) === (new_hash ?? null);

        // 4) Construir payload de UPDATE según reglas:
        const updatePayload: Record<string, any> = {};

        // Siempre marcar is_verified = true si no lo está
        if (current.is_verified !== true) updatePayload.is_verified = true;

        // Persistir paid si viene y cambió
        if (Object.prototype.hasOwnProperty.call(input, 'paid') && input.paid !== current.paid) {
            updatePayload.paid = input.paid === true ? true : false;
        }

        if (!sameHash) {
            // Si el hash CAMBIA: actualizar campos de negocio + is_updated=true + row_hash nuevo
            if (next.received_on != null) updatePayload.received_on = next.received_on;
            if (next.total_cost != null) updatePayload.total_cost = next.total_cost;
            if (next.products != null) updatePayload.products = next.products;
            if (next.due_date != null) updatePayload.due_date = next.due_date;

            if (this.nonEmpty(next.vendor)) updatePayload.vendor = next.vendor;
            if (this.nonEmpty(next.vendor_license)) updatePayload.vendor_license = next.vendor_license;
            if (this.nonEmpty(next.title)) updatePayload.title = next.title;
            if (this.nonEmpty(next.status)) updatePayload.status = next.status;
            if (this.nonEmpty(next.delivered_by)) updatePayload.delivered_by = next.delivered_by;
            if (this.nonEmpty(next.received_by)) updatePayload.received_by = next.received_by;
            if (this.nonEmpty(next.metric_id)) updatePayload.metric_id = next.metric_id;
            if (this.nonEmpty(next.transaction_id)) updatePayload.transaction_id = next.transaction_id;

            // paid ya se trató arriba; received_inventory_id NO forma parte del hash
            if (Object.prototype.hasOwnProperty.call(input, 'received_inventory_id') &&
                input.received_inventory_id !== current.received_inventory_id) {
                updatePayload.received_inventory_id = next.received_inventory_id;
            }

            updatePayload.is_updated = true;
            updatePayload.row_hash = new_hash;
        }

        // 5) ¿Hay algo que actualizar?
        if (Object.keys(updatePayload).length === 0) {
            // No cambió hash, ya estaba verificado y no llegó paid distinto → unchanged
            return { ok: true, action: 'unchanged', id, prev_hash, new_hash };
        }

        const upd = await this.supabase
            .from('stores_received_inventory_receipts')
            .update(updatePayload)
            .eq('id', id)
            .select('id')
            .maybeSingle();

        if (upd.error) throw upd.error;

        return {
            ok: true,
            action: 'updated',
            id,
            prev_hash,
            new_hash,
        };
    }


}
