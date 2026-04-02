import { Module } from '@nestjs/common';
import { SupabaseProviderModule } from '../../common/supabase/supabase.module';
import { SupabaseController } from './supabase.controller';
import { ClosingReportService } from './services/closing-report.service';
import { ReceivedInventoryService } from './services/received-inventory.service';
import { TransactionsImportService } from './services/transactions.service';
import { ProductsImportService } from './services/products.service';
import { ReportingCustomersService } from './services/reporting-customers.service';
import { InventorySnapshotsService } from './services/inventory-snapshots.service';
import { InventoryTransactionsService } from './services/inventory-transactions.service';
import { HomebaseTimecardsImportService } from './services/homebase-timecards.service';
import { HomebaseShiftsImportService } from './services/homebase-shifts.service';
import { ReportingEmployeesService } from './services/employees.service';
import { HomebaseEmployeesImportService } from './services/homebase-employees-import.service';
import { PistilImportService } from './services/pistil-import.service';

@Module({
  imports: [SupabaseProviderModule],
  controllers: [SupabaseController],
  providers: [
    ClosingReportService,
    ReceivedInventoryService,
    TransactionsImportService,
    ProductsImportService,
    ReportingCustomersService,
    InventorySnapshotsService,
    InventoryTransactionsService,
    HomebaseTimecardsImportService,
    HomebaseShiftsImportService,
    ReportingEmployeesService,
    HomebaseEmployeesImportService,
    PistilImportService,
  ],
  exports: [
    ClosingReportService,
    ReceivedInventoryService,
    TransactionsImportService,
    ProductsImportService,
    ReportingCustomersService,
    InventorySnapshotsService,
    InventoryTransactionsService,
    HomebaseTimecardsImportService,
    HomebaseShiftsImportService,
    ReportingEmployeesService,
    HomebaseEmployeesImportService,
    PistilImportService,
  ],
})
export class SupabaseModule { }
