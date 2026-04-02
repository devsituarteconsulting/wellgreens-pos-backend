// src/modules/supabase/services/pistil-import.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import {
  PriceCompareStore,
  PriceCompareProduct,
  PriceCompareEntry,
  PriceCompareResult,
  PriceCompareSkippedEntry,
  PriceCompareDuplicateEntry,
} from '../../wg-pos/dtos/price-compare.dto';

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

@Injectable()
export class PistilImportService {
  private readonly logger = new Logger(PistilImportService.name);
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  private readonly UPSERT_CHUNK = 1000;
  private readonly SELECT_PAGE_SIZE = 5000;
  private readonly MIN_CHUNK = 100;
  private readonly MAX_RETRIES = 4;
  private readonly INTER_BATCH_SLEEP_MS = 25;

  /**
   * Upsert completo: stores → products → prices (con FK resolution).
   */
  async importPriceCompare(result: PriceCompareResult) {
    const t0 = Date.now();
    this.logger.log(`Starting pistil import: ${result.stores.length} stores, ${result.products.length} products, ${result.prices.length} prices`);

    // 1) Upsert stores → get id map
    const storeIdMap = await this.upsertStores(result.stores);
    this.logger.log(`Stores upserted: ${storeIdMap.size} entries`);

    // 2) Upsert products → get id map
    const productIdMap = await this.upsertProducts(result.products);
    this.logger.log(`Products upserted: ${productIdMap.size} entries`);

    // 3) Upsert prices with resolved FKs
    const priceImport = await this.upsertPrices(result.prices, storeIdMap, productIdMap);
    const pricesUpserted = priceImport.upserted;
    this.logger.log(`Prices upserted: ${pricesUpserted}`);

    const elapsed = Date.now() - t0;
    this.logger.log(`Pistil import complete — ${fmtMs(elapsed)}`);

    return {
      ok: true,
      stores: storeIdMap.size,
      products: productIdMap.size,
      prices: pricesUpserted,
      diagnostics: {
        skipped_prices: priceImport.skipped,
        duplicate_prices: priceImport.duplicates,
      },
      elapsedMs: elapsed,
    };
  }

  // ──────────────────────────────────────────
  // Stores
  // ──────────────────────────────────────────

  private async upsertStores(stores: PriceCompareStore[]): Promise<Map<string, number>> {
    const rows = stores.map((s) => ({
      name: s.name,
      license: s.license || null,
      county: s.county || null,
      address: s.address || null,
    }));

    await this.upsertChunked('pistil_stores', rows, 'name_norm');

    return this.fetchIdMap('pistil_stores', 'name_norm');
  }

  // ──────────────────────────────────────────
  // Products
  // ──────────────────────────────────────────

  private async upsertProducts(products: PriceCompareProduct[]): Promise<Map<string, number>> {
    const rows = products.map((p) => ({
      product_name: p.product_name,
      primary_category: p.primary_category || null,
      alt_categories: p.alt_categories.length ? p.alt_categories : [],
    }));

    await this.upsertChunked('pistil_products', rows, 'product_name_norm');

    return this.fetchIdMap('pistil_products', 'product_name_norm');
  }

  // ──────────────────────────────────────────
  // Prices
  // ──────────────────────────────────────────

  private async upsertPrices(
    prices: PriceCompareEntry[],
    storeIdMap: Map<string, number>,
    productIdMap: Map<string, number>,
  ): Promise<{
    upserted: number;
    skipped: PriceCompareSkippedEntry[];
    duplicates: PriceCompareDuplicateEntry[];
  }> {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

    const rowsByKey = new Map<string, any>();
    const skipped: PriceCompareSkippedEntry[] = [];
    const duplicates: PriceCompareDuplicateEntry[] = [];
    let conflictingDuplicates = 0;

    for (const p of prices) {
      const productId = productIdMap.get(norm(p.product_name));
      const storeId = storeIdMap.get(norm(p.store_name));

      if (!productId || !storeId) {
        skipped.push({
          ...p,
          reason: !productId && !storeId
            ? 'missing_product_and_store_fk'
            : !productId
              ? 'missing_product_fk'
              : 'missing_store_fk',
          resolved_product_id: productId ?? null,
          resolved_store_id: storeId ?? null,
        });
        continue;
      }

      const row = {
        product_id: productId,
        store_id: storeId,
        price: p.price,
        report_month: p.report_month,
      };
      const dedupKey = `${productId}:${storeId}:${p.report_month}`;
      const existing = rowsByKey.get(dedupKey);

      if (existing) {
        const conflictType = existing.price === row.price ? 'same_price' : 'different_price';
        duplicates.push({
          ...p,
          duplicate_key: dedupKey,
          existing_price: existing.price,
          duplicate_price: row.price,
          resolved_product_id: productId,
          resolved_store_id: storeId,
          conflict_type: conflictType,
        });
        if (conflictType === 'different_price') {
          conflictingDuplicates++;
        }
        continue;
      }

      rowsByKey.set(dedupKey, row);
    }

    if (skipped.length > 0) {
      this.logger.warn(`Skipped ${skipped.length} price entries (unresolved FK)`);
    }

    if (duplicates.length > 0) {
      this.logger.warn(
        `Collapsed ${duplicates.length} duplicate price entries before upsert` +
        (conflictingDuplicates ? ` (${conflictingDuplicates} had a conflicting price)` : ''),
      );
    }

    const rows = Array.from(rowsByKey.values());

    if (rows.length) {
      await this.upsertChunked('pistil_prices', rows, 'product_id,store_id,report_month');
    }

    return {
      upserted: rows.length,
      skipped,
      duplicates,
    };
  }

  private async fetchIdMap(table: string, keyColumn: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    let from = 0;

    while (true) {
      const to = from + this.SELECT_PAGE_SIZE - 1;
      const { data, error } = await this.sb
        .from(table)
        .select(`id, ${keyColumn}`)
        .range(from, to);
      if (error) throw error;

      const page = (data ?? []) as Array<Record<string, any>>;
      for (const row of page) {
        const key = row[keyColumn];
        if (key) {
          map.set(key, row.id);
        }
      }

      if (page.length < this.SELECT_PAGE_SIZE) {
        break;
      }

      from += this.SELECT_PAGE_SIZE;
    }

    return map;
  }

  // ──────────────────────────────────────────
  // Chunked upsert with adaptive retry
  // ──────────────────────────────────────────

  private async upsertChunked(table: string, rows: any[], onConflict: string) {
    if (!rows.length) return;

    let chunkSize = this.UPSERT_CHUNK;
    let offset = 0;
    let done = 0;
    const total = rows.length;
    const t0 = Date.now();

    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const batch = rows.slice(offset, end);
      let attempt = 0;

      while (true) {
        try {
          const { error } = await this.sb
            .from(table)
            .upsert(batch, { onConflict });
          if (error) throw error;
          break;
        } catch (e: any) {
          if (this.isStatementTimeout(e) && chunkSize > this.MIN_CHUNK && attempt < this.MAX_RETRIES) {
            const prev = chunkSize;
            chunkSize = Math.max(this.MIN_CHUNK, Math.floor(chunkSize / 2));
            this.logger.warn(`[ADAPT] ${table}: timeout, chunk ${prev} → ${chunkSize} (retry ${attempt + 1})`);
            attempt++;
            continue;
          }
          throw e;
        }
      }

      done += batch.length;
      offset = end;

      if (done % 5000 < chunkSize || done === total) {
        this.logger.log(`[${table}] upserted ${done}/${total} — ${fmtMs(Date.now() - t0)}`);
      }

      if (this.INTER_BATCH_SLEEP_MS && offset < total) {
        await new Promise((r) => setTimeout(r, this.INTER_BATCH_SLEEP_MS));
      }
    }
  }

  private isStatementTimeout(e: any): boolean {
    const code = e?.code || e?.details?.code || e?.error?.code;
    const msg = e?.message || e?.error?.message;
    return code === '57014' || /statement timeout/i.test(msg ?? '');
  }
}
