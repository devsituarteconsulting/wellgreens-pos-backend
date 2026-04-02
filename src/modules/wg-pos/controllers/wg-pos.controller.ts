// src/modules/wg-pos/controllers/wg-pos.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';

import { SyncReportingTransactionsService } from '../services/sync-reporting-transactions.service';
import { SyncReceivedInventoryService } from '../services/sync-received-inventory.service';
import { SyncDto, SyncDto2 } from '../dtos/sync.dto';

// Servicio que haremos en el siguiente paso:
//   src/modules/wg-pos/services/receipts-csv.service.ts
// Debe exponer: inspectCsv(fileBuffer: Buffer, opts: { headerRow: number })
import { ReceiptsCsvService } from '../services/receipts-csv.service';
import { ReceiptsImportService } from '../services/receipts-import.service';
import { ReceiptsResolveService } from '../services/receipts-resolve.service';
import { UpdateOneReceiptDto } from '../dtos/receipt-update.dto';
import { SyncReportingProductsService } from '../services/sync-reporting-products.service';
import { SyncReportingCustomersService } from '../services/sync-reporting-customers.service';
import { SyncInventorySnapshotService } from '../services/sync-inventory-snapshot.service';
import { SyncInventoryTransactionsService } from '../services/sync-inventory-transactions.service';
import { SyncHomebaseTimecardsService } from '../services/sync-homebase-timecards.service';
import { SyncHomebaseShiftsService } from '../services/sync-homebase-shifts.service';
import { RunWgPosSyncJobDto, RunWgPosSyncJobResponseDto } from '../dtos/wg-pos-sync-job.dto';
import { WgPosSyncJobService } from '../services/wg-pos-sync-job.service';
import { SyncDutchieEmployeesService } from '../services/sync-dutchie-employees.service';
import { ReceivedInventoryBackupService } from '../services/backup-received-inventory.service';
import { PriceCompareCsvService } from '../services/price-compare-csv.service';
import { PistilImportService } from '../../supabase/services/pistil-import.service';
import { PistilDriveService } from '../services/pistil-drive.service';

@ApiTags('wg-pos')
@Controller('wg-pos')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class WgPosController {
  constructor(
    private readonly svc: SyncReportingTransactionsService,
    private readonly svc3: SyncReportingProductsService,
    private readonly svc2: SyncReceivedInventoryService,
    private readonly csv: ReceiptsCsvService,
    private readonly resolver: ReceiptsResolveService,
    private readonly importer: ReceiptsImportService,
    private readonly importer2: SyncReportingCustomersService,
    private readonly importer3: SyncInventorySnapshotService,
    private readonly importer4: SyncInventoryTransactionsService,
    private readonly importer5: SyncHomebaseTimecardsService,
    private readonly importer6: SyncHomebaseShiftsService,
    private readonly importer7: SyncDutchieEmployeesService,
    private readonly job: WgPosSyncJobService,
    private readonly backupService: ReceivedInventoryBackupService,
    private readonly priceCompareCsv: PriceCompareCsvService,
    private readonly pistilImport: PistilImportService,
    private readonly pistilDrive: PistilDriveService,
  ) { }

  @Post('sync/reporting/transactions')
  @ApiOperation({
    summary: 'Sync de transacciones por días (todas las tiendas)',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día recorre todas las tiendas activas, consulta /dutchie/reporting/transactions ' +
      'y guarda el resultado día por día en /supabase/reporting/transactions ' +
      'Modo fail-fast: si falla una tienda en un día, se corta el proceso y se reporta (día y tienda).',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días/tiendas se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una tienda/día (fail-fast).',
  })
  syncTransactions(@Body() dto: SyncDto) {
    return this.svc.syncAllStoresTransactions(dto);
  }

  @Post('sync/reporting/products')
  @ApiOperation({
    summary: 'Sync de productos por dias (todas las tiendas)',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día recorre todas las tiendas activas, consulta /dutchie/reporting/products' +
      'y guarda el resultado día por día en /supabase/reporting/products ' +
      'Modo fail-fast: si falla una tienda en un día, se corta el proceso y se reporta (día y tienda).',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días/tiendas se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una tienda/día (fail-fast).',
  })
  syncProoducts(@Body() dto: SyncDto) {
    return this.svc3.syncAllStoresProducts(dto);
  }

  @Post('sync/inventory/receivedinventory')
  @ApiOperation({
    summary: 'Sync de inventario recibido por días (todas las tiendas)',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día recorre todas las tiendas activas, consulta /dutchie/inventory/receivedinventory ' +
      'y guarda el resultado día por día en /supabase/inventory/receivedinventory ' +
      'Modo fail-fast: si falla una tienda en un día, se corta el proceso y se reporta (día y tienda).',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días/tiendas se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una tienda/día (fail-fast).',
  })
  syncReceivedInventory(@Body() dto: SyncDto) {
    return this.svc2.syncAllStoresReceivedInventory(dto);
  }

  // ================================
  // DRY-RUN: inspección de CSV recibos
  // ================================

  // @Post('inventory/receivedinventory/receipts/import-csv/dry-run')
  // @ApiOperation({
  //   summary: 'Dry-run de CSV de recibos de inventario (sin escribir en DB)',
  //   description:
  //     'Recibe el archivo CSV tal cual exportado (fila 4 = encabezados). ' +
  //     'Detecta columnas, cuenta filas y devuelve una muestra. No persiste nada.',
  // })
  // @ApiConsumes('multipart/form-data')
  // @ApiBody({
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       file: { type: 'string', format: 'binary' },
  //     },
  //     required: ['file'],
  //   },
  // })
  // @UseInterceptors(
  //   FileInterceptor('file', {
  //     storage: multer.memoryStorage(),
  //     limits: { fileSize: 100 * 1024 * 1024 },
  //   }),
  // )
  // @ApiOkResponse({
  //   description: 'Columnas detectadas, total de filas y primeras 10 filas como muestra.',
  // })
  // @ApiBadRequestResponse({ description: 'Archivo faltante o formato inválido.' })
  // async dryRunReceiptsCsv(
  //   @UploadedFile() file: Express.Multer.File,
  // ) {
  //   if (!file) throw new BadRequestException('Falta el archivo CSV (campo "file").');

  //   const HEADER_ROW_FIXED = 0; // fijo
  //   return this.csv.inspectCsv(file.buffer, { headerRow: HEADER_ROW_FIXED });
  // }

  // @Post('inventory/receivedinventory/receipts/import-csv/dry-run-normalized')
  // @ApiOperation({
  //   summary: 'Dry-run normalizado de CSV (sin escribir en DB)',
  //   description:
  //     'Aplica limpieza de números, fechas y booleanos; Title vacío/malformado se deja NULL. ' +
  //     'No resuelve store_id ni received_inventory_id todavía.',
  // })
  // @ApiConsumes('multipart/form-data')
  // @ApiBody({
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       file: { type: 'string', format: 'binary' },
  //     },
  //     required: ['file'],
  //   },
  // })
  // @UseInterceptors(
  //   FileInterceptor('file', {
  //     storage: multer.memoryStorage(),
  //     limits: { fileSize: 100 * 1024 * 1024 },
  //   }),
  // )
  // @ApiOkResponse({
  //   description: 'Devuelve columnas, total de filas, muestra normalizada y muestra de errores.',
  // })
  // @ApiBadRequestResponse({ description: 'Archivo faltante o inválido.' })
  // async dryRunReceiptsCsvNormalized(
  //   @UploadedFile() file: Express.Multer.File,
  // ) {
  //   if (!file) throw new BadRequestException('Falta el archivo CSV (campo "file").');
  //   const HEADER_ROW_FIXED = 0;
  //   return this.csv.inspectCsvNormalized(file.buffer, { headerRow: HEADER_ROW_FIXED, tz: 'America/Hermosillo' });
  // }


  @Post('inventory/receivedinventory/receipts/import-csv')
  @ApiOperation({
    summary: 'Import real de CSV de recibos de inventario',
    description:
      'Lee el CSV (encabezados en fila 4), normaliza, resuelve store_id/received_inventory_id a partir de Location y ' +
      'hace insert por lotes en stores_received_inventory_receipts.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  @ApiOkResponse({ description: 'Resumen de importación (inserted, failed, errores).' })
  async importReceiptsCsv(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Falta el archivo CSV (campo "file").');

    const HEADER_ROW_FIXED = 0;

    const all = await this.csv.parseAllNormalized(file.buffer, { headerRow: HEADER_ROW_FIXED });

    return this.importer.importNormalized(all);
  }


  @Post('inventory/receivedinventory/receipts/update-one')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Actualiza un recibo individual (hash + flags + promoción RI).' })
  @ApiOkResponse({
    description: 'Resultado del update manual',
    schema: {
      example: {
        ok: true,
        action: 'updated', // 'promoted' | 'unchanged'
        id: 1,
        prev_hash: 'abc...',
        new_hash: 'def...',
      },
    },
  })
  @ApiBody({ type: UpdateOneReceiptDto })
  @ApiBadRequestResponse({ description: 'Body inválido' })
  async updateOne(@Body() body: UpdateOneReceiptDto | UpdateOneReceiptDto[]) {
    // Soporta tu JSON tipo array con un elemento
    const payload = Array.isArray(body) ? body[0] : body;
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Body inválido');
    }
    if (!('id' in payload)) {
      throw new BadRequestException('Se requiere "id" del registro a actualizar.');
    }
    return this.importer.updateOneManual(payload);
  }


  @Post('sync/reporting/customers')
  @ApiOperation({
    summary: 'Sync de clientes por días',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día consulta /dutchie/reporting/customers ' +
      'y guarda el resultado día por día en /supabase/reporting/customers ',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una día (fail-fast).',
  })
  syncReportingCustomers(@Body() dto: SyncDto) {
    return this.importer2.syncReportingCustomers(dto);
  }



  @Post('sync/inventory/snapshot')
  @ApiOperation({
    summary: 'Sync de snapshot de inventario por tienda',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día consulta /dutchie/inventory/snapshot ' +
      'y guarda el resultado día por día en /supabase/inventory/snapshot ',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una día (fail-fast).',
  })
  syncInventorySnapshot(@Body() dto: SyncDto) {
    return this.importer3.syncInventorySnapshot(dto);
  }

  @Post('sync/inventory/inventorytransaction')
  @ApiOperation({
    summary: 'Sync de inventario de transacciones por tienda',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día consulta /dutchie/inventory/inventorytransaction ' +
      'y guarda el resultado día por día en /supabase/inventory/inventorytransaction ',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una día (fail-fast).',
  })
  syncInventoryTransaction(@Body() dto: SyncDto) {
    return this.importer4.syncInventoryTransaction(dto);
  }

  @Post('sync/homebase/timecards')
  @ApiOperation({
    summary: 'Sync de homebase timecards por tienda',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día consulta /homebase/timecards/all ' +
      'y guarda el resultado día por día en /supabase/homebase/timecards ',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una día (fail-fast).',
  })
  syncHomebaseTimecards(@Body() dto: SyncDto) {
    return this.importer5.syncHomebaseTimecards(dto);
  }


  @Post('sync/homebase/shifts')
  @ApiOperation({
    summary: 'Sync de homebase shifts por tienda',
    description:
      'Recibe un rango de fechas UTC y lo parte en días completos [from, to). ' +
      'Por cada día consulta /homebase/shifts/all ' +
      'y guarda el resultado día por día en /supabase/homebase/shifts ',
  })
  @ApiBody({
    type: SyncDto,
    examples: {
      singleDay: {
        summary: 'Ejemplo de un solo día',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-02' },
      },
      multiDay: {
        summary: 'Ejemplo de varios días consecutivos',
        value: { from_utc: '2025-10-01', to_utc: '2025-10-04' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OK si todos los días se procesaron sin error. ' +
      'El servicio corta en el primer error (fail-fast) y devuelve 4xx/5xx.',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación o fallo en una día (fail-fast).',
  })
  syncHomebaseShifts(@Body() dto: SyncDto) {
    return this.importer6.syncHomebaseShifts(dto);
  }

  @Post('sync/dutchie/employees')
  @ApiOperation({
    summary: 'Sync de los empleados de dutchie',
    description:

      'Consulta /dutchie/employees/all ' +
      'y guarda el resultado día por día en /supabase/employees ',
  })

  @ApiOkResponse({
    description:
      'OK si todos los empleados se registraron ',
  })
  @ApiBadRequestResponse({
    description: 'Error de validación',
  })
  syncDutchieEmployees() {
    return this.importer7.syncDutchieEmployees();
  }

  @Post('run-sync-job')
  @ApiOperation({
    summary: 'Ejecuta el job secuencial de sync wg-pos (transactions/products/receivedinventory/customers/inventorytransaction/homebase).',
    description:
      'Rangos: default from=now-8d to=now+1d; receivedinventory from=now-60d to=now+1d. Reintentos y timeout por step configurables.',
  })
  @ApiBody({ type: RunWgPosSyncJobDto })
  @ApiResponse({ status: 200, type: RunWgPosSyncJobResponseDto })
  async run(@Body() dto: RunWgPosSyncJobDto): Promise<RunWgPosSyncJobResponseDto> {
    return await this.job.runJob(dto); 
  }

  @Post('backup/dutchie-received-inventory-invoices')
  async runBackup(
    @Query('limit') limit?: string,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.backupService.runBackup({
      limit: limit ? Number(limit) : undefined,
      dryRun: dryRun === 'true',
    });
  }

  @Post('price-compare/import-csv')
  @ApiOperation({
    summary: 'Importa CSVs de Pistil desde Google Drive, upsert a Supabase y devuelve ZIP',
    description:
      'Lee archivos pistil_YYYY-MM.csv del folder de Drive. ' +
      'Solo procesa meses que aún no existen en pistil_prices. ' +
      'Retorna ZIP con los CSVs procesados o JSON si no hay archivos nuevos.',
  })
  @ApiOkResponse({ description: 'ZIP con CSVs procesados, o JSON si no hay archivos nuevos.' })
  async importPriceCompareCsv(@Res() res: Response) {
    const pendingCsvs = await this.pistilDrive.fetchPendingCsvs();

    if (pendingCsvs.length === 0) {
      return res.json({ message: 'No hay archivos nuevos por procesar', processed: 0 });
    }

    const allResults: import('../dtos/price-compare.dto').PriceCompareResult[] = [];
    const allDiagnostics: import('../dtos/price-compare.dto').PriceCompareImportDiagnostics[] = [];
    let totalStores = 0;
    let totalProducts = 0;
    let totalPrices = 0;
    let totalElapsedMs = 0;

    for (const csv of pendingCsvs) {
      const result = await this.priceCompareCsv.parsePriceCompareCsv(csv.buffer, { reportMonth: csv.reportMonth });
      const upsertResult = await this.pistilImport.importPriceCompare(result);

      allResults.push(result);
      allDiagnostics.push(upsertResult.diagnostics);
      totalStores += upsertResult.stores;
      totalProducts += upsertResult.products;
      totalPrices += upsertResult.prices;
      totalElapsedMs += upsertResult.elapsedMs;
    }

    // Combinar resultados para el ZIP
    const combinedProducts = allResults.flatMap((r) => r.products);
    const combinedPrices = allResults.flatMap((r) => r.prices);
    const combined: import('../dtos/price-compare.dto').PriceCompareResult = {
      report_month: allResults.map((r) => r.report_month).join(','),
      stores: allResults[0].stores,
      products: combinedProducts,
      prices: combinedPrices,
      summary: {
        total_stores: allResults[0].stores.length,
        total_products: combinedProducts.length,
        total_price_entries: combinedPrices.length,
      },
    };

    const combinedDiagnostics: import('../dtos/price-compare.dto').PriceCompareImportDiagnostics = {
      skipped_prices: allDiagnostics.flatMap((d) => d.skipped_prices),
      duplicate_prices: allDiagnostics.flatMap((d) => d.duplicate_prices),
    };

    const zipBuffer = await this.priceCompareCsv.buildZip(combined, combinedDiagnostics);

    const filename = `price_compare_${combined.report_month}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': zipBuffer.length,
      'X-Upsert-Stores': String(totalStores),
      'X-Upsert-Products': String(totalProducts),
      'X-Upsert-Prices': String(totalPrices),
      'X-Upsert-ElapsedMs': String(totalElapsedMs),
      'X-Processed-Months': pendingCsvs.map((c) => c.reportMonth).join(','),
    });
    res.send(zipBuffer);
  }

}
