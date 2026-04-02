// src/modules/homebase/dtos/shift.dto.ts
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateNested,
} from 'class-validator';

export class HomebaseShiftLaborDto {
  @IsOptional()
  @IsString()
  wage_type?: string | null;

  @IsOptional()
  @IsNumber()
  scheduled_hours?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_overtime?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_regular?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_daily_overtime?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_weekly_overtime?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_double_overtimes?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_seventh_day_overtime_15?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_seventh_day_overtime_20?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_unpaid_breaks_hours?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_costs?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_overtime_costs?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_spread_of_hours?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_blue_laws_hours?: number | null;
}

export class HomebaseShiftDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsInt()
  timecard_id?: number | null;

  @IsOptional()
  @IsBoolean()
  open?: boolean;

  @IsOptional()
  @IsString()
  role?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  department?: string | null;

  @IsOptional()
  @IsString()
  first_name?: string | null;

  @IsOptional()
  @IsString()
  last_name?: string | null;

  @IsOptional()
  @IsInt()
  job_id?: number | null;

  @IsOptional()
  @IsInt()
  user_id?: number | null;

  @IsOptional()
  @IsNumber()
  wage_rate?: number | null;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsBoolean()
  scheduled?: boolean;

  @IsOptional()
  @IsISO8601()
  created_at?: string | null;

  @IsOptional()
  @IsISO8601()
  updated_at?: string | null;

  @IsOptional()
  @IsISO8601()
  start_at?: string | null;

  @IsOptional()
  @IsISO8601()
  end_at?: string | null;

  @IsOptional()
  @Type(() => HomebaseShiftLaborDto)
  @ValidateNested()
  labor?: HomebaseShiftLaborDto | null;
}
