import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DutchieService } from '../../dutchie/services/dutchie.service';
import { StoreConfigService, DutchieStore } from '../../dutchie/services/store-config.service';
import { SyncDto } from '../dtos/sync.dto';


@Injectable()
export class SyncDutchieEmployeesService {
  private readonly logger = new Logger(SyncDutchieEmployeesService.name);
  private readonly internalOrigin = process.env.INTERNAL_API_ORIGIN || 'http://localhost:8080';

  constructor(
    private readonly http: HttpService,
    private readonly dutchie: DutchieService,
    private readonly stores: StoreConfigService,
  ) { }

  /**
   * Preferimos un método público en StoreConfigService:
   *   listActiveStores(): DutchieStore[]
   * Si aún no existe, caemos a leer el mapa interno (temporalmente).
   */
  private getActiveStores(): DutchieStore[] {
    // @ts-ignore – si existe el método público, úsalo
    if (typeof (this.stores as any).listActiveStores === 'function') {
      // @ts-ignore
      return (this.stores as any).listActiveStores();
    }
    const out: DutchieStore[] = [];
    // ⚠️ acceso interno temporal (recomendado exponer listActiveStores en StoreConfigService)
    // @ts-ignore
    const map = (this.stores as any).byInternal as Map<string, DutchieStore>;
    map?.forEach?.((s) => { if (s?.is_active) out.push(s); });
    return [out[0], out[10]];
  }

  /**
   * Procesa los empleados de dutchie.
   * Fail-fast: si falla una tienda en un día, aborta y lanza error con detalle.
   */
  async syncDutchieEmployees() {
    const active = this.getActiveStores();
    const totalStores = active.length;

    this.logger.log(
      `Iniciando sync de los empleados de dutchie, Tiendas activas=${totalStores}`,
    );



    this.logger.log(`Inciando ==================`);
    this.logger.log(`....`);

    // 3) Iterar tiendas para el día
    for (let si = 0; si < totalStores; si++) {
      const s = active[si];
      const storeIdx = si + 1;
      const remaining = totalStores - storeIdx;

      this.logger.log(
        `[${storeIdx}/${totalStores}] tienda=${s.name} (#${s.id}, dutchie=${s.dutchie_store_id}) | faltan=${remaining}`,
      );

      try {
        // 3.1) Consulta a Dutchie para el día completo (por fecha de modificacion del empleados)
        const query = {

        };

        const payload = await this.dutchie.getForResolved<any>(
          String(s.id),
          '/employees',
          query,
        );

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
            `${this.internalOrigin}/supabase/employees`,
            txs,
          ),
        );

        this.logger.log(`[OK] tienda=${s.name} → reenviadas ${fetchedCount} empleados`);
      } catch (error: any) {
        const errPayload = error?.response?.data ?? error?.message ?? error;
        const errText = typeof errPayload === 'string' ? errPayload : JSON.stringify(errPayload);

        // Log y corte inmediato (fail-fast)
        this.logger.error(`[FAIL-FAST] tienda=${s.name} → ${errText}`);
        this.logger.log(`....`);
        this.logger.log(`Terminado con ERROR ============`);

        // Lanza error con detalle de día y tienda
        throw new Error(`Falló el proceso sync, tienda "${s.name}" (id=${s.id}). Detalle: ${errText}`);
      }
    }

    // Log fin de día
    this.logger.log(`....`);
    this.logger.log(`Terminado ============`);


    this.logger.log(`Sync de empleados finalizado SIN errores.`);
    return {
      ok: true,
      finished_at: new Date().toISOString(),
    };
  }
}
