// src/modules/dutchie/dtos/inventory-snapshot.dto.ts
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
} from 'class-validator';

export class InventorySnapshotDto {
  // Identificadores base
  @IsInt()
  inventoryId!: number; // Inventory record identifier

  @Transform(({ value }) => (value == null ? '0' : value))
  @IsString()
  packageId?: string; // Package identifier

  // Producto
  @IsString()
  sku!: string; // Stock Keeping Unit

  @IsString()
  product!: string; // Product name at snapshot time

  @IsInt()
  productId!: number; // Product identifier (catalog)

  // Ubicación / cuarto
  @IsString()
  room!: string; // Storage room name

  @IsInt()
  roomId!: number; // Storage room identifier

  // Vendor / batch (opcionales)
  @IsOptional() @IsString()
  vendor?: string | null;

  @IsOptional() @IsString()
  batchName?: string | null;

  @IsOptional() @IsInt()
  batchId?: number | null;

  // Cantidades / costos
  @IsNumber()
  quantity!: number; // Inventory quantity at snapshot date

  @IsOptional()
  @IsNumber()
  totalCost?: number | null; // Total cost value (optional)

  // Unidad
  @IsString()
  unit!: string; // Unit of measurement

  @IsInt()
  unitId!: number; // Unit identifier

  // Estado
  @IsOptional() @IsString()
  status?: string | null; // Inventory status at snapshot time

  // Fecha de snapshot
  @IsISO8601()
  snapshotDate!: string; // ISO date-time when snapshot was captured
}
