// src/modules/customers/services/customers.service.ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { CustomerDto } from '../dtos/customer.dto';

// ------- helpers de logging -------
function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h ${m}m ${ss}s`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function logStep(logger: Logger, label: string, done: number, total: number, t0?: number) {
  const left = total - done;
  const base = `[customers] ${label} ${done}/${total} (faltan ${left})`;
  if (t0) {
    const ms = Date.now() - t0;
    logger.log(`${base} • ${fmtMs(ms)}`);
  } else {
    logger.log(base);
  }
}

@Injectable()
export class ReportingCustomersService {
  private readonly logger = new Logger(ReportingCustomersService.name);
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  // Tamaños de lote (ajustados)
  private readonly UPSERT_CHUNK = 2000;

  // Límites para adaptación
  private readonly MIN_CHUNK = 100;
  private readonly MAX_RETRIES = 4;
  private readonly INTER_BATCH_SLEEP_MS = 25;

  private async sleep(ms: number) {
    await new Promise((res) => setTimeout(res, ms));
  }

  private isStatementTimeout(e: any): boolean {
    const code = e?.code || e?.details?.code || e?.error?.code;
    const msg = e?.message || e?.error?.message;
    return code === '57014' || /statement timeout/i.test(msg ?? '');
  }

  /**
   * Ejecuta una operación sobre un batch con reintentos y división de chunk
   * si aparece 57014 (statement timeout).
   */
  private async execWithAdaptiveRetry<T>(
    label: string,
    initialChunkSize: number,
    rows: T[],
    runner: (batch: T[]) => Promise<void>,
  ): Promise<void> {
    let chunkSize = initialChunkSize;
    let offset = 0;

    while (offset < rows.length) {
      const end = Math.min(offset + chunkSize, rows.length);
      const slice = rows.slice(offset, end);

      let attempt = 0;
      while (true) {
        try {
          await runner(slice);
          break; // batch OK
        } catch (e: any) {
          if (this.isStatementTimeout(e) && chunkSize > this.MIN_CHUNK && attempt < this.MAX_RETRIES) {
            const prev = chunkSize;
            chunkSize = Math.max(this.MIN_CHUNK, Math.floor(chunkSize / 2));
            this.logger.warn(
              `[ADAPT] ${label}: timeout, bajo chunk ${prev} -> ${chunkSize} (retry ${attempt + 1})`,
            );
            attempt++;
            continue;
          }
          // otro error o ya no podemos reducir más
          throw e;
        }
      }

      offset = end;
      if (this.INTER_BATCH_SLEEP_MS) {
        await this.sleep(this.INTER_BATCH_SLEEP_MS);
      }
    }
  }

  /**
   * Importa / upsertea un array de customers en la tabla SQL `customers`.
   * Usa como conflicto la PK compuesta (customer_id, unique_id).
   */
  async importMany(payloads: CustomerDto[]) {
    if (!Array.isArray(payloads)) {
      throw new BadRequestException('CustomerDto[] requerido');
    }

    const total = payloads.length;
    if (!total) {
      this.logger.log('[customers] No hay customers que procesar.');
      return { ok: true, processed: 0 };
    }

    const t0 = Date.now();
    this.logger.log(`[customers] Importando lote: ${total} customers`);

    const rows: any[] = [];
    const tBuild = Date.now();

    for (let i = 0; i < total; i++) {
      const p = payloads[i];

      // Validaciones básicas de PK
      if (!Number.isFinite(p.customerId as any)) {
        throw new BadRequestException(`customerId inválido: ${p?.customerId}`);
      }
      if (!p.uniqueId) {
        throw new BadRequestException(`uniqueId requerido para customerId=${p?.customerId}`);
      }

      rows.push({
        // PK
        customer_id: p.customerId,
        unique_id: p.uniqueId,

        // Identidad / nombres
        name: p.name ?? null,
        first_name: p.firstName ?? null,
        last_name: p.lastName ?? null,
        middle_name: p.middleName ?? null,
        name_suffix: p.nameSuffix ?? null,
        name_prefix: p.namePrefix ?? null,

        // Dirección
        address1: p.address1 ?? null,
        address2: p.address2 ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        postal_code: p.postalCode ?? null,

        // Contacto
        phone: p.phone ?? null,
        cell_phone: p.cellPhone ?? null,
        email_address: p.emailAddress ?? null,

        // Estado / tipo / género
        status: p.status ?? null,
        customer_type: p.customerType ?? null,
        gender: p.gender ?? null,

        // Datos médicos / compliance
        mmjid_number: p.mmjidNumber ?? null,
        mmjid_expiration_date: p.mmjidExpirationDate ?? null, // timestamptz
        primary_qualifying_condition: p.primaryQualifyingCondition ?? null,
        secondary_qualifying_conditions: p.secondaryQualifyingConditions ?? null, // string[]

        // Fechas / timestamps
        last_modified_date_utc: p.lastModifiedDateUTC ?? null, // timestamptz
        creation_date: p.creationDate ?? null, // timestamptz
        date_of_birth: p.dateOfBirth ?? null, // date (PG puede castear desde ISO)
        loyalty_registration_date: p.loyaltyRegistrationDate ?? null,
        last_transaction_date: p.lastTransactionDate ?? null,

        // Identificadores externos / integraciones
        external_customer_id: p.externalCustomerId ?? null,
        created_by_integrator: p.createdByIntegrator ?? null,
        spring_big_member_id: p.springBigMemberId ?? null,
        custom_identifier: p.customIdentifier ?? null,

        // Merge
        merged_into_customer_id: p.mergedIntoCustomerId ?? null,

        // Datos licencia
        drivers_license_hash: p.driversLicenseHash ?? null,

        // Flags
        is_anonymous: p.isAnonymous ?? false, // en DB es not null, default false
        is_loyalty_member: p.isLoyaltyMember ?? null,
        opted_into_marketing: p.optedIntoMarketing ?? null,

        // Referral / marketing
        referral_source: p.referralSource ?? null,
        other_referral_source: p.otherReferralSource ?? null,

        // Loyalty
        loyalty_tier: p.loyaltyTier ?? null,

        // Arrays / otros
        discount_groups: p.discountGroups ?? null, // string[]
        created_at_location: p.createdAtLocation ?? null,
        notes: p.notes ?? null,
      });

      if ((i + 1) % 200 === 0 || i + 1 === total) {
        logStep(this.logger, 'armando', i + 1, total, tBuild);
      }
    }

    // UPSERT adaptativo sobre `customers` 
    await this.upsertWithProgress('customers', rows, 'customer_id,unique_id');

    const elapsed = Date.now() - t0;
    this.logger.log(`[customers] Lote completado (${total} customers) • ${fmtMs(elapsed)}`);
    return { ok: true, processed: total, elapsedMs: elapsed };
  }

  // ===== helpers con progreso (ADAPTATIVOS) =====
  private async upsertWithProgress(table: string, rows: any[], onConflict: string) {
    if (!rows.length) return;
    const total = rows.length;
    const t0 = Date.now();
    let done = 0;

    await this.execWithAdaptiveRetry<any>(
      `upsert ${table}`,
      this.UPSERT_CHUNK,
      rows,
      async (batch) => {
        const r = await this.sb.from(table).upsert(batch, { onConflict });
        if (r.error) throw r.error;
        done += batch.length;
        logStep(this.logger, `upserting ${table}`, done, total, t0);
      },
    );
  }
}
