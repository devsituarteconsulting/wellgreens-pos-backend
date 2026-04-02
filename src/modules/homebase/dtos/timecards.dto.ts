import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class TimecardsQueryDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;

  @ApiPropertyOptional({ description: 'Start (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End (UTC) for transaction date window.' })
  @IsOptional() @IsISO8601()
  end_date?: string;
}
