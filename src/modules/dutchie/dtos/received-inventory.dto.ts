import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class ReceivedInventoryQueryDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;

  @ApiPropertyOptional({ type: Number, description: 'Specific transaction identifier.' })
  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== '' ? parseInt(value, 10) : undefined))
  @IsInt() @Min(1)
  receiveInventoryHistoryId?: number;

  @ApiPropertyOptional({ description: 'Start (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  endDate?: string;
}
