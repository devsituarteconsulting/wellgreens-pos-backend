import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class ReceivedInventoryTransactionQueryDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;

  @ApiPropertyOptional({ type: String, description: 'Specific transaction type.' })
  @IsOptional()
  @IsString()
  transactionType?: string;

  @ApiPropertyOptional({ description: 'Start (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  endDate?: string;
}
