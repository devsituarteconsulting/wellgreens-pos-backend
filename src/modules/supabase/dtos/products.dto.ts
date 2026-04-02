// src/modules/dutchie/dtos/product.dto.ts
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Subtablas normalizadas (nombres = columnas de Supabase) */

export class PricingTierDto {
  @IsOptional() @IsNumber() start_weight?: number;
  @IsOptional() @IsNumber() end_weight?: number;
  @IsNumber() price: number;
  @IsNumber() medical_price: number;
}

export class ProductTagDto {
  @IsInt() tag_id: number;
  @IsOptional() @IsString() tag_name?: string;
}

export class ProductEffectDto {
  @IsInt() effect_id: number;
  @IsOptional() @IsString() effect_name?: string;
}

export class ProductAllergensDto {
  @IsOptional() @IsBoolean() milk?: boolean;
  @IsOptional() @IsBoolean() eggs?: boolean;
  @IsOptional() @IsBoolean() fish?: boolean;
  @IsOptional() @IsBoolean() peanuts?: boolean;
  @IsOptional() @IsBoolean() tree_nuts?: boolean;
  @IsOptional() @IsBoolean() sesame?: boolean;
  @IsOptional() @IsBoolean() shellfish?: boolean;
  @IsOptional() @IsBoolean() soybeans?: boolean;
  @IsOptional() @IsBoolean() wheat?: boolean;
}

export class BroadcastResponseDto {
  @IsOptional() @IsString() location_name?: string;
  @IsOptional() @IsInt()    loc_id?: number;
  @IsOptional() @IsString() license_number?: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsInt()    outcome_id?: number;
  @IsOptional() @IsString() broadcasted_to?: string;
  @IsOptional() @IsString() error_detail?: string;
}

/** DTO principal normalizado a public.products (sin store_id en payload) */
export class ProductDto {
  @IsInt() product_id: number;

  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() internal_name?: string;
  @IsOptional() @IsString() product_name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() master_category?: string;

  @IsOptional() @IsInt()    category_id?: number;
  @IsOptional() @IsString() category?: string;

  @IsOptional() @IsString() image_url?: string;
  @IsOptional() @IsArray()  @IsString({ each: true }) image_urls?: string[];

  @IsOptional() @IsInt()    strain_id?: number;
  @IsOptional() @IsString() strain?: string;
  @IsOptional() @IsString() strain_type?: string;

  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsNumber() net_weight?: number;
  @IsOptional() @IsInt()    net_weight_unit_id?: number;
  @IsOptional() @IsString() net_weight_unit?: string;

  @IsOptional() @IsInt()    brand_id?: number;
  @IsOptional() @IsString() brand_name?: string;
  @IsOptional() @IsInt()    vendor_id?: number;
  @IsOptional() @IsString() vendor_name?: string;

  @IsOptional() @IsBoolean() is_cannabis?: boolean;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() is_coupon?: boolean;

  @IsOptional() @IsNumber() thc_content?: number;
  @IsOptional() @IsString() thc_content_unit?: string;
  @IsOptional() @IsNumber() cbd_content?: number;
  @IsOptional() @IsString() cbd_content_unit?: string;

  @IsOptional() @IsNumber() product_grams?: number;
  @IsOptional() @IsNumber() flower_equivalent?: number;
  @IsOptional() @IsNumber() rec_flower_equivalent?: number;

  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() med_price?: number;
  @IsOptional() @IsNumber() rec_price?: number;
  @IsOptional() @IsNumber() unit_cost?: number;

  @IsOptional() @IsString() unit_type?: string;

  @IsOptional() @IsString() online_title?: string;
  @IsOptional() @IsString() online_description?: string;
  @IsOptional() @IsBoolean() online_product?: boolean;

  @IsOptional() @IsBoolean() pos_products?: boolean;
  @IsOptional() @IsInt()    pricing_tier?: number;
  @IsOptional() @IsBoolean() online_available?: boolean;
  @IsOptional() @IsNumber() low_inventory_threshold?: number;

  @IsOptional() @IsString() pricing_tier_name?: string;
  @IsOptional() @IsString() pricing_tier_description?: string;

  @IsOptional() @IsString() flavor?: string;
  @IsOptional() @IsString() alternate_name?: string;
  @IsOptional() @IsString() lineage_name?: string;
  @IsOptional() @IsString() distillation_name?: string;

  @IsOptional() @IsNumber() max_purchaseable_per_transaction?: number;

  @IsOptional() @IsString() dosage?: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsString() allergens?: string;

  @IsOptional() @IsString() default_unit?: string;

  @IsOptional() @IsInt()    producer_id?: number;
  @IsOptional() @IsString() producer_name?: string;

  @IsOptional() @IsDateString() created_date?: string;
  @IsOptional() @IsBoolean()    is_medical_only?: boolean;
  @IsOptional() @IsDateString() last_modified_date_utc?: string;

  @IsOptional() @IsNumber() gross_weight?: number;
  @IsOptional() @IsBoolean() is_taxable?: boolean;

  @IsOptional() @IsArray()  @IsString({ each: true }) tax_categories?: string[];

  @IsOptional() @IsString() upc?: string;
  @IsOptional() @IsString() regulatory_category?: string;
  @IsOptional() @IsString() ndc?: string;
  @IsOptional() @IsNumber() days_supply?: number;

  @IsOptional() @IsString() illinois_tax_category?: string;

  @IsOptional() @IsString() external_category?: string;
  @IsOptional() @IsString() external_id?: string;
  @IsOptional() @IsBoolean() sync_externally?: boolean;

  @IsOptional() @IsString() regulatory_name?: string;

  @IsOptional() @IsString() administration_method?: string;
  @IsOptional() @IsNumber() unit_cbd_content_dose?: number;
  @IsOptional() @IsNumber() unit_thc_content_dose?: number;
  @IsOptional() @IsNumber() oil_volume?: number;

  @IsOptional() @IsString() ingredient_list?: string;
  @IsOptional() @IsInt()    expiration_days?: number;

  @IsOptional() @IsString() abbreviation?: string;
  @IsOptional() @IsBoolean() is_test_product?: boolean;
  @IsOptional() @IsBoolean() is_finished?: boolean;
  @IsOptional() @IsBoolean() allow_automatic_discounts?: boolean;

  @IsOptional() @IsString() serving_size?: string;
  @IsOptional() @IsInt()    serving_size_per_unit?: number;

  @IsOptional() @IsBoolean() is_nutrient?: boolean;

  @IsOptional() @IsDateString() approval_date_utc?: string;

  @IsOptional() @IsString() ecom_category?: string;
  @IsOptional() @IsString() ecom_subcategory?: string;

  @IsOptional() @IsString() custom_metadata?: string;

  /** Subcolecciones (normalizadas a tus tablas hijas) */

  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingTierDto)
  pricing_tiers?: PricingTierDto[]; // product_pricing_tiers (se tomará la última si llegan varias)

  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductTagDto)
  tags?: ProductTagDto[]; // product_tags

  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductEffectDto)
  effects?: ProductEffectDto[]; // product_effects

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductAllergensDto)
  allergens_std?: ProductAllergensDto; // product_allergens

  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BroadcastResponseDto)
  broadcast_responses?: BroadcastResponseDto[]; // product_broadcast_responses (se tomará la última si llegan varias)
}

/** Importación por lotes (opcional) */
export class ProductsBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDto)
  products: ProductDto[];
}
