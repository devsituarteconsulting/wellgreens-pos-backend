import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsISO8601, Min } from 'class-validator';

export class StoreSelectorDto {
  @ApiProperty({ description: 'Internal store id' })
  @IsString()
  store_id!: string;
}

export class PageDto {
  @IsOptional() @Transform(({ value }) => parseInt(value, 10)) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Transform(({ value }) => parseInt(value, 10)) @IsInt() @Min(1)
  page_size?: number = 100;
}

export class DateRangeDto {
  @IsOptional() @IsISO8601()
  date_from?: string;

  @IsOptional() @IsISO8601()
  date_to?: string;
}

export class SearchDto extends PageDto {
  @IsOptional() @IsString()
  q?: string;
}
