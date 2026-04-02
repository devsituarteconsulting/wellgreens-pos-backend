// src/modules/dutchie/dutchie.controller.ts
import {
  Body, Controller, HttpCode, HttpStatus, Post,
  UsePipes, ValidationPipe, Query, ParseIntPipe,
  Get,
  Inject,
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags, ApiQuery,
  ApiBody, getSchemaPath, ApiExtraModels,
} from '@nestjs/swagger';

import { ClosingReportDto } from './dtos/closing-report.dto';
import { ClosingReportService } from './services/closing-report.service';
import { ReceivedInventoryDto } from './dtos/received-inventory.dto';
import { TransactionsImportService } from './services/transactions.service';
import { TransactionDto } from './dtos/transaction.dto';
import { ReceivedInventoryService } from './services/received-inventory.service';
import { ProductsImportService } from './services/products.service';
import { ProductDto } from './dtos/products.dto';
import { CustomerDto } from './dtos/customer.dto';
import { ReportingCustomersService } from './services/reporting-customers.service';
import { InventorySnapshotsService } from './services/inventory-snapshots.service';
import { InventorySnapshotDto } from './dtos/inventory-snapshot.dto';
import { InventoryTransactionDto } from './dtos/inventory-transaction.dto';
import { InventoryTransactionsService } from './services/inventory-transactions.service';
import { HomebaseTimecardDto } from './dtos/timecard.dto';
import { HomebaseTimecardsImportService } from './services/homebase-timecards.service';
import { HomebaseShiftsImportService } from './services/homebase-shifts.service';
import { HomebaseShiftDto } from './dtos/shifts.dto';
import { ReportingEmployeesService } from './services/employees.service';
import { EmployeeDto } from './dtos/employee.dto';
import { HomebaseEmployeeDto } from './dtos/homebase_employee.dto';
import { HomebaseEmployeesImportService } from './services/homebase-employees-import.service';

class ClosingReportResponse {
  ok: boolean;
  closing_report_id: number;
}

class ImportResultDto {
  ok: boolean;
  processed: number;
  elapsedMs?: number;
}

@ApiTags('supabase')
@ApiExtraModels(TransactionDto) // <- para poder referenciar el DTO en ApiBody
@Controller('supabase')
export class SupabaseController {
  constructor(
    private readonly svc: ClosingReportService,
    private readonly svc2: ReceivedInventoryService,
    private readonly txSvc: TransactionsImportService,
    private readonly txSvc2: ProductsImportService,
    private readonly txSvc3: ReportingCustomersService,
    private readonly txSvc4: InventorySnapshotsService,
    private readonly txSvc5: InventoryTransactionsService,
    private readonly txSvc6: HomebaseTimecardsImportService,
    private readonly txSvc7: HomebaseShiftsImportService,
    private readonly txSvc8: ReportingEmployeesService,
    private readonly txSvc9: HomebaseEmployeesImportService,
  ) { }

  @Post('closing-report')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa y guarda el Closing Report (upsert + colecciones)' })
  @ApiOkResponse({ description: 'Closing report importado', type: ClosingReportResponse })
  @ApiBadRequestResponse({ description: 'Payload inválido o storeId no mapeado' })
  async importClosingReport(@Body() dto: ClosingReportDto): Promise<ClosingReportResponse> {
    const res = await this.svc.import(dto);
    return { ok: true, ...res };
  }

  // @Post('/inventory/receivedinventory')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Importa Inventario Recibido (upsert header + items)' })
  // @ApiOkResponse({ description: 'Importación realizada' })
  // @ApiBadRequestResponse({ description: 'Payload inválido' })
  // @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  // async import(@Body() dto: ReceivedInventoryDto) {
  //   const res = await this.svc2.import(dto);
  //   return { ok: true, ...res };
  // }

  @Post('/inventory/receivedinventory')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa Inventario Recibido (upsert header + items)' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(ReceivedInventoryDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importReceivedInventory(
    @Body() receivedInventory: ReceivedInventoryDto[],
    @Query('storeId', ParseIntPipe) storeId: string,
  ): Promise<ImportResultDto> {
    const res = await this.svc2.importMany(receivedInventory, storeId);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('reporting/transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa/actualiza transacciones + hijos' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(TransactionDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importTransactions(
    @Body() transactions: TransactionDto[],
    @Query('storeId', ParseIntPipe) storeId: string,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc.importMany(transactions, storeId);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('reporting/products')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa/actualiza products + hijos' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(ProductDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importProducts(
    @Body() products: ProductDto[],
    @Query('storeId', ParseIntPipe) storeId: string,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc2.importMany(products, storeId);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('/reporting/customers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa los clientes' })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(CustomerDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importReportingCustomers(
    @Body() reportingCustomers: CustomerDto[],
  ): Promise<ImportResultDto> {
    const res = await this.txSvc3.importMany(reportingCustomers);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('/employees')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa los empleados' })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(EmployeeDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importEmployees(
    @Body() reportingCustomers: EmployeeDto[],
  ): Promise<ImportResultDto> {
    const res =
      await this.txSvc8.importMany(reportingCustomers);
    await this.txSvc8.importManyRaw(reportingCustomers);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('/inventory/snapshots')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa los snapshots de inventario de las tiendas' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(InventorySnapshotDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importInventorySnapshot(
    @Body() snapshots: InventorySnapshotDto[],
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc4.importMany(storeId, snapshots);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('/inventory/inventorytransaction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa el inventario de las transacciones de las tiendas' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(InventoryTransactionDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importInventoryTransaction(
    @Body() snapshots: InventoryTransactionDto[],
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc5.importMany(storeId, snapshots);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('/homebase/timecards')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa los timecards de las tiendas' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(HomebaseTimecardDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importHomebaseTimecards(
    @Body() snapshots: HomebaseTimecardDto[],
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc6.importMany(storeId, snapshots);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

  @Post('/homebase/shifts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa los shifts de las tiendas' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(HomebaseShiftDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importHomebaseshifts(
    @Body() snapshots: HomebaseShiftDto[],
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc7.importMany(storeId, snapshots);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }


  @Post('/homebase/employees')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa los employees de las tiendas' })
  @ApiQuery({ name: 'storeId', type: String, required: true })
  @ApiBody({
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(HomebaseEmployeeDto) },
    },
  })
  @ApiOkResponse({ description: 'Resultado del import', type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importHomebaseEmployees(
    @Body() snapshots: HomebaseEmployeeDto[],
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<ImportResultDto> {
    const res = await this.txSvc9.importMany(storeId, snapshots);
    return { ok: true, processed: res.processed, elapsedMs: res.elapsedMs };
  }

}
