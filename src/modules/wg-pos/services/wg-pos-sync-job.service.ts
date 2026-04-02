// wg-pos-sync-job.service.ts
import { Injectable } from '@nestjs/common';
import {
  RunWgPosSyncJobDto,
  RunWgPosSyncJobResponseDto,
  SyncJobStepResultDto,
} from '../dtos/wg-pos-sync-job.dto';
import { SyncReportingTransactionsService } from './sync-reporting-transactions.service';
import { SyncReportingProductsService } from './sync-reporting-products.service';
import { SyncReceivedInventoryService } from './sync-received-inventory.service';
import { SyncReportingCustomersService } from './sync-reporting-customers.service';
import { SyncInventoryTransactionsService } from './sync-inventory-transactions.service';
import { SyncHomebaseTimecardsService } from './sync-homebase-timecards.service';
import { SyncHomebaseShiftsService } from './sync-homebase-shifts.service';
import { SyncDutchieEmployeesService } from './sync-dutchie-employees.service';

type Range = { from_utc: string; to_utc: string };

@Injectable()
export class WgPosSyncJobService {
  constructor(
    private readonly syncTransactionsService: SyncReportingTransactionsService,
    private readonly syncProductsService: SyncReportingProductsService,
    private readonly syncReceivedInventoryService: SyncReceivedInventoryService,
    private readonly syncCustomersService: SyncReportingCustomersService,
    private readonly syncDutchieEmployeesService: SyncDutchieEmployeesService,
    private readonly syncInventoryTransactionService: SyncInventoryTransactionsService,
    private readonly syncHomebaseTimecardsService: SyncHomebaseTimecardsService,
    private readonly syncHomebaseShiftsService: SyncHomebaseShiftsService,
  ) {}

  private formatUtcYmd(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private addUtcDays(base: Date, days: number): Date {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private makeRangeUtc(fromDaysAgo: number, toDaysAhead: number): Range {
    const now = new Date();
    return {
      from_utc: this.formatUtcYmd(this.addUtcDays(now, -fromDaysAgo)),
      to_utc: this.formatUtcYmd(this.addUtcDays(now, +toDaysAhead)),
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  private async runStepWithRetry(
    stepName: string,
    payload: Range,
    fn: () => Promise<void>,
    retries: number,
  ): Promise<SyncJobStepResultDto> {
    const start = Date.now();

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        await fn();
        return { path: stepName, ok: true, ms: Date.now() - start, payload };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        const isLast = attempt === retries + 1;

        if (isLast) {
          return {
            path: stepName,
            ok: false,
            ms: Date.now() - start,
            error: msg,
            payload,
          };
        }

        const backoff = 500 * Math.pow(2, attempt - 1);
        await this.sleep(backoff);
      }
    }

    return {
      path: stepName,
      ok: false,
      ms: Date.now() - start,
      error: 'UNKNOWN_ERROR',
      payload,
    };
  }

  // IMPORTANT: asegúrate de esperar (await) todos los servicios
  private async syncTransactions(payload: Range): Promise<void> {
    await this.syncTransactionsService.syncAllStoresTransactions({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  private async syncProducts(payload: Range): Promise<void> {
    await this.syncProductsService.syncAllStoresProducts({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  private async syncReceivedInventory(payload: Range): Promise<void> {
    await this.syncReceivedInventoryService.syncAllStoresReceivedInventory({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  private async syncCustomers(payload: Range): Promise<void> {
    await this.syncCustomersService.syncReportingCustomers({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  private async syncDutchieEmployees(_: Range): Promise<void> {
    await this.syncDutchieEmployeesService.syncDutchieEmployees();
  }

  private async syncInventoryTransaction(payload: Range): Promise<void> {
    await this.syncInventoryTransactionService.syncInventoryTransaction({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  private async syncHomebaseTimecards(payload: Range): Promise<void> {
    await this.syncHomebaseTimecardsService.syncHomebaseTimecards({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  private async syncHomebaseShifts(payload: Range): Promise<void> {
    await this.syncHomebaseShiftsService.syncHomebaseShifts({
      from_utc: payload.from_utc,
      to_utc: payload.to_utc,
    });
  }

  async runJob(dto: RunWgPosSyncJobDto): Promise<RunWgPosSyncJobResponseDto> {
    const startedAt = new Date().toISOString();

    const continueOnError = dto.continue_on_error ?? false;
    const retries = dto.retries ?? 3;

    const defaultFromDaysAgo = dto.default_from_days_ago ?? 8;
    const receivedFromDaysAgo = dto.receivedinventory_from_days_ago ?? 60;
    const toDaysAhead = dto.to_days_ahead ?? 1;

    const defaultRange = this.makeRangeUtc(defaultFromDaysAgo, toDaysAhead);
    const receivedRange = this.makeRangeUtc(receivedFromDaysAgo, toDaysAhead);

    const steps: Array<{ name: string; payload: Range; fn: () => Promise<void> }> = [
      {
        name: '/wg-pos/sync/reporting/transactions',
        payload: defaultRange,
        fn: () => this.syncTransactions(defaultRange),
      },
      {
        name: '/wg-pos/sync/reporting/products',
        payload: defaultRange,
        fn: () => this.syncProducts(defaultRange),
      },
      {
        name: '/wg-pos/sync/inventory/receivedinventory',
        payload: receivedRange,
        fn: () => this.syncReceivedInventory(receivedRange),
      },
      {
        name: '/wg-pos/sync/reporting/customers',
        payload: defaultRange,
        fn: () => this.syncCustomers(defaultRange),
      },
      {
        name: '/wg-pos/sync/dutchie/employees',
        payload: defaultRange,
        fn: () => this.syncDutchieEmployees(defaultRange),
      },
      {
        name: '/wg-pos/sync/inventory/inventorytransaction',
        payload: defaultRange,
        fn: () => this.syncInventoryTransaction(defaultRange),
      },
      {
        name: '/wg-pos/sync/homebase/timecards',
        payload: defaultRange,
        fn: () => this.syncHomebaseTimecards(defaultRange),
      },
      {
        name: '/wg-pos/sync/homebase/shifts',
        payload: defaultRange,
        fn: () => this.syncHomebaseShifts(defaultRange),
      },
    ];

    const results: SyncJobStepResultDto[] = [];

    for (const s of steps) {
      const res = await this.runStepWithRetry(s.name, s.payload, s.fn, retries);
      results.push(res);

      if (!res.ok && !continueOnError) break;
    }

    const ok = results.length === steps.length && results.every((x) => x.ok);

    return {
      ok,
      started_at_utc: startedAt,
      finished_at_utc: new Date().toISOString(),
      steps: results,
    };
  }
}