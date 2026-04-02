import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { StoreConfigService, DutchieStore } from '../../dutchie/services/store-config.service';
import { SyncDto } from '../dtos/sync.dto';
import { HomebaseService } from 'src/modules/homebase/services/homebase.service';
import { HomebaseStore } from 'src/modules/homebase/services/store-config.service';

// ===== Helpers de fechas (UTC) =====
function toStartOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}
function addDays(d: Date, days: number): Date {
  const nd = new Date(d.getTime());
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}
function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
/**
 * Construye ventanas diarias [from, to) exclusivas.
 * Si to <= from, procesa solo el día de 'from'.
 */
function buildDayWindows(fromStr: string, toStr: string): Array<{ from: string; to: string; dayKey: string }> {
  const from = toStartOfDayUTC(new Date(fromStr));
  const to = toStartOfDayUTC(new Date(toStr)); // exclusivo (inicio del día siguiente)
  const out: Array<{ from: string; to: string; dayKey: string }> = [];

  if (!(to > from)) {
    const next = addDays(from, 1);
    out.push({ from: isoNoMs(from), to: isoNoMs(next), dayKey: isoNoMs(from).slice(0, 10) });
    return out;
  }

  let cur = new Date(from.getTime());
  while (cur < to) {
    const next = addDays(cur, 1);
    out.push({ from: isoNoMs(cur), to: isoNoMs(next), dayKey: isoNoMs(cur).slice(0, 10) }); // YYYY-MM-DD
    cur = next;
  }
  return out;
}

@Injectable()
export class SyncHomebaseTimecardsService {
  private readonly logger = new Logger(SyncHomebaseTimecardsService.name);
  private readonly internalOrigin = process.env.INTERNAL_API_ORIGIN || 'http://localhost:8080';

  constructor(
    private readonly http: HttpService,
    private readonly homebase: HomebaseService,
    private readonly stores: StoreConfigService,
  ) { }

  /**
   * Preferimos un método público en StoreConfigService:
   *   listActiveStores(): DutchieStore[]
   * Si aún no existe, caemos a leer el mapa interno (temporalmente).
   */
  private getActiveStores(): HomebaseStore[] {
    // @ts-ignore – si existe el método público, úsalo
    if (typeof (this.stores as any).listActiveStores === 'function') {
      // @ts-ignore
      return (this.stores as any).listActiveStores();
    }
    const out: HomebaseStore[] = [];
    // ⚠️ acceso interno temporal (recomendado exponer listActiveStores en StoreConfigService)
    // @ts-ignore
    const map = (this.stores as any).byInternal as Map<string, HomebaseStore>;
    map?.forEach?.((s) => { if (s?.is_active) out.push(s); });
    return out;
  }

  /**
   * Procesa los timecards por días completos.
   * Fail-fast: si falla una tienda en un día, aborta y lanza error con detalle.
   */
  async syncHomebaseTimecards({ from_utc, to_utc }: SyncDto) {
    // 1) Partir el rango en días completos
    const days = buildDayWindows(from_utc, to_utc);
    const active = this.getActiveStores();
    const totalStores = active.length;

    this.logger.log(
      `Iniciando sync de timecards por días (fail-fast). Días=${days.length}, Tiendas activas=${totalStores}. Rango: ${from_utc} → ${to_utc}`,
    );

    // 2) Iterar día por día
    for (const day of days) {
      const { from, to, dayKey } = day;

      // Logs diarios solicitados
      this.logger.log(`Inciando ${dayKey}==================`);
      this.logger.log(`....`);

      // 3) Iterar tiendas para el día
      for (let si = 0; si < totalStores; si++) {
        const s = active[si];
        const storeIdx = si + 1;
        const remaining = totalStores - storeIdx;

        this.logger.log(
          `[${dayKey}] [${storeIdx}/${totalStores}] tienda=${s.name} | faltan=${remaining}`,
        );

        try {
          // 3.1) Consulta a Dutchie para el día completo (por fecha de modificacion del timecards)
          const query = {
            store_id: String(s.id),
            start_date: from,
            end_date: to,
          };
          
          const payload = await this.homebase.getForResolved<any>(s.id, `/locations/${s.home_base_location_uuid}/timecards?page=1&per_page=1000&date_filter=clock_in`, query);

          // 3.2) Normaliza body: debe ser un array
          const txs: any[] = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.data)
              ? payload.data
              : [];

          const fetchedCount = txs.length;

          // 3.3) Guarda por día/tienda en tu endpoint interno
          await firstValueFrom(
            this.http.post(
              `${this.internalOrigin}/supabase/homebase/timecards`,
              txs,
              { params: { storeId: String(s.id) } },
            ),
          );

          this.logger.log(`[OK][${dayKey}] tienda=${s.name} → reenviadas ${fetchedCount} timecards`);
        } catch (error: any) {
          const errPayload = error?.response?.data ?? error?.message ?? error;
          const errText = typeof errPayload === 'string' ? errPayload : JSON.stringify(errPayload);

          // Log y corte inmediato (fail-fast)
          this.logger.error(`[FAIL-FAST][${dayKey}] tienda=${s.name} → ${errText}`);
          this.logger.log(`....`);
          this.logger.log(`${dayKey} Terminado con ERROR ============`);

          // Lanza error con detalle de día y tienda
          throw new Error(`Falló el proceso en el día ${dayKey}, tienda "${s.name}" (id=${s.id}). Detalle: ${errText}`);
        }
      }

      // Log fin de día
      this.logger.log(`....`);
      this.logger.log(`${dayKey} Terminado ============`);
    }

    this.logger.log(`Sync por días finalizado SIN errores.`);
    return {
      ok: true,
      days_processed: days.length,
      finished_at: new Date().toISOString(),
    };
  }
}
