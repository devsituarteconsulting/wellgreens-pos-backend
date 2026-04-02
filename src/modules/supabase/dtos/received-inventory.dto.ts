// src/modules/dutchie/dtos/received-inventory.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class ReceivedInventoryItemDto {
  @IsString() sku!: string;           // viene siempre
  @IsNumber() productId!: number;     // viene siempre

  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsString() unitAbbreviation?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() unitCost?: number;
  @IsOptional() @IsNumber() unitTax?: number;
  @IsOptional() @IsNumber() totalCost?: number;
  @IsOptional() @IsString() packageId?: string;
  @IsOptional() @IsString() externalPackageId: string;
  @IsOptional() @IsString() batchName?: string;
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsString() room?: string;
  @IsOptional() @IsString() roomId?: string;
}

export class ReceivedInventoryDto {
  @IsNumber() receiveInventoryHistoryId!: number; // id externo (header)
  @IsOptional() @IsNumber() storeId?: number;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() failureMessage?: string;
  @IsOptional() @IsString() deliveredOn?: string; // ISO string (queda como text en DB)
  @IsOptional() @IsString() addedOn?: string;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() vendorLicense?: string;
  @IsOptional() @IsString() transactionId?: string;
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() deliveredBy?: string;
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsOptional() @IsNumber() vendorId?: number;
  @IsOptional() @IsString() vendorGlobalId?: string;
  @IsOptional() @IsNumber() totalCredit?: number;
  @IsOptional() @IsNumber() shippingCharge?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedInventoryItemDto)
  items!: ReceivedInventoryItemDto[];
}
