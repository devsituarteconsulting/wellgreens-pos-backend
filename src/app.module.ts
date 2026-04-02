import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';   // si tienes el guard
import { QboModule } from './modules/qbo/qbo.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { DutchieModule } from './modules/dutchie/dutchie.module';
import { WgPosModule } from './modules/wg-pos/wg-pos.module';
import { HomebaseModule } from './modules/homebase/homebase.module';
import { PistilImportsModule } from './modules/pistil/pistil-imports.module';


@Module({
  imports: [HealthModule, AuthModule, QboModule, SupabaseModule, DutchieModule, HomebaseModule, WgPosModule, PistilImportsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
