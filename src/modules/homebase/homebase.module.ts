import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { HomebaseService } from './services/homebase.service';
import { StoreConfigService } from './services/store-config.service';
import { HomebaseTimecardsController } from './controllers/timecards.controller';
import { HomebaseShiftsController } from './controllers/shifts.controller';


@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HttpModule],
  controllers: [
    HomebaseTimecardsController,
    HomebaseShiftsController,
  ],
  providers: [HomebaseService, StoreConfigService],
  exports: [HomebaseService],
})
export class HomebaseModule {}


