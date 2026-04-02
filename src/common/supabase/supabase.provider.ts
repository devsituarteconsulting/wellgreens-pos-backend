import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Provider } from '@nestjs/common';

export const SUPABASE = Symbol('SUPABASE_CLIENT');

export const SupabaseProvider: Provider = {
  provide: SUPABASE,
  useFactory: (): SupabaseClient => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    return createClient(url, key, { auth: { persistSession: false } });
  },
};
