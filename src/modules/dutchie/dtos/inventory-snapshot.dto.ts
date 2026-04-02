// src/modules/dutchie/dtos/reporting-transactions.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class InventorySnapshotQueryDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;

  @ApiPropertyOptional({ description: '' })
  @IsOptional() @IsISO8601()
  fromDate?: string;

}
