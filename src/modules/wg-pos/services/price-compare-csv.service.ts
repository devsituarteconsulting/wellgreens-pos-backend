// src/modules/wg-pos/services/price-compare-csv.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { parseString } from '@fast-csv/parse';
import archiver from 'archiver';
import {
  PriceCompareStore,
  PriceCompareProduct,
  PriceCompareEntry,
  PriceCompareResult,
  PriceCompareImportDiagnostics,
} from '../dtos/price-compare.dto';

@Injectable()
export class PriceCompareCsvService {
  private readonly logger = new Logger(PriceCompareCsvService.name);

  async parsePriceCompareCsv(
    buffer: Buffer,
    opts: { reportMonth?: string },
  ): Promise<PriceCompareResult> {
    const startTime = Date.now();
    this.logger.log('Starting CSV parse...');

    const text = buffer.toString('utf8');
    const delimiter = this.detectDelimiter(text);
    this.logger.log(`Detected delimiter: ${JSON.stringify(delimiter)}`);

    // Parse everything with headers: false (positional arrays)
    const allRows = await this.parseCsvRaw(text, delimiter);
    this.logger.log(`CSV parsed: ${allRows.length} raw rows`);

    if (allRows.length < 6) {
      throw new Error('CSV must have at least 6 rows (5 header rows + 1 data row)');
    }

    // --- Extract metadata from rows 0-4 ---
    const nameRow = allRows[1];     // row 2: store names
    const licenseRow = allRows[2];  // row 3: licenses
    const countyRow = allRows[3];   // row 4: counties
    const addressRow = allRows[4];  // row 5: addresses

    // Stores start at column index 2 (cols 0=Product, 1=Category)
    const stores: PriceCompareStore[] = [];
    const storeByColOffset = new Map<number, PriceCompareStore>();
    const storeCount = Math.max(
      nameRow.length,
      licenseRow.length,
      countyRow.length,
      addressRow.length,
    ) - 2;

    for (let i = 0; i < storeCount; i++) {
      const colIdx = i + 2;
      const name = (nameRow[colIdx] ?? '').trim();
      if (!name) continue; // skip empty store columns

      const store: PriceCompareStore = {
        name,
        license: (licenseRow[colIdx] ?? '').trim(),
        county: (countyRow[colIdx] ?? '').trim(),
        address: (addressRow[colIdx] ?? '').trim(),
      };
      stores.push(store);
      storeByColOffset.set(i, store);
    }

    this.logger.log(`Extracted ${stores.length} stores from header rows`);

    // --- Extract products and prices from rows 5+ ---
    const productsMap = new Map<string, PriceCompareProduct>();
    const prices: PriceCompareEntry[] = [];
    const reportMonth = (opts.reportMonth ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
    this.logger.log(`Report month: ${reportMonth}`);

    let lastProductName = '';
    let skippedNonNumeric = 0;

    for (let rowIdx = 5; rowIdx < allRows.length; rowIdx++) {
      if ((rowIdx - 5) % 5000 === 0 && rowIdx > 5) {
        this.logger.log(`Processing row ${rowIdx}/${allRows.length} (${productsMap.size} products, ${prices.length} prices so far)`);
      }

      const row = allRows[rowIdx];
      const col0 = (row[0] ?? '').trim(); // product name
      const col1 = (row[1] ?? '').trim(); // category

      // Skip rows where both product and category are empty
      if (!col0 && !col1) continue;

      const isMainRow = col0.length > 0;

      if (isMainRow) {
        lastProductName = col0;
        if (!productsMap.has(lastProductName)) {
          productsMap.set(lastProductName, {
            product_name: lastProductName,
            primary_category: col1,
            alt_categories: [],
          });
        }
      } else {
        // Sub-row: alternate category for the same product
        if (!lastProductName) continue; // no parent product yet
        const product = productsMap.get(lastProductName);
        if (product && col1 && col1 !== product.primary_category) {
          if (!product.alt_categories.includes(col1)) {
            product.alt_categories.push(col1);
          }
        }
      }

      const category = col1 || (productsMap.get(lastProductName)?.primary_category ?? '');

      // Extract prices from columns 2+
      for (let colIdx = 2; colIdx < row.length; colIdx++) {
        const storeIdx = colIdx - 2;
        const store = storeByColOffset.get(storeIdx);
        if (!store) continue;

        const cellValue = (row[colIdx] ?? '').trim();
        if (!cellValue) continue;

        const price = parseFloat(cellValue);
        if (!Number.isFinite(price)) {
          skippedNonNumeric++;
          continue;
        }

        prices.push({
          product_name: lastProductName,
          category,
          store_name: store.name,
          price,
          report_month: reportMonth,
        });
      }
    }

    const products = Array.from(productsMap.values());

    const elapsedMs = Date.now() - startTime;

    if (skippedNonNumeric > 0) {
      this.logger.warn(`Skipped ${skippedNonNumeric} non-numeric price cells`);
    }

    this.logger.log(
      `Parsed CSV: ${stores.length} stores, ${products.length} products, ${prices.length} price entries — ${elapsedMs}ms`,
    );

    return {
      report_month: reportMonth,
      stores,
      products,
      prices,
      summary: {
        total_stores: stores.length,
        total_products: products.length,
        total_price_entries: prices.length,
      },
    };
  }

  async buildZip(
    result: PriceCompareResult,
    diagnostics?: PriceCompareImportDiagnostics,
  ): Promise<Buffer> {
    this.logger.log('Building ZIP with CSV exports...');
    const startTime = Date.now();

    const storesCsv = this.toCsv(
      ['name', 'license', 'county', 'address'],
      result.stores.map((s) => [s.name, s.license, s.county, s.address]),
    );

    const productsCsv = this.toCsv(
      ['product_name', 'primary_category', 'alt_categories'],
      result.products.map((p) => [p.product_name, p.primary_category, p.alt_categories.join('|')]),
    );

    const pricesCsv = this.toCsv(
      ['product_name', 'category', 'store_name', 'price', 'report_month'],
      result.prices.map((e) => [e.product_name, e.category, e.store_name, e.price, e.report_month]),
    );

    const files: Record<string, string> = {
      'stores.csv': storesCsv,
      'products.csv': productsCsv,
      'prices.csv': pricesCsv,
    };

    if (diagnostics?.skipped_prices?.length) {
      files['prices_skipped.csv'] = this.toCsv(
        [
          'product_name',
          'category',
          'store_name',
          'price',
          'report_month',
          'reason',
          'resolved_product_id',
          'resolved_store_id',
        ],
        diagnostics.skipped_prices.map((e) => [
          e.product_name,
          e.category,
          e.store_name,
          e.price,
          e.report_month,
          e.reason,
          e.resolved_product_id ?? '',
          e.resolved_store_id ?? '',
        ]),
      );
    }

    if (diagnostics?.duplicate_prices?.length) {
      files['prices_duplicates.csv'] = this.toCsv(
        [
          'product_name',
          'category',
          'store_name',
          'price',
          'report_month',
          'duplicate_key',
          'existing_price',
          'duplicate_price',
          'resolved_product_id',
          'resolved_store_id',
          'conflict_type',
        ],
        diagnostics.duplicate_prices.map((e) => [
          e.product_name,
          e.category,
          e.store_name,
          e.price,
          e.report_month,
          e.duplicate_key,
          e.existing_price,
          e.duplicate_price,
          e.resolved_product_id,
          e.resolved_store_id,
          e.conflict_type,
        ]),
      );
    }

    const buf = await this.createZipBuffer(files);

    this.logger.log(`ZIP built: ${(buf.length / 1024).toFixed(0)} KB — ${Date.now() - startTime}ms`);
    return buf;
  }

  // --- Helpers ---

  private toCsv(headers: string[], rows: (string | number)[][]): string {
    const escape = (v: string | number) => {
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
      lines.push(row.map(escape).join(','));
    }
    return lines.join('\n');
  }

  private createZipBuffer(files: Record<string, string>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      for (const [name, content] of Object.entries(files)) {
        archive.append(content, { name });
      }

      archive.finalize();
    });
  }

  private detectDelimiter(text: string): string {
    const lines = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, 30);
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestScore = -1;
    for (const cand of candidates) {
      const counts = lines.map(
        (l) => (l.match(new RegExp(`\\${cand}`, 'g')) || []).length,
      );
      const avg =
        counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
      if (avg > bestScore) {
        bestScore = avg;
        best = cand;
      }
    }
    return best;
  }

  private async parseCsvRaw(
    text: string,
    delimiter: string,
  ): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      const out: string[][] = [];
      parseString(text, {
        delimiter,
        headers: false,
        ignoreEmpty: false,
        trim: false,
      })
        .on('error', reject)
        .on('data', (row: string[]) => out.push(row))
        .on('end', () => resolve(out));
    });
  }
}
