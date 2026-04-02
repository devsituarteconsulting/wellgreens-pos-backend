import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { ProductDto } from '../dtos/products.dto';

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

// ------- helpers de mapping -------
const pick = <T = any>(obj: any, keys: string[], fallback: T = null as any): T =>
    keys.find(k => obj?.[k] !== undefined) ? obj[keys.find(k => obj[k] !== undefined)!] : fallback;

const toNull = <T>(v: T | undefined | null) => (v === undefined ? null : v);

const getPid = (p: any): number => {
    const v = pick<number>(p, ['product_id', 'productId']);
    if (v == null) throw new BadRequestException('product_id/productId requerido en el payload');
    return Number(v);
};

const getList = <T = any>(p: any, keys: string[]): T[] | null => {
    for (const k of keys) {
        const v = p?.[k];
        if (Array.isArray(v) && v.length) return v as T[];
    }
    return null;
};

/** Mapea ProductDto (camelCase) a snake_case para public.products */
function mapProductToRow(p: any, storeId: number) {
    return {
        store_id: storeId,
        product_id: pick<number>(p, ['product_id', 'productId']),
        sku: toNull(p.sku),
        internal_name: toNull(p.internal_name ?? p.internalName),
        product_name: toNull(p.product_name ?? p.productName),
        description: toNull(p.description),
        master_category: toNull(p.master_category ?? p.masterCategory),
        category_id: toNull(p.category_id ?? p.categoryId),
        category: toNull(p.category),
        image_url: toNull(p.image_url ?? p.imageUrl),
        image_urls: toNull(p.image_urls ?? p.imageUrls),
        strain_id: toNull(p.strain_id ?? p.strainId),
        strain: toNull(p.strain),
        strain_type: toNull(p.strain_type ?? p.strainType),
        size: toNull(p.size),
        net_weight: toNull(p.net_weight ?? p.netWeight),
        net_weight_unit_id: toNull(p.net_weight_unit_id ?? p.netWeightUnitId),
        net_weight_unit: toNull(p.net_weight_unit ?? p.netWeightUnit),
        brand_id: toNull(p.brand_id ?? p.brandId),
        brand_name: toNull(p.brand_name ?? p.brandName),
        vendor_id: toNull(p.vendor_id ?? p.vendorId),
        vendor_name: toNull(p.vendor_name ?? p.vendorName),
        is_cannabis: !!pick(p, ['is_cannabis', 'isCannabis'], false),
        is_active: !!pick(p, ['is_active', 'isActive'], false),
        is_coupon: !!pick(p, ['is_coupon', 'isCoupon'], false),
        thc_content: toNull(p.thc_content ?? p.thcContent),
        thc_content_unit: toNull(p.thc_content_unit ?? p.thcContentUnit),
        cbd_content: toNull(p.cbd_content ?? p.cbdContent),
        cbd_content_unit: toNull(p.cbd_content_unit ?? p.cbdContentUnit),
        product_grams: toNull(p.product_grams ?? p.productGrams),
        flower_equivalent: toNull(p.flower_equivalent ?? p.flowerEquivalent),
        rec_flower_equivalent: toNull(p.rec_flower_equivalent ?? p.recFlowerEquivalent),
        price: toNull(p.price),
        med_price: toNull(p.med_price ?? p.medPrice),
        rec_price: toNull(p.rec_price ?? p.recPrice),
        unit_cost: toNull(p.unit_cost ?? p.unitCost),
        unit_type: toNull(p.unit_type ?? p.unitType),
        online_title: toNull(p.online_title ?? p.onlineTitle),
        online_description: toNull(p.online_description ?? p.onlineDescription),
        online_product: toNull(p.online_product ?? p.onlineProduct),
        pos_products: toNull(p.pos_products ?? p.posProducts),
        pricing_tier: toNull(p.pricing_tier ?? p.pricingTier),
        online_available: toNull(p.online_available ?? p.onlineAvailable),
        low_inventory_threshold: toNull(p.low_inventory_threshold ?? p.lowInventoryThreshold),
        pricing_tier_name: toNull(p.pricing_tier_name ?? p.pricingTierName),
        pricing_tier_description: toNull(p.pricing_tier_description ?? p.pricingTierDescription),
        flavor: toNull(p.flavor),
        alternate_name: toNull(p.alternate_name ?? p.alternateName),
        lineage_name: toNull(p.lineage_name ?? p.lineageName),
        distillation_name: toNull(p.distillation_name ?? p.distillationName),
        max_purchaseable_per_transaction: toNull(p.max_purchaseable_per_transaction ?? p.maxPurchaseablePerTransaction),
        dosage: toNull(p.dosage),
        instructions: toNull(p.instructions),
        allergens: toNull(p.allergens),
        default_unit: toNull(p.default_unit ?? p.defaultUnit),
        producer_id: toNull(p.producer_id ?? p.producerId),
        producer_name: toNull(p.producer_name ?? p.producerName),
        created_date: toNull(p.created_date ?? p.createdDate),
        is_medical_only: !!pick(p, ['is_medical_only', 'isMedicalOnly'], false),
        last_modified_date_utc: toNull(p.last_modified_date_utc ?? p.lastModifiedDateUTC),
        gross_weight: toNull(p.gross_weight ?? p.grossWeight),
        is_taxable: toNull(p.is_taxable ?? p.isTaxable),
        tax_categories: toNull(p.tax_categories ?? p.taxCategories),
        upc: toNull(p.upc),
        regulatory_category: toNull(p.regulatory_category ?? p.regulatoryCategory),
        ndc: toNull(p.ndc),
        days_supply: toNull(p.days_supply ?? p.daysSupply),
        illinois_tax_category: toNull(p.illinois_tax_category ?? p.illinoisTaxCategory),
        external_category: toNull(p.external_category ?? p.externalCategory),
        external_id: toNull(p.external_id ?? p.externalId),
        sync_externally: !!pick(p, ['sync_externally', 'syncExternally'], false),
        regulatory_name: toNull(p.regulatory_name ?? p.regulatoryName),
        administration_method: toNull(p.administration_method ?? p.administrationMethod),
        unit_cbd_content_dose: toNull(p.unit_cbd_content_dose ?? p.unitCBDContentDose),
        unit_thc_content_dose: toNull(p.unit_thc_content_dose ?? p.unitTHCContentDose),
        oil_volume: toNull(p.oil_volume ?? p.oilVolume),
        ingredient_list: toNull(p.ingredient_list ?? p.ingredientList),
        expiration_days: toNull(p.expiration_days ?? p.expirationDays),
        abbreviation: toNull(p.abbreviation),
        is_test_product: !!pick(p, ['is_test_product', 'isTestProduct'], false),
        is_finished: !!pick(p, ['is_finished', 'isFinished'], false),
        allow_automatic_discounts: !!pick(p, ['allow_automatic_discounts', 'allowAutomaticDiscounts'], true),
        serving_size: toNull(p.serving_size ?? p.servingSize),
        serving_size_per_unit: toNull(p.serving_size_per_unit ?? p.servingSizePerUnit),
        is_nutrient: !!pick(p, ['is_nutrient', 'isNutrient'], false),
        approval_date_utc: toNull(p.approval_date_utc ?? p.approvalDateUTC),
        ecom_category: toNull(p.ecom_category ?? p.ecomCategory),
        ecom_subcategory: toNull(p.ecom_subcategory ?? p.ecomSubcategory),
        custom_metadata: toNull(p.custom_metadata ?? p.customMetadata),
    };
}

@Injectable()
export class ProductsImportService {
    private readonly logger = new Logger(ProductsImportService.name);
    constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) { }

    // Tamaños de lote (ajustados)
    private readonly UPSERT_CHUNK = 2000;
    private readonly INSERT_CHUNK = 2000;

    // Límites para adaptación
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
                        this.logger.warn(`[ADAPT] ${label}: timeout, bajo chunk ${prev} -> ${chunkSize} (retry ${attempt + 1})`);
                        attempt++;
                        continue;
                    }
                    throw e;
                }
            }
            offset = end;
            if (this.INTER_BATCH_SLEEP_MS) await this.sleep(this.INTER_BATCH_SLEEP_MS);
        }
    }

    /**
     * Importa/upsertea productos para una tienda.
     * - products: UPSERT por (store_id, product_id)
     * - product_pricing_tiers: UPSERT por (store_id, product_id) ⇒ si llegan varios, toma el último
     * - product_tags: UPSERT por (store_id, product_id, tag_id)
     * - product_effects: UPSERT por (store_id, product_id, effect_id)
     * - product_allergens: UPSERT por (store_id, product_id)
     * - product_broadcast_responses: UPSERT por (store_id, product_id) ⇒ si llegan varios, toma el último
     */
    async importMany(payloads: ProductDto[], storeIdStr: string) {
        if (!Array.isArray(payloads)) throw new BadRequestException('ProductDto[] requerido');
        const storeId = Number.parseInt(storeIdStr);
        if (!Number.isFinite(storeId) || storeId <= 0) throw new BadRequestException(`storeId inválido: ${storeIdStr}`);

        const total = payloads.length;
        if (!total) {
            this.logger.log(`[store:${storeId}] No hay productos que procesar.`);
            return { ok: true, processed: 0 };
        }

        const t0 = Date.now();
        this.logger.log(`[store:${storeId}] Importando lote: ${total} productos`);

        // ---------- 1) Armado (simple y directo) ----------
        const productRows = payloads.map((p) => mapProductToRow(p, storeId)); 

        // ---------- 2) UPSERT raíz (adaptativo) ----------
        await this.upsertWithProgress('stores_products', productRows, storeId, 'store_id,product_id');

        // ---------- 3) Subtablas ----------

        // 3.1 pricing_tiers (o pricingTierData del JSON original). Tomamos el último por UNIQUE(store_id, product_id)
        const pricingRows: any[] = [];
        for (const p of payloads) {
            const pid = getPid(p);
            const list = getList<any>(p, ['pricing_tiers', 'pricingTierData']);
            if (list && list.length) {
                if (list.length > 1) {
                    this.logger.warn(`[store:${storeId}] product_id=${pid} trae ${list.length} pricing_tiers; se tomará el último por UNIQUE (store_id,product_id).`);
                }
                const last = list[list.length - 1];
                pricingRows.push({
                    store_id: storeId,
                    product_id: pid,
                    start_weight: toNull(last?.start_weight ?? last?.startWeight),
                    end_weight: toNull(last?.end_weight ?? last?.endWeight),
                    price: last?.price,
                    medical_price: toNull(last?.medical_price ?? last?.medicalPrice),
                });
            }
        }
        if (pricingRows.length) {
            await this.upsertWithProgress('product_pricing_tiers', pricingRows, storeId, 'store_id,product_id');
        }

        // 3.2 tags
        const tagRows: any[] = [];
        for (const p of payloads) {
            const tags = getList<any>(p, ['tags']);
            if (!tags) continue;
            const pid = getPid(p);
            for (const t of tags) {
                tagRows.push({
                    store_id: storeId,
                    product_id: pid,
                    tag_id: pick<number>(t, ['tag_id', 'tagId']),
                    tag_name: toNull(pick<string>(t, ['tag_name', 'tagName'])),
                });
            }
        }
        if (tagRows.length) {
            await this.upsertWithProgress('product_tags', tagRows, storeId, 'store_id,product_id,tag_id');
        }

        // 3.3 effects
        const effectRows: any[] = [];
        for (const p of payloads) {
            const effects = getList<any>(p, ['effects']);
            if (!effects) continue;
            const pid = getPid(p);
            for (const e of effects) {
                effectRows.push({
                    store_id: storeId,
                    product_id: pid,
                    effect_id: pick<number>(e, ['effect_id', 'effectId']),
                    effect_name: toNull(pick<string>(e, ['effect_name', 'effectName'])),
                });
            }
        }
        if (effectRows.length) {
            await this.upsertWithProgress('product_effects', effectRows, storeId, 'store_id,product_id,effect_id');
        }

        // 3.4 allergens (standardAllergens del JSON original)
        const allergenRows: any[] = [];
        for (const p of payloads) {
            const a = p['allergens_std'] ?? p['standardAllergens'] ?? null;
            if (!a) continue;
            allergenRows.push({
                store_id: storeId,
                product_id: getPid(p),
                milk: !!a.milk,
                eggs: !!a.eggs,
                fish: !!a.fish,
                peanuts: !!a.peanuts,
                tree_nuts: !!(a.tree_nuts ?? a.treeNuts),
                sesame: !!a.sesame,
                shellfish: !!a.shellfish,
                soybeans: !!a.soybeans,
                wheat: !!a.wheat,
            });
        }
        if (allergenRows.length) {
            await this.upsertWithProgress('product_allergens', allergenRows, storeId, 'store_id,product_id');
        }

        // 3.5 broadcast_responses (solo DTO normalizado a tabla)
        const broadcastRows: any[] = [];
        for (const p of payloads) {
            const list = Array.isArray(p.broadcast_responses) ? p.broadcast_responses : null;
            if (!list || list.length === 0) continue;

            const pid = getPid(p);
            if (list.length > 1) {
                this.logger.warn(
                    `[store:${storeId}] product_id=${pid} trae ${list.length} broadcast_responses; ` +
                    `se tomará el último por UNIQUE (store_id,product_id).`
                );
            }

            const last = list[list.length - 1];
            broadcastRows.push({
                store_id: storeId,
                product_id: pid,
                location_name: toNull(last.location_name),
                loc_id: toNull(last.loc_id),
                license_number: toNull(last.license_number),
                outcome: toNull(last.outcome),
                outcome_id: toNull(last.outcome_id),
                broadcasted_to: toNull(last.broadcasted_to),
                error_detail: toNull(last.error_detail),
            });
        }

        if (broadcastRows.length) {
            await this.upsertWithProgress('product_broadcast_responses', broadcastRows, storeId, 'store_id,product_id');
        }


        // ---------- Fin ----------
        const elapsed = Date.now() - t0;
        this.logger.log(`[store:${storeId}] Import de productos completo (${total}) • ${fmtMs(elapsed)}`);
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
}
