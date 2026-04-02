import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../../../common/supabase/supabase.provider';
import { ClosingReportDto } from '../dtos/closing-report.dto';
// import { ReceivedInventoryDto } from '../dtos/received-inventory.dto';

// Reemplaza por tu origen real (tabla stores, config, etc.)
const STORE_ID_MAP: Record<string, number> = {
    wellgreens_lemon_grove: 1,
    // ...
};

@Injectable()
export class ClosingReportService {
    constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) { }

    private mapHeader(dto: ClosingReportDto) {
        const store_id = STORE_ID_MAP[dto.storeId];
        if (!store_id) {
            throw new BadRequestException(`storeId no mapeado: ${dto.storeId}`);
        }
        const [year, month] = (dto.month || '').split('-').map(Number);
        if (!year || !month || month < 1 || month > 12) {
            throw new BadRequestException(`month inválido, se espera 'YYYY-MM': ${dto.month}`);
        }
        const d = dto.data || {};

        return {
            store_id,
            year,
            month,
            period_start_utc: dto.periodStartUTC ?? null,
            period_end_utc: dto.periodEndUTC ?? null,
            version: dto.version ?? null,
            variant: dto.variant ?? null,

            total_tips: d.totalTips ?? null,
            pay_by_bank_tips: d.payByBankTips ?? null,
            pay_by_bank_transaction_fees: d.payByBankTransactionFees ?? null,

            gross_sales: d.grossSales ?? null,
            discount: d.discount ?? null,
            loyalty: d.loyalty ?? null,
            total_tax: d.totalTax ?? null,
            cost: d.cost ?? null,
            coupons: d.coupons ?? null,
            item_total: d.itemTotal ?? null,

            transaction_count: d.transactionCount ?? null,
            item_count: d.itemCount ?? null,
            customer_count: d.customerCount ?? null,
            new_customer_count: d.newCustomerCount ?? null,
            void_count: d.voidCount ?? null,
            void_total: d.voidTotal ?? null,
            return_total: d.returnTotal ?? null,

            starting_balance: d.startingBalance ?? null,
            ending_balance: d.endingBalance ?? null,
            deposits: d.deposits ?? null,
            adjustments: d.adjustments ?? null,

            total_payments: d.totalPayments ?? null,
            invoice_total: d.invoiceTotal ?? null,
            cannabis_sales: d.cannabisSales ?? null,
            non_cannabis_sales: d.nonCannabisSales ?? null,
            net_sales: d.netSales ?? null,

            revenue_fees_donations: d.revenueFeesDonations ?? null,
            non_revenue_fees_donations: d.nonRevenueFeesDonations ?? null,
            rounding: d.rounding ?? null,
            total_income: d.totalIncome ?? null,
            average_cart_net_sales: d.averageCartNetSales ?? null,
            over_short: d.overShort ?? null,
        };
    }

    private async repopulate(table: string, closing_report_id: number, rows: any[]) {
        const del = await this.sb.from(table).delete().eq('closing_report_id', closing_report_id);
        if (del.error) throw del.error;
        if (!rows.length) return;
        const ins = await this.sb.from(table).insert(rows);
        if (ins.error) throw ins.error;
    }

    private async upsertArray(table: string, conflict: string, rows: any[]) {
        if (!rows.length) return;
        const { error } = await this.sb.from(table).upsert(rows, { onConflict: conflict });
        if (error) throw error;
    }

    async import(dto: ClosingReportDto) {
        // 1) encabezado (PRIMARY) → UPSERT por (store_id,year,month)
        const header = this.mapHeader(dto);
        const upsert = await this.sb
            .from('stores_closing_report')
            .upsert(header, { onConflict: 'store_id,year,month' })
            .select('id')
            .single();

        if (upsert.error) throw upsert.error;
        const closing_report_id: number = upsert.data.id;

        const d = dto.data || {};

        // 2) fees_donations → DELETE + INSERT
        const feesDonationsSrc = Array.isArray(d.feesDonations) ? d.feesDonations : [];
        const feesDonations = feesDonationsSrc.map((x: any) => ({
            closing_report_id,
            name: x.name ?? null,
            cash_value: x.cashValue ?? null,
            is_revenue: x.isRevenue ?? null,
        }));
        await this.repopulate('closing_report_fees_donations', closing_report_id, feesDonations);

        // 3) category_summary → UPSERT (closing_report_id, category)
        const categorySummarySrc = Array.isArray(d.categorySummary) ? d.categorySummary : [];
        const categorySummary = categorySummarySrc.map((x: any) => ({
            closing_report_id,
            category: x.category ?? null,
            category_total: x.categoryTotal ?? null,
            category_gross_total: x.categoryGrossTotal ?? null,
            category_discount_total: x.categoryDiscountTotal ?? null,
            category_net_total: x.categoryNetTotal ?? null,
            category_cost: x.categoryCost ?? null,
        }));
        await this.upsertArray(
            'closing_report_category_summary',
            'closing_report_id,category',
            categorySummary,
        );

        // 4) payment_summary → UPSERT (closing_report_id, payment_type)
        const paymentSummarySrc = Array.isArray(d.paymentSummary) ? d.paymentSummary : [];
        const paymentSummary = paymentSummarySrc.map((x: any) => ({
            closing_report_id,
            payment_type: x.paymentType ?? null,
            total_paid: x.totalPaid ?? null,
        }));
        await this.upsertArray(
            'closing_report_payment_summary',
            'closing_report_id,payment_type',
            paymentSummary,
        );

        // 5) tax_summary → DELETE + INSERT
        const taxSummarySrc = Array.isArray(d.taxSummary) ? d.taxSummary : [];
        const taxSummary = taxSummarySrc.map((x: any) => ({
            closing_report_id,
            tax_rate: x.taxRate ?? null,
            total_tax: x.totalTax ?? null,
        }));
        await this.repopulate('closing_report_tax_summary', closing_report_id, taxSummary);

        // 6) customer_type_summary → UPSERT (closing_report_id, customer_type)
        const customerTypeSummarySrc = Array.isArray(d.customerTypeSummary) ? d.customerTypeSummary : [];
        const customerTypeSummary = customerTypeSummarySrc.map((x: any) => ({
            closing_report_id,
            customer_type: x.customerType ?? null,
            total: x.total ?? null,
            gross_total: x.grossTotal ?? null,
            net_total: x.netTotal ?? null,
            discount_total: x.discountTotal ?? null,
            customer_type_cost: x.customerTypeCost ?? null,
            cannabis_sales: x.cannabisSales ?? null,
            non_cannabis_sales: x.nonCannabisSales ?? null,
        }));
        await this.upsertArray(
            'closing_report_customer_type_summary',
            'closing_report_id,customer_type',
            customerTypeSummary,
        );

        // 7) order_type_summary → UPSERT (closing_report_id, order_type)
        const orderTypeSummarySrc = Array.isArray(d.orderTypeSummary) ? d.orderTypeSummary : [];
        const orderTypeSummary = orderTypeSummarySrc.map((x: any) => ({
            closing_report_id,
            order_type: x.orderType ?? null,
            total: x.total ?? null,
            gross_total: x.grossTotal ?? null,
            net_total: x.netTotal ?? null,
            discount_total: x.discountTotal ?? null,
            order_type_cost: x.orderTypeCost ?? null,
        }));
        await this.upsertArray(
            'closing_report_order_type_summary',
            'closing_report_id,order_type',
            orderTypeSummary,
        );

        // 8) order_source_summary → UPSERT (closing_report_id, order_source)
        const orderSourceSummarySrc = Array.isArray(d.orderSourceSummary) ? d.orderSourceSummary : [];
        const orderSourceSummary = orderSourceSummarySrc.map((x: any) => ({
            closing_report_id,
            order_source: x.orderSource ?? null,
            total: x.total ?? null,
            gross_total: x.grossTotal ?? null,
            net_total: x.netTotal ?? null,
            discount_total: x.discountTotal ?? null,
            order_source_cost: x.orderSourceCost ?? null,
        }));
        await this.upsertArray(
            'closing_report_order_source_summary',
            'closing_report_id,order_source',
            orderSourceSummary,
        );

        // 9) pay_by_bank_batch_file → DELETE + INSERT
        const pbbSrc = Array.isArray(d.payByBankBatchFile) ? d.payByBankBatchFile : [];
        const pbb = pbbSrc.map((x: any) => ({
            closing_report_id,
            batch_file_name: x.batchFileName ?? null,
            adjustment_amount: x.payByBankBatchFileAdjustmentAmount ?? null,
        }));
        await this.repopulate('closing_report_pay_by_bank_batch_file', closing_report_id, pbb);

        // 10) dutchie_pay_batch_file_sums → DELETE + INSERT
        const dpbSrc = Array.isArray(d.dutchiePayBatchFileSums) ? d.dutchiePayBatchFileSums : [];
        const dpb = dpbSrc.map((x: any) => ({
            closing_report_id,
            batch_file_name: x.batchFileName ?? null,
            adjustment_amount: x.payByBankBatchFileAdjustmentAmount ?? null,
        }));
        await this.repopulate('closing_report_dutchie_pay_batch_file_sums', closing_report_id, dpb);

        return { closing_report_id };
    }
}


    //     async import(dto: ReceivedInventoryDto) {
    //     // 1) HEADER: UPSERT por id externo del JSON
    //     const header = {
    //       received_inventory_id: dto.receiveInventoryHistoryId, // UNIQUE en DB
    //       store_id: dto.storeId ?? null,
    //       title: dto.title ?? null,
    //       status: dto.status ?? null,
    //       failure_message: dto.failureMessage ?? null,
    //       delivered_on: dto.deliveredOn ?? null, // text por ahora
    //       added_on: dto.addedOn ?? null,
    //       vendor: dto.vendor ?? null,
    //       vendor_license: dto.vendorLicense ?? null,
    //     };

    //     const h = await this.sb
    //       .from('stores_received_inventory')
    //       .upsert(header, { onConflict: 'received_inventory_id' })
    //       .select('id')
    //       .single();
    //     if (h.error) throw h.error;

    //     const received_inventory_pk = h.data.id;

    //     // 2) ITEMS: UPSERT por (received_inventory_id (FK PK), sku, product_id)
    //     const items = Array.isArray(dto.items) ? dto.items : [];
    //     if (items.length) {
    //       const rows = items.map((x) => ({
    //         received_inventory_id: received_inventory_pk, // FK al PK interno del header
    //         product_name: x.product ?? null,
    //         sku: x.sku,
    //         product_id: x.productId,
    //         type: x.type ?? null,
    //         quantity: x.quantity ?? null,
    //         unit_abbreviation: x.unitAbbreviation ?? null,
    //         unit: x.unit ?? null,
    //         unit_cost: x.unitCost ?? null,
    //         unit_tax: x.unitTax ?? null,
    //         total_cost: x.totalCost ?? null,
    //         package_id: x.packageId ?? null,
    //         external_package_id: x.externalPackageId ?? null,
    //         batch_name: x.batchName ?? null,
    //         batch_id: x.batchId ?? null,
    //         room: x.room ?? null,
    //         room_id: x.roomId ?? null,
    //       }));

    //       const up = await this.sb
    //         .from('received_inventory_item')
    //         .upsert(rows, { onConflict: 'received_inventory_id,sku,product_id' });
    //       if (up.error) throw up.error;
    //     }

    //     return { received_inventory_id: received_inventory_pk };
    //   }