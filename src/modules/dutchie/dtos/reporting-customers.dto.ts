// src/modules/dutchie/dtos/reporting-transactions.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class ReportingCustomersQueryDto {

  @ApiPropertyOptional({ description: 'Filter customers modified after this UTC date - Used for incremental sync' })
  @IsOptional() @IsISO8601()
  fromLastModifiedDateUTC?: string;

  @ApiPropertyOptional({ description: 'Filter customers modified before this UTC date - Used for date range filtering' })
  @IsOptional() @IsISO8601()
  toLastModifiedDateUTC?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Include anonymous customers in results - Default: true' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : true))
  @IsBoolean()
  includeAnonymous?: boolean;
}
