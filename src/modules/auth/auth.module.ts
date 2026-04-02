import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './guards/supabase.guard';

@Module({
  providers: [SupabaseAuthGuard],
  exports: [SupabaseAuthGuard],
})
export class AuthModule {}
