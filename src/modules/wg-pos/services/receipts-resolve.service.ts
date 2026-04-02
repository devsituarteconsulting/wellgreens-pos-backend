// src/modules/wg-pos/services/receipts-resolve.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from 'src/common/supabase/supabase.provider';

type Row = Record<string, any>;

// src/modules/wg-pos/services/receipts-resolve.service.ts

@Injectable()
export class ReceiptsResolveService {
  constructor(@Inject(SUPABASE) private readonly supabase: SupabaseClient) { }

  private readonly storeAliases: Record<string, string> = {
    'Wellgreens - Balboa': 'Wellgreens - Kearny Mesa',
    'Wellgreens - Home': 'Wellgreens - City Heights',
  };

  private aliasStoreName(name: string): string {
    const trimmed = (name ?? '').trim();
    return this.storeAliases[trimmed] ?? trimmed;
  }

  private normalizeStoreName(name: string): string {
    return (name ?? '').trim().toLowerCase();
  }

  private extractMetric(title: string): string | null {
    // ej: "10/01/2025 - VINO & CIGARRO, LLC - 0009598867"
    const m = title.match(/^\s*\d{2}\/\d{2}\/\d{4}\s*-\s*.+?\s*-\s*(\d+)\s*$/);
    return m ? m[1].trim() : null;
  }

  async resolveAll(rows: Record<string, any>[]) {
    const errors: Array<{ line: number; error: string }> = [];
    const out: Record<string, any>[] = [];

    // cache de stores
    // const { data: stores, error: errStores } = await this.supabase
    //   .from('stores')
    //   .select('id, name');
    // if (errStores) throw new Error(`Error obteniendo stores: ${errStores.message}`);

    // const storeMap = new Map<string, number>();
    // for (const s of stores ?? []) storeMap.set(this.normalizeStoreName(s.name), s.id);

    for (let i = 0; i < rows.length; i++) {
      const src = rows[i];
      const dst: Record<string, any> = { ...src };
      const line = i;

      // aplicar alias antes del lookup
      // const storeNameInput = String(src['Store'] ?? '');
      // const storeNameAliased = this.aliasStoreName(storeNameInput);
      // const store_id = storeMap.get(this.normalizeStoreName(storeNameAliased));

      // if (!store_id) {
      //   errors.push({ line, error: `Store no encontrada: "${storeNameInput}"` });
      //   dst['store_id'] = null;
      // } else {
      //   dst['store_id'] = store_id;
      // }

      // received_inventory_id (igual que ya lo tenías)
      dst['received_inventory_id'] = null;
      const title = src['Title'];
      const metric = this.extractMetric(title ?? '');

      const storeId = Number(src['Store ID']);
      if (!Number.isFinite(storeId) || storeId <= 0) {
        errors.push({ line, error: `Store ID inválido o faltante para Location="${src['Location']}"` });
        out.push(dst);
        continue;
      }

      if (metric) {
        const { data: inventories, error: errInv } = await this.supabase
          .from('stores_received_inventory')
          .select('received_inventory_id, title')
          .eq('store_id', storeId)
          .ilike('title', `%${metric}%`);

        if (errInv) {
          errors.push({ line, error: `Error Supabase al buscar Title="${title}": ${errInv.message}` });
        } else if ((inventories?.length ?? 0) === 1) {
          dst['received_inventory_id'] = inventories![0].received_inventory_id;
        } else if ((inventories?.length ?? 0) > 1) {
          dst['received_inventory_id'] = -1; // ambiguo
          // errors.push({ line, error: `received_inventory_id ambiguo para Title="${title}"` });
        } else {
          errors.push({ line, error: `received_inventory_id no encontrado para Title="${title}"` });
        }

      } else if (title) {
        errors.push({ line, error: `Title malformado: ${title}` });
      }


      out.push(dst);
    }

    return { resolved: out, errors };
  }
}
