import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { google, drive_v3 } from 'googleapis';
import { SUPABASE } from '../../../common/supabase/supabase.provider';

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h ${m}m ${ss}s`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function buildDriveFileViewLink(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

type ReviewRow = {
  id: number;
  received_inventory_id: number;
  store_id: number | null;
  title: string | null;
  delivered_on: string | null;
  delivered_by: string | null;
  delivered_by_id: string | null;
  shared_drive_link: string | null;
};

type BackupRunOptions = {
  limit?: number;
  dryRun?: boolean;
};

type BackupSuccessMode =
  | 'reused_db'
  | 'reused_drive'
  | 'copied'
  | 'dry_run_copy';

type BackupFailureMode =
  | 'invalid_source'
  | 'source_not_found'
  | 'source_no_access'
  | 'source_not_pdf'
  | 'db_update_failed'
  | 'drive_search_failed'
  | 'drive_copy_failed'
  | 'unexpected_error';

type BackupRowResult =
  | {
      ok: true;
      mode: BackupSuccessMode;
      review_id: number;
      received_inventory_id: number;
      source_file_id: string;
      shared_drive_link: string;
      shared_drive_file_id: string;
    }
  | {
      ok: false;
      mode: BackupFailureMode;
      review_id: number;
      received_inventory_id: number;
      source_file_id: string | null;
      error: string;
    };

@Injectable()
export class ReceivedInventoryBackupService {
  private readonly logger = new Logger(ReceivedInventoryBackupService.name);

  private readonly SHARED_DRIVE_ID =
    process.env.RECEIVED_INVENTORY_SHARED_DRIVE_ID || '0AOQYuehS9-FLUk9PVA';

  private readonly DESTINATION_FOLDER_ID =
    process.env.RECEIVED_INVENTORY_SHARED_FOLDER_ID || '1S49cO2vI71bEAszApX9B4oRY2P0f40wg';

  private readonly PAGE_SIZE = 200;
  private readonly INTER_ITEM_SLEEP_MS = 50;
  private readonly MAX_SUMMARY_IDS_LOG = 25;

  private readonly drive: drive_v3.Drive;

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
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    this.drive = google.drive({
      version: 'v3',
      auth,
    });
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logProgress(
    label: string,
    done: number,
    total: number,
    t0?: number,
    extra?: string,
  ) {
    const left = total - done;
    const base = `${label} ${done}/${total} (faltan ${left})`;
    if (t0) {
      const elapsed = fmtMs(Date.now() - t0);
      this.logger.log(extra ? `${base} • ${elapsed} • ${extra}` : `${base} • ${elapsed}`);
      return;
    }
    this.logger.log(extra ? `${base} • ${extra}` : base);
  }

  private normalizeError(error: any): string {
    const msg =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      String(error);
    return typeof msg === 'string' ? msg : JSON.stringify(msg);
  }

  private isDriveNotFound(error: any): boolean {
    const status = error?.code || error?.response?.status;
    return status === 404;
  }

  private isDriveForbidden(error: any): boolean {
    const status = error?.code || error?.response?.status;
    return status === 403;
  }

  private compactIds(ids: number[]): string {
    if (!ids.length) return '[]';
    const shown = ids.slice(0, this.MAX_SUMMARY_IDS_LOG);
    const suffix =
      ids.length > this.MAX_SUMMARY_IDS_LOG
        ? ` ... (+${ids.length - this.MAX_SUMMARY_IDS_LOG} más)`
        : '';
    return `[${shown.join(', ')}]${suffix}`;
  }

  private async getSourceFileMetadata(sourceFileId: string) {
    return this.drive.files.get({
      fileId: sourceFileId,
      supportsAllDrives: true,
      fields: 'id,name,mimeType,trashed,parents,driveId,webViewLink',
    });
  }

  private async findPendingCandidates(limit: number): Promise<ReviewRow[]> {
    const { data, error } = await this.sb
      .from('dutchie_received_inventory_review')
      .select(
        'id,received_inventory_id,store_id,title,delivered_on,delivered_by,delivered_by_id,shared_drive_link',
      )
      .not('delivered_by_id', 'is', null)
      .neq('delivered_by_id', '')
      .is('shared_drive_link', null)
      .order('delivered_on', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return (data ?? []) as ReviewRow[];
  }

  private async findExistingBackupInDb(
    deliveredById: string,
    currentReviewId: number,
  ): Promise<{ shared_drive_link: string; shared_drive_file_id: string | null } | null> {
    const { data, error } = await this.sb
      .from('dutchie_received_inventory_review')
      .select('id,shared_drive_link,shared_drive_file_id')
      .eq('delivered_by_id', deliveredById)
      .not('shared_drive_link', 'is', null)
      .neq('id', currentReviewId)
      .order('id', { ascending: true })
      .limit(1);

    if (error) {
      throw error;
    }

    const row = data?.[0];
    if (!row?.shared_drive_link) return null;

    return {
      shared_drive_link: row.shared_drive_link,
      shared_drive_file_id: row.shared_drive_file_id ?? null,
    };
  }

  private async findExistingBackupInDrive(sourceFileId: string) {
    const q = [
      `'${this.DESTINATION_FOLDER_ID}' in parents`,
      `trashed = false`,
      `appProperties has { key='source_file_id' and value='${sourceFileId}' }`,
    ].join(' and ');

    const response = await this.drive.files.list({
      corpora: 'drive',
      driveId: this.SHARED_DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q,
      pageSize: 10,
      fields: 'files(id,name,webViewLink,appProperties)',
      orderBy: 'createdTime desc',
    });

    const file = response.data.files?.[0];
    if (!file?.id) return null;

    return {
      id: file.id,
      name: file.name ?? null,
      webViewLink: file.webViewLink ?? buildDriveFileViewLink(file.id),
    };
  }

  private async copyFileToSharedDrive(params: {
    sourceFileId: string;
    sourceName: string;
    reviewId: number;
    receivedInventoryId: number;
    storeId: number | null;
  }) {
    const { sourceFileId, sourceName, reviewId, receivedInventoryId, storeId } = params;

    const response = await this.drive.files.copy({
      fileId: sourceFileId,
      supportsAllDrives: true,
      requestBody: {
        name: sourceName,
        parents: [this.DESTINATION_FOLDER_ID],
        appProperties: {
          source_file_id: sourceFileId,
          review_id: String(reviewId),
          received_inventory_id: String(receivedInventoryId),
          store_id: storeId != null ? String(storeId) : '',
          backup_scope: 'received_inventory',
        },
      },
      fields: 'id,name,webViewLink,appProperties',
    });

    const copied = response.data;
    if (!copied?.id) {
      throw new Error('Drive copy no devolvió file id');
    }

    return {
      id: copied.id,
      name: copied.name ?? sourceName,
      webViewLink: copied.webViewLink ?? buildDriveFileViewLink(copied.id),
    };
  }

  private async updateReviewRowLink(reviewId: number, sharedDriveLink: string) {
    const { data, error } = await this.sb
      .from('dutchie_received_inventory_review')
      .update({
        shared_drive_link: sharedDriveLink,
      })
      .eq('id', reviewId)
      .select('id,shared_drive_link,shared_drive_file_id')
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  private async processCandidate(row: ReviewRow, dryRun = false): Promise<BackupRowResult> {
    const reviewId = row.id;
    const receivedInventoryId = row.received_inventory_id;
    const sourceFileId = row.delivered_by_id?.trim() || null;

    if (!sourceFileId) {
      return {
        ok: false,
        mode: 'invalid_source',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: null,
        error: 'delivered_by_id vacío o inválido',
      };
    }

    this.logger.log(
      `[review:${reviewId}][rx:${receivedInventoryId}] Analizando source_file_id=${sourceFileId}`,
    );

    let sourceMeta: {
      id?: string | null;
      name?: string | null;
      mimeType?: string | null;
      trashed?: boolean | null;
    };

    try {
      const metaRes = await this.getSourceFileMetadata(sourceFileId);
      sourceMeta = {
        id: metaRes.data.id ?? null,
        name: metaRes.data.name ?? null,
        mimeType: metaRes.data.mimeType ?? null,
        trashed: metaRes.data.trashed ?? false,
      };
    } catch (error: any) {
      const msg = this.normalizeError(error);

      if (this.isDriveNotFound(error)) {
        this.logger.warn(
          `[review:${reviewId}][rx:${receivedInventoryId}] Source file no accesible: no existe, fue eliminado o la identidad actual no tiene acceso. source_file_id=${sourceFileId}`,
        );
        return {
          ok: false,
          mode: 'source_not_found',
          review_id: reviewId,
          received_inventory_id: receivedInventoryId,
          source_file_id: sourceFileId,
          error: msg,
        };
      }

      if (this.isDriveForbidden(error)) {
        this.logger.warn(
          `[review:${reviewId}][rx:${receivedInventoryId}] Sin permisos para acceder al source file. source_file_id=${sourceFileId}`,
        );
        return {
          ok: false,
          mode: 'source_no_access',
          review_id: reviewId,
          received_inventory_id: receivedInventoryId,
          source_file_id: sourceFileId,
          error: msg,
        };
      }

      this.logger.error(
        `[review:${reviewId}][rx:${receivedInventoryId}] Error inesperado consultando source file: ${msg}`,
      );
      return {
        ok: false,
        mode: 'unexpected_error',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        error: msg,
      };
    }

    if (!sourceMeta.id || sourceMeta.trashed) {
      return {
        ok: false,
        mode: 'source_not_found',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        error: 'El archivo origen no existe o está en trash',
      };
    }

    if (sourceMeta.mimeType !== 'application/pdf') {
      this.logger.warn(
        `[review:${reviewId}][rx:${receivedInventoryId}] Source file no es PDF. mimeType=${sourceMeta.mimeType}`,
      );
      return {
        ok: false,
        mode: 'source_not_pdf',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        error: `El archivo origen no es PDF: ${sourceMeta.mimeType ?? 'unknown'}`,
      };
    }

    this.logger.log(
      `[review:${reviewId}][rx:${receivedInventoryId}] Source file accesible. name="${sourceMeta.name}" mimeType=${sourceMeta.mimeType}`,
    );

    try {
      const existingDb = await this.findExistingBackupInDb(sourceFileId, reviewId);
      if (existingDb?.shared_drive_link) {
        this.logger.log(
          `[review:${reviewId}][rx:${receivedInventoryId}] Backup ya existía en DB para source_file_id=${sourceFileId}. Reutilizando link.`,
        );

        if (!dryRun) {
          const updated = await this.updateReviewRowLink(reviewId, existingDb.shared_drive_link);
          return {
            ok: true,
            mode: 'reused_db',
            review_id: reviewId,
            received_inventory_id: receivedInventoryId,
            source_file_id: sourceFileId,
            shared_drive_link: updated.shared_drive_link,
            shared_drive_file_id: updated.shared_drive_file_id,
          };
        }

        this.logger.log(
          `[review:${reviewId}][rx:${receivedInventoryId}] DRY RUN: reutilizaría shared_drive_link ya existente en DB.`,
        );

        return {
          ok: true,
          mode: 'reused_db',
          review_id: reviewId,
          received_inventory_id: receivedInventoryId,
          source_file_id: sourceFileId,
          shared_drive_link: existingDb.shared_drive_link,
          shared_drive_file_id:
            existingDb.shared_drive_file_id ??
            (existingDb.shared_drive_link.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? ''),
        };
      }
    } catch (error: any) {
      const msg = this.normalizeError(error);
      this.logger.error(
        `[review:${reviewId}][rx:${receivedInventoryId}] Error buscando backup previo en DB: ${msg}`,
      );
      return {
        ok: false,
        mode: 'unexpected_error',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        error: msg,
      };
    }

    try {
      const existingDrive = await this.findExistingBackupInDrive(sourceFileId);

      if (existingDrive?.id && existingDrive.webViewLink) {
        this.logger.log(
          `[review:${reviewId}][rx:${receivedInventoryId}] Backup ya existía en Drive para source_file_id=${sourceFileId}. file_id=${existingDrive.id}`,
        );

        if (!dryRun) {
          const updated = await this.updateReviewRowLink(reviewId, existingDrive.webViewLink);
          return {
            ok: true,
            mode: 'reused_drive',
            review_id: reviewId,
            received_inventory_id: receivedInventoryId,
            source_file_id: sourceFileId,
            shared_drive_link: updated.shared_drive_link,
            shared_drive_file_id: updated.shared_drive_file_id,
          };
        }

        this.logger.log(
          `[review:${reviewId}][rx:${receivedInventoryId}] DRY RUN: reutilizaría backup ya existente en Drive.`,
        );

        return {
          ok: true,
          mode: 'reused_drive',
          review_id: reviewId,
          received_inventory_id: receivedInventoryId,
          source_file_id: sourceFileId,
          shared_drive_link: existingDrive.webViewLink,
          shared_drive_file_id: existingDrive.id,
        };
      }
    } catch (error: any) {
      const msg = this.normalizeError(error);
      this.logger.error(
        `[review:${reviewId}][rx:${receivedInventoryId}] Error buscando backup previo en Drive: ${msg}`,
      );
      return {
        ok: false,
        mode: 'drive_search_failed',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        error: msg,
      };
    }

    try {
      const sourceName =
        sourceMeta.name?.trim() ||
        `received-inventory-${receivedInventoryId}-source-${sourceFileId}.pdf`;

      if (dryRun) {
        this.logger.log(
          `[review:${reviewId}][rx:${receivedInventoryId}] DRY RUN: copiaría archivo al Shared Drive. folder_id=${this.DESTINATION_FOLDER_ID}`,
        );

        const fakeFileId = `dry-run-${sourceFileId}`;
        return {
          ok: true,
          mode: 'dry_run_copy',
          review_id: reviewId,
          received_inventory_id: receivedInventoryId,
          source_file_id: sourceFileId,
          shared_drive_link: buildDriveFileViewLink(fakeFileId),
          shared_drive_file_id: fakeFileId,
        };
      }

      this.logger.log(
        `[review:${reviewId}][rx:${receivedInventoryId}] Copiando archivo al Shared Drive. folder_id=${this.DESTINATION_FOLDER_ID}`,
      );

      const copied = await this.copyFileToSharedDrive({
        sourceFileId,
        sourceName,
        reviewId,
        receivedInventoryId,
        storeId: row.store_id,
      });

      this.logger.log(
        `[review:${reviewId}][rx:${receivedInventoryId}] Archivo copiado exitosamente al Shared Drive. new_file_id=${copied.id}`,
      );

      const updated = await this.updateReviewRowLink(reviewId, copied.webViewLink);

      return {
        ok: true,
        mode: 'copied',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        shared_drive_link: updated.shared_drive_link,
        shared_drive_file_id: updated.shared_drive_file_id,
      };
    } catch (error: any) {
      const msg = this.normalizeError(error);
      this.logger.error(
        `[review:${reviewId}][rx:${receivedInventoryId}] Error copiando al Shared Drive o actualizando DB: ${msg}`,
      );

      if (/update|supabase|postgres|row/i.test(msg)) {
        return {
          ok: false,
          mode: 'db_update_failed',
          review_id: reviewId,
          received_inventory_id: receivedInventoryId,
          source_file_id: sourceFileId,
          error: msg,
        };
      }

      return {
        ok: false,
        mode: 'drive_copy_failed',
        review_id: reviewId,
        received_inventory_id: receivedInventoryId,
        source_file_id: sourceFileId,
        error: msg,
      };
    }
  }

  async runBackup(options: BackupRunOptions = {}) {
    const limit = Math.max(1, options.limit ?? this.PAGE_SIZE);
    const dryRun = options.dryRun ?? false;

    const t0 = Date.now();

    this.logger.log(
      `Iniciando backup de received inventory PDFs. limit=${limit} dryRun=${dryRun} sharedDriveId=${this.SHARED_DRIVE_ID} folderId=${this.DESTINATION_FOLDER_ID}`,
    );

    const candidates = await this.findPendingCandidates(limit);
    const total = candidates.length;

    if (!total) {
      this.logger.log(`No hay candidatos pendientes de backup.`);
      return {
        ok: true,
        dry_run: dryRun,
        total_candidates: 0,
        processed: 0,
        reused_db: 0,
        reused_drive: 0,
        copied: 0,
        dry_run_copy: 0,
        failed: 0,
        success_review_ids: [],
        failed_review_ids: [],
        failures: [],
        elapsed_ms: Date.now() - t0,
      };
    }

    this.logger.log(`Candidatos encontrados: ${total}`);

    let processed = 0;
    let reusedDb = 0;
    let reusedDrive = 0;
    let copied = 0;
    let dryRunCopy = 0;
    let failed = 0;

    const successReviewIds: number[] = [];
    const failedReviewIds: number[] = [];
    const failures: BackupRowResult[] = [];

    for (const row of candidates) {
      const result = await this.processCandidate(row, dryRun);

      processed++;

      if (result.ok) {
        successReviewIds.push(result.review_id);

        if (result.mode === 'reused_db') reusedDb++;
        if (result.mode === 'reused_drive') reusedDrive++;
        if (result.mode === 'copied') copied++;
        if (result.mode === 'dry_run_copy') dryRunCopy++;

        const statusLabel = dryRun && result.mode === 'dry_run_copy' ? 'DRY_RUN_OK' : 'OK';

        this.logger.log(
          `[review:${result.review_id}][rx:${result.received_inventory_id}] ${statusLabel} mode=${result.mode} shared_drive_file_id=${result.shared_drive_file_id}`,
        );
      } else {
        failed++;
        failedReviewIds.push(result.review_id);
        failures.push(result);

        this.logger.warn(
          `[review:${result.review_id}][rx:${result.received_inventory_id}] FAIL mode=${result.mode} error=${result.error}`,
        );
      }

      this.logProgress(
        dryRun ? 'backup received inventory (dry-run)' : 'backup received inventory',
        processed,
        total,
        t0,
        `ok=${processed - failed} failed=${failed}`,
      );

      if (this.INTER_ITEM_SLEEP_MS) {
        await this.sleep(this.INTER_ITEM_SLEEP_MS);
      }
    }

    const elapsedMs = Date.now() - t0;

    this.logger.log(
      `Backup de received inventory finalizado. dryRun=${dryRun} total=${total} processed=${processed} reused_db=${reusedDb} reused_drive=${reusedDrive} copied=${copied} dry_run_copy=${dryRunCopy} failed=${failed} elapsed=${fmtMs(elapsedMs)}`,
    );

    this.logger.log(
      `Resumen review_id exitosos (${successReviewIds.length}): ${this.compactIds(successReviewIds)}`,
    );

    if (failedReviewIds.length) {
      this.logger.warn(
        `Resumen review_id fallidos (${failedReviewIds.length}): ${this.compactIds(failedReviewIds)}`,
      );
    }

    return {
      ok: failed === 0,
      dry_run: dryRun,
      total_candidates: total,
      processed,
      reused_db: reusedDb,
      reused_drive: reusedDrive,
      copied,
      dry_run_copy: dryRunCopy,
      failed,
      success_review_ids: successReviewIds,
      failed_review_ids: failedReviewIds,
      failures,
      elapsed_ms: elapsedMs,
    };
  }
}