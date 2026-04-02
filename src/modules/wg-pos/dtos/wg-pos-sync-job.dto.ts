// wg-pos-sync-job.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class RunWgPosSyncJobDto {
  @ApiPropertyOptional({
    description: 'Si es true, continúa aunque un step falle. Si es false, fail-fast.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  continue_on_error?: boolean;

  @ApiPropertyOptional({
    description: 'Reintentos por step (además del primer intento).',
    default: 3,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  retries?: number;

  @ApiPropertyOptional({
    description:
      'Override global del rango “default” (en días hacia atrás) para steps normales. Default = 8.',
    default: 8,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  default_from_days_ago?: number;

  @ApiPropertyOptional({
    description:
      'Override del rango “receivedinventory” (en días hacia atrás). Default = 60.',
    default: 60,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  receivedinventory_from_days_ago?: number;

  @ApiPropertyOptional({
    description:
      'Días hacia adelante para to_utc. Default = 1 (now + 1 día).',
    default: 1,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  to_days_ahead?: number;
}

export class SyncJobStepResultDto {
  @ApiPropertyOptional() path?: string;
  @ApiPropertyOptional() ok?: boolean;
  @ApiPropertyOptional() ms?: number;
  @ApiPropertyOptional() error?: string;
  @ApiPropertyOptional({
    description: 'Payload usado para ese step (from_utc/to_utc).',
    example: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
  })
  payload?: { from_utc: string; to_utc: string };
}

export class RunWgPosSyncJobResponseDto {
  @ApiPropertyOptional() ok?: boolean;

  @ApiPropertyOptional({
    description: 'Fecha/hora UTC cuando arrancó.',
    example: '2026-02-22T06:00:00.000Z',
  })
  started_at_utc?: string;

  @ApiPropertyOptional({
    description: 'Fecha/hora UTC cuando terminó.',
    example: '2026-02-22T06:02:10.000Z',
  })
  finished_at_utc?: string;

  @ApiPropertyOptional({
    type: SyncJobStepResultDto,
    isArray: true,
  })
  steps?: SyncJobStepResultDto[];
}