import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DutchieReportingController } from './controllers/dutchie-reporting.controller';
import { DutchieInventoryController } from './controllers/dutchie-inventory.controller';
import { DutchieCatalogController } from './controllers/dutchie-catalog.controller';
import { DutchieService } from './services/dutchie.service';
import { StoreConfigService } from './services/store-config.service';
import { DutchieProductsController } from './controllers/dutchie-products.controller';
import { DutchieEmployeesController } from './controllers/dutchie-employees.controller';


@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HttpModule],
  controllers: [
    DutchieReportingController,
    DutchieInventoryController,
    DutchieProductsController,
    DutchieEmployeesController,
  ],
  providers: [DutchieService, StoreConfigService],
  exports: [DutchieService],
})
export class DutchieModule {}
