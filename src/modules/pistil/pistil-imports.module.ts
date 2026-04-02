import { Module } from '@nestjs/common';
import { PistilImportsController } from './controllers/pistil-imports.controller';
import { PistilStoresImportService } from './services/pistil-stores-import.service';
import { SupabaseProviderModule } from 'src/common/supabase/supabase.module';


@Module({
  imports: [SupabaseProviderModule],
  controllers: [
    PistilImportsController
  ],
  providers: [PistilStoresImportService],
})
export class PistilImportsModule { }
