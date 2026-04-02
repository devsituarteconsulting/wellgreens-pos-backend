// src/modules/homebase/dtos/homebase-timecard.dto.ts
import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateNested,
} from 'class-validator';

export class HomebaseTimebreakDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsInt()
  mandated_break_id?: number | null;

  @IsInt()
  timecard_id!: number;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsInt()
  duration?: number | null;

  @IsOptional()
  @IsNumber()
  work_period?: number | null;

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
}

export class HomebaseLaborDto {
  @IsOptional()
  @IsString()
  wage_type?: string | null;

  @IsOptional()
  @IsNumber()
  break_penalty?: number | null;

  @IsOptional()
  @IsNumber()
  costs?: number | null;

  @IsOptional()
  @IsNumber()
  cash_tips?: number | null;

  @IsOptional()
  @IsNumber()
  credit_tips?: number | null;

  @IsOptional()
  @IsNumber()
  weekly_overtime?: number | null;

  @IsOptional()
  @IsNumber()
  paid_time_off_hours?: number | null;

  @IsOptional()
  @IsNumber()
  time_off_hours?: number | null;

  @IsOptional()
  @IsNumber()
  unpaid_break_hours?: number | null;

  @IsOptional()
  @IsNumber()
  regular_hours?: number | null;

  @IsOptional()
  @IsNumber()
  paid_hours?: number | null;

  @IsOptional()
  @IsNumber()
  scheduled_hours?: number | null;

  @IsOptional()
  @IsNumber()
  daily_overtime?: number | null;

  @IsOptional()
  @IsNumber()
  double_overtime?: number | null;

  @IsOptional()
  @IsNumber()
  seventh_day_overtime_15?: number | null;

  @IsOptional()
  @IsNumber()
  seventh_day_overtime_20?: number | null;

  @IsOptional()
  @IsNumber()
  wage_rate?: number | null;
}

export class HomebaseTimecardDto {
  @IsInt()
  id!: number;

  @IsInt()
  user_id!: number;

  @IsOptional()
  @IsString()
  first_name?: string | null;

  @IsOptional()
  @IsString()
  last_name?: string | null;

  @IsOptional()
  @IsString()
  payroll_id?: string | null;

  @IsOptional()
  @IsInt()
  job_id?: number | null;

  @IsOptional()
  @IsInt()
  shift_id?: number | null;

  @IsOptional()
  @IsString()
  role?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  department?: string | null;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @IsOptional()
  @IsISO8601()
  created_at?: string | null;

  @IsOptional()
  @IsISO8601()
  updated_at?: string | null;

  @IsOptional()
  @IsISO8601()
  clock_in?: string | null;

  @IsOptional()
  @IsISO8601()
  clock_out?: string | null;

  @IsOptional()
  @Type(() => HomebaseTimebreakDto)
  @ValidateNested({ each: true })
  @IsArray()
  timebreaks?: HomebaseTimebreakDto[] | null;

  @IsOptional()
  @Type(() => HomebaseLaborDto)
  @ValidateNested()
  labor?: HomebaseLaborDto | null;
}
