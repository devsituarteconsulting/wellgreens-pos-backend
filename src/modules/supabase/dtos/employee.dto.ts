// src/modules/dutchie/dtos/employee.dto.ts
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class EmployeeDto {

  @IsInt()
  userId!: number;

  @IsOptional()
  @IsString()
  globalUserId?: string;

  @IsOptional()
  @IsString()
  loginId?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  defaultLocation?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  stateId?: string;

  @IsOptional()
  @IsString()
  mmjExpiration?: string;

  @IsOptional()
  @IsString()
  permissionsLocation?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groups?: string[];
}