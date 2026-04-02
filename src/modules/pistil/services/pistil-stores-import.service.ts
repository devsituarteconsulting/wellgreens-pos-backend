import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { parse } from '@fast-csv/parse';
import { Readable } from 'stream';

import { SUPABASE } from 'src/common/supabase/supabase.provider';

type pistil_store_row = {
  name: string;
  license: string;
  country: string;
  address: string;
};

type import_error = { row: number; reason: string };

// ===== Helpers =====
function normText(v: any): string {
  return String(v ?? '').trim();
}

async function parseCsvBuffer(buffer: Buffer): Promise<Record<string, any>[]> {
  return await new Promise((resolve, reject) => {
    const rows: Record<string, any>[] = [];

    Readable.from(buffer.toString('utf8'))
      .pipe(
        parse({
          headers: true,
          ignoreEmpty: true,
          trim: true,
        }),
      )
      .on('error', reject)
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows));
  });
}

@Injectable()
export class PistilStoresImportService {
  private readonly logger = new Logger(PistilStoresImportService.name);

  constructor(@Inject(SUPABASE) private readonly supabase: SupabaseClient) { }

  async importCsv(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Empty file');

    this.logger.log(`Iniciando import de pistil_stores. Archivo="${file.originalname}" size=${file.size}`);

    // 1) Parse CSV
    const rawRows = await parseCsvBuffer(file.buffer);
    this.logger.log(`CSV parseado. Filas=${rawRows.length}`);

    // 2) Validar + dedupe
    const { valid, errors, duplicates_in_file, unique_keys } = this.validateAndDedupe(rawRows);

    this.logger.log(`Validación lista. Validas=${valid.length}, Errores=${errors.length}`);

    // Si no hay filas válidas, no pegamos a Supabase
    if (!valid.length) {
      return {
        total_rows: rawRows.length,
        valid_rows: 0,
        unique_keys,
        duplicates_in_file,
        upserted_rows: 0,
        errors,
      };
    }

    // 3) Upsert
    const { data, error } = await this.supabase
      .from('pistil_stores')
      .upsert(valid, { onConflict: 'name,license' })
      .select('id');

    if (error) {
      this.logger.error(`Supabase upsert failed: ${error.message}`);
      throw new BadRequestException({
        message: 'Supabase upsert failed',
        details: error.message,
        code: (error as any).code,
        hint: (error as any).hint,
      });
    }

    const upserted = Array.isArray(data) ? data.length : 0;
    this.logger.log(`Import terminado OK. Upserted=${upserted}`);

    return {
      total_rows: rawRows.length,
      valid_rows: valid.length,
      unique_keys,
      duplicates_in_file,
      upserted_rows: upserted,
      errors,
    };
  }

  private validateAndDedupe(rows: Record<string, any>[]) {
    const errors: import_error[] = [];
    const map = new Map<string, pistil_store_row>();
    let duplicatesInFile = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNumber = i + 2;

      const name = String(r.name ?? '').trim();
      const license = String(r.license ?? '').trim();
      const country = String(r.country ?? '').trim();
      const address = String(r.address ?? '').trim();

      if (!name) {
        errors.push({ row: rowNumber, reason: 'Missing name' });
        continue;
      }
      if (!license) {
        errors.push({ row: rowNumber, reason: 'Missing license' });
        continue;
      }

      const key = `${name}||${license}`;

      if (map.has(key)) {
        duplicatesInFile += 1;
        errors.push({ row: rowNumber, reason: `Duplicate (name+license) in CSV: ${name} | ${license}` });
        continue;
      }

      map.set(key, { name, license, country, address });
    }

    return {
      valid: Array.from(map.values()),
      errors,
      duplicates_in_file: duplicatesInFile,
      unique_keys: map.size,
    };
  }
}