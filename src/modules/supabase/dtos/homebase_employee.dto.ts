// src/modules/homebase/dtos/employee.dto.ts
import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateNested,
} from 'class-validator';

export class HomebaseEmployeeJobDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsString()
  level?: string | null;

  @IsOptional()
  @IsString()
  default_role?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  pin?: string | null;

  @IsOptional()
  @IsString()
  pos_partner_id?: string | null;

  // Homebase lo manda como string (uuid) o null
  @IsOptional()
  @IsString()
  payroll_id?: string | null;

  @IsOptional()
  @IsNumber()
  wage_rate?: number | null;

  @IsOptional()
  @IsString()
  wage_type?: string | null;

  @IsOptional()
  @IsArray()
  roles?: any[] | null;

  @IsOptional()
  @IsISO8601()
  archived_at?: string | null;

  @IsOptional()
  @IsString()
  location_uuid?: string | null;
}

export class HomebaseEmployeeDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsString()
  first_name?: string | null;

  @IsOptional()
  @IsString()
  last_name?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  phone?: string | null;

  @IsOptional()
  @Type(() => HomebaseEmployeeJobDto)
  @ValidateNested()
  job?: HomebaseEmployeeJobDto | null;

  @IsOptional()
  @IsISO8601()
  created_at?: string | null;

  @IsOptional()
  @IsISO8601()
  updated_at?: string | null;
}
