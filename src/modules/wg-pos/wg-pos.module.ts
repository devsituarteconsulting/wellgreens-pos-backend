// src/modules/wg-pos/wg-pos.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

// Reusamos los módulos/servicios del paquete dutchie
import { DutchieModule } from '../dutchie/dutchie.module';
import { StoreConfigService } from '../dutchie/services/store-config.service';
import { DutchieService } from '../dutchie/services/dutchie.service';
import { WgPosController } from './controllers/wg-pos.controller';
import { SyncReportingTransactionsService } from './services/sync-reporting-transactions.service';
import { SyncReceivedInventoryService } from './services/sync-received-inventory.service';
import { ReceiptsCsvService } from './services/receipts-csv.service';
import { ReceiptsResolveService } from './services/receipts-resolve.service';
import { SupabaseProviderModule } from 'src/common/supabase/supabase.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { ReceiptsImportService } from './services/receipts-import.service';
import { SyncReportingProductsService } from './services/sync-reporting-products.service';
import { SyncReportingCustomersService } from './services/sync-reporting-customers.service';
import { SyncInventorySnapshotService } from './services/sync-inventory-snapshot.service';
import { SyncInventoryTransactionsService } from './services/sync-inventory-transactions.service';
import { SyncHomebaseTimecardsService } from './services/sync-homebase-timecards.service';
import { HomebaseModule } from '../homebase/homebase.module';
import { SyncHomebaseShiftsService } from './services/sync-homebase-shifts.service';
import { WgPosSyncJobService } from './services/wg-pos-sync-job.service';
import { SyncDutchieEmployeesService } from './services/sync-dutchie-employees.service';
import { ReceivedInventoryBackupService } from './services/backup-received-inventory.service';
import { PriceCompareCsvService } from './services/price-compare-csv.service';
import { PistilDriveService } from './services/pistil-drive.service';

@Module({
  imports: [
    HttpModule,       // para hacer el POST interno a /supabase/reporting/transactions
    DutchieModule,    // trae DutchieService y StoreConfigService
    HomebaseModule,
    SupabaseProviderModule,
    SupabaseModule,
  ],
  controllers: [WgPosController],
  providers: [
    SyncReportingTransactionsService,
    SyncReportingProductsService,
    SyncReceivedInventoryService,
    DutchieService,
    StoreConfigService,
    ReceiptsCsvService,
    ReceiptsResolveService,
    ReceiptsImportService,
    SyncReportingCustomersService,
    SyncInventorySnapshotService,
    SyncInventoryTransactionsService,
    SyncHomebaseTimecardsService,
    SyncHomebaseShiftsService,
    SyncDutchieEmployeesService,
    WgPosSyncJobService,
    ReceivedInventoryBackupService,
    PriceCompareCsvService,
    PistilDriveService,
  ],
})
export class WgPosModule { }
