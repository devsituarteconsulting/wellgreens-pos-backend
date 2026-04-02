// src/modules/wg-pos/dtos/price-compare.dto.ts

export interface PriceCompareStore {
  name: string;
  license: string;
  county: string;
  address: string;
}

export interface PriceCompareProduct {
  product_name: string;
  primary_category: string;
  alt_categories: string[];
}

export interface PriceCompareEntry {
  product_name: string;
  category: string;
  store_name: string;
  price: number;
  report_month: string;
}

export interface PriceCompareSkippedEntry extends PriceCompareEntry {
  reason: string;
  resolved_product_id: number | null;
  resolved_store_id: number | null;
}

export interface PriceCompareDuplicateEntry extends PriceCompareEntry {
  duplicate_key: string;
  existing_price: number;
  duplicate_price: number;
  resolved_product_id: number;
  resolved_store_id: number;
  conflict_type: 'same_price' | 'different_price';
}

export interface PriceCompareResult {
  report_month: string;
  stores: PriceCompareStore[];
  products: PriceCompareProduct[];
  prices: PriceCompareEntry[];
  summary: {
    total_stores: number;
    total_products: number;
    total_price_entries: number;
  };
}

export interface PriceCompareImportDiagnostics {
  skipped_prices: PriceCompareSkippedEntry[];
  duplicate_prices: PriceCompareDuplicateEntry[];
}
