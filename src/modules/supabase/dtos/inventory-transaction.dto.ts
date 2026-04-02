// src/modules/dutchie/dtos/inventory-transaction.dto.ts
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
} from 'class-validator';

export class InventoryTransactionDto {
  // Identificador requerido
  @IsInt()
  inventoryTransactionId!: number;

  // Tipo / usuario / fecha
  @IsOptional() @IsString()
  transactionType?: string | null;

  @IsOptional() @IsString()
  transactionBy?: string | null;

  @IsISO8601()
  transactionDate!: string;

  // Producto
  @IsOptional() @IsString()
  product?: string | null;

  @IsOptional() @IsString()
  sku?: string | null;

  @IsInt()
  productId!: number;

  @IsOptional() @IsString()
  unit?: string | null;

  // Paquete / batch
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null) return null;
    const s = `${value}`.trim();
    return s === '' ? null : s;
  })
  @IsString()
  packageId?: string | null;

  @IsOptional()
  @Transform(({ value }) => {
    if (value == null) return null;
    const s = `${value}`.trim();
    return s === '' ? null : s;
  })
  @IsString()
  externalPackageId?: string | null;

  @IsOptional() @IsInt()
  batchId?: number | null;

  @IsOptional() @IsString()
  batchName?: string | null;

  // Cantidades / ajuste
  @IsOptional() @IsNumber()
  quantity?: number | null;

  @IsOptional() @IsNumber()
  fromQuantity?: number | null;

  @IsOptional() @IsNumber()
  toQuantity?: number | null;

  @IsOptional() @IsString()
  reason?: string | null;

  // Referencias opcionales
  @IsOptional() @IsInt()
  receiveInventoryHistoryId?: number | null;

  @IsOptional() @IsInt()
  conversionTransactionId?: number | null;

  @IsOptional() @IsInt()
  purchaseOrderId?: number | null;

  // Ubicaciones (Move)
  @IsOptional() @IsString()
  fromLocation?: string | null;

  @IsOptional() @IsString()
  fromRoom?: string | null;

  @IsOptional() @IsString()
  toLocation?: string | null;

  @IsOptional() @IsString()
  toRoom?: string | null;

  // Costos
  @IsOptional() @IsNumber()
  unitCost?: number | null;

  // Inventario afectado (requerido)
  @IsInt()
  inventoryId!: number;
}
