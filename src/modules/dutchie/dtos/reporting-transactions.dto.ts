// src/modules/dutchie/dtos/reporting-transactions.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class ReportingTransactionsQueryDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;

  @ApiPropertyOptional({ type: Number, description: 'Specific transaction identifier.' })
  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== '' ? parseInt(value, 10) : undefined))
  @IsInt() @Min(1)
  TransactionId?: number;

  @ApiPropertyOptional({ description: 'Start (UTC) for last modified window.' })
  @IsOptional() @IsISO8601()
  FromLastModifiedDateUTC?: string;

  @ApiPropertyOptional({ description: 'End (UTC) for last modified window.' })
  @IsOptional() @IsISO8601()
  ToLastModifiedDateUTC?: string;

  @ApiPropertyOptional({ description: 'Start (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  FromDateUTC?: string;

  @ApiPropertyOptional({ description: 'End (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  ToDateUTC?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Include detailed line items.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : undefined))
  @IsBoolean()
  IncludeDetail?: boolean;

  @ApiPropertyOptional({ type: Boolean, description: 'Include taxes.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : undefined))
  @IsBoolean()
  IncludeTaxes?: boolean;

  @ApiPropertyOptional({ type: Boolean, description: 'Include order identifiers.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : undefined))
  @IsBoolean()
  IncludeOrderIds?: boolean;

  @ApiPropertyOptional({ type: Boolean, description: 'Include fees and donations.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : undefined))
  @IsBoolean()
  IncludeFeesAndDonations?: boolean;
}
