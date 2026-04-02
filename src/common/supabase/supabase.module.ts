import { Module } from '@nestjs/common';
import { SupabaseProvider } from './supabase.provider';

@Module({
  providers: [SupabaseProvider],
  exports: [SupabaseProvider],
})
export class SupabaseProviderModule {}
