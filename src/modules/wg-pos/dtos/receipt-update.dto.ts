// src/modules/wg-pos/dtos/update-one-receipt.dto.ts
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateOneReceiptDto {
  @ApiProperty({ description: 'ID del registro a actualizar' })
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  store_id?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  received_inventory_id?: number;

  @ApiPropertyOptional({ example: '2025-10-24 00:00:00+00' })
  @IsOptional() @IsString()
  received_on?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  total_cost?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() vendor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendor_license?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() delivered_by?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() received_by?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() paid?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() transaction_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() products?: number;

  @ApiPropertyOptional({ example: '2025-11-23 00:00:00+00' })
  @IsOptional() @IsString()
  due_date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() metric_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_verified?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_updated?: boolean;
}
