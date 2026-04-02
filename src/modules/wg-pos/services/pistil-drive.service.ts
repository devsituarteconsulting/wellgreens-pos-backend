import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { google, drive_v3 } from 'googleapis';
import { SUPABASE } from '../../../common/supabase/supabase.provider';

type DriveFile = { fileId: string; fileName: string; reportMonth: string };

@Injectable()
export class PistilDriveService {
  private readonly logger = new Logger(PistilDriveService.name);
  private readonly drive: drive_v3.Drive;

  private readonly FOLDER_ID =
    process.env.PISTIL_DRIVE_FOLDER_ID || '1IdDQ-G6AvKWtqqmOrhAmJGqEkotIFQb7';

  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

    if (!clientEmail || !privateKeyRaw) {
      throw new Error(
        'Faltan GOOGLE_CLIENT_EMAIL y/o GOOGLE_PRIVATE_KEY para inicializar Google Drive API',
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKeyRaw.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Lista archivos pistil_YYYY-MM.csv en el folder de Drive.
   */
  async listCsvFiles(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.drive.files.list({
        q: `'${this.FOLDER_ID}' in parents and name contains 'pistil_' and name contains '.csv' and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 100,
        pageToken,
      });

      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name) continue;
        const month = this.extractMonth(f.name);
        if (month) {
          files.push({ fileId: f.id, fileName: f.name, reportMonth: month });
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    this.logger.log(`Found ${files.length} pistil CSVs in Drive`);
    return files;
  }

  /**
   * Consulta report_month ya existentes en pistil_prices.
   */
  async getExistingMonths(): Promise<Set<string>> {
    const result = await this.sb
      .from('pistil_prices')
      .select('report_month')
      .limit(10000);

    if (result.error) throw result.error;

    const months = new Set<string>();
    for (const row of result.data ?? []) {
      if (row.report_month) months.add(row.report_month);
    }

    this.logger.log(`Existing months in DB: ${months.size} (${[...months].sort().join(', ')})`);
    return months;
  }

  /**
   * Descarga un archivo de Drive como Buffer.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  /**
   * Orquestador: lista archivos, filtra los que no están en DB, descarga los pendientes.
   */
  async fetchPendingCsvs(): Promise<
    Array<{ reportMonth: string; buffer: Buffer; fileName: string }>
  > {
    const [driveFiles, existingMonths] = await Promise.all([
      this.listCsvFiles(),
      this.getExistingMonths(),
    ]);

    const pending = driveFiles.filter((f) => !existingMonths.has(f.reportMonth));

    if (pending.length === 0) {
      this.logger.log('No pending CSVs to process');
      return [];
    }

    this.logger.log(
      `Pending CSVs: ${pending.length} — ${pending.map((f) => f.reportMonth).join(', ')}`,
    );

    const results: Array<{ reportMonth: string; buffer: Buffer; fileName: string }> = [];

    for (const file of pending) {
      this.logger.log(`Downloading ${file.fileName}...`);
      const buffer = await this.downloadFile(file.fileId);
      this.logger.log(`Downloaded ${file.fileName}: ${(buffer.length / 1024).toFixed(0)} KB`);
      results.push({ reportMonth: file.reportMonth, buffer, fileName: file.fileName });
    }

    return results;
  }

  /**
   * Extrae YYYY-MM del nombre de archivo (e.g. "pistil_2026-02.csv" → "2026-02").
   */
  private extractMonth(fileName: string): string | null {
    const match = fileName.match(/(\d{4}-\d{2})/);
    return match ? match[1] : null;
  }
}
