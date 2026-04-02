import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';
import { Transform } from 'class-transformer';

// Normaliza 'YYYY-MM-DD' -> 'YYYY-MM-DDT00:00:00Z'
function normalizeDateInput(value: string | undefined) {
  if (!value) return value;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return dateOnly ? `${value}T00:00:00Z` : value;
}

export class SyncDto {
  @ApiProperty({
    description: 'Fecha inicial (UTC). Acepta "YYYY-MM-DD" o ISO-8601.',
    examples: ['2025-10-01', '2025-10-01T00:00:00Z'],
  })
  @Transform(({ value }) => normalizeDateInput(value))
  @IsISO8601()
  from_utc!: string;

  @ApiProperty({
    description:
      'Fecha final (UTC, exclusiva). Acepta "YYYY-MM-DD" o ISO-8601. ' +
      'Ej: from=2025-10-01 y to=2025-10-02 significa TODO el día 2025-10-01.',
    examples: ['2025-10-02', '2025-10-02T00:00:00Z'],
  })
  @Transform(({ value }) => normalizeDateInput(value))
  @IsISO8601()
  to_utc!: string;
}

export class SyncDto2 {
  @ApiProperty({
    description: 'Fecha inicial (UTC). Acepta "YYYY-MM-DD" o ISO-8601.',
    examples: ['2025-10-01', '2025-10-01T00:00:00Z'],
  })
  @IsISO8601()
  from_utc: string;
}

