// src/modules/dutchie/dtos/reporting-transactions.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class ReportingProductsQueryDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;

  @ApiPropertyOptional({ description: 'Filter products modified after this date for incremental sync - Optional' })
  @IsOptional() @IsISO8601()
  fromLastModifiedDateUTC?: string;

}
