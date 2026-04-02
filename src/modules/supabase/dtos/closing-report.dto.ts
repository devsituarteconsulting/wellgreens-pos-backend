import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

class FeesDonationDto {
  @IsString() name: string;
  @IsNumber() cashValue: number;
  @IsBoolean() isRevenue: boolean;
}

class CategorySummaryDto {
  @IsString() category: string;
  @IsNumber() categoryTotal: number;
  @IsNumber() categoryGrossTotal: number;
  @IsNumber() categoryDiscountTotal: number;
  @IsNumber() categoryNetTotal: number;
  @IsNumber() categoryCost: number;
}

class PaymentSummaryDto {
  @IsString() paymentType: string;
  @IsNumber() totalPaid: number;
}

class TaxSummaryDto {
  @IsString() taxRate: string;
  @IsNumber() totalTax: number;
}

class CustomerTypeSummaryDto {
  @IsString() customerType: string;
  @IsNumber() total: number;
  @IsNumber() grossTotal: number;
  @IsNumber() netTotal: number;
  @IsNumber() discountTotal: number;
  @IsNumber() customerTypeCost: number;
  @IsNumber() cannabisSales: number;
  @IsNumber() nonCannabisSales: number;
}

class OrderTypeSummaryDto {
  @IsString() orderType: string;
  @IsNumber() total: number;
  @IsNumber() grossTotal: number;
  @IsNumber() netTotal: number;
  @IsNumber() discountTotal: number;
  @IsNumber() orderTypeCost: number;
}

class OrderSourceSummaryDto {
  @IsString() orderSource: string;
  @IsNumber() total: number;
  @IsNumber() grossTotal: number;
  @IsNumber() netTotal: number;
  @IsNumber() discountTotal: number;
  @IsNumber() orderSourceCost: number;
}

class PayByBankFileDto {
  @IsOptional() @IsString() batchFileName?: string | null;
  @IsNumber() payByBankBatchFileAdjustmentAmount: number;
}

class DutchiePayFileDto {
  @IsOptional() @IsString() batchFileName?: string | null;
  @IsNumber() payByBankBatchFileAdjustmentAmount: number;
}

class ClosingDataDto {
  @IsOptional() @IsNumber() totalTips?: number;
  @IsOptional() @IsNumber() payByBankTips?: number;
  @IsOptional() @IsNumber() payByBankTransactionFees?: number;

  @IsOptional() @IsNumber() grossSales?: number;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsNumber() loyalty?: number;
  @IsOptional() @IsNumber() totalTax?: number;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsNumber() coupons?: number;
  @IsOptional() @IsNumber() itemTotal?: number;

  @IsOptional() @IsNumber() transactionCount?: number;
  @IsOptional() @IsNumber() itemCount?: number;
  @IsOptional() @IsNumber() customerCount?: number;
  @IsOptional() @IsNumber() newCustomerCount?: number;
  @IsOptional() @IsNumber() voidCount?: number;
  @IsOptional() @IsNumber() voidTotal?: number;
  @IsOptional() @IsNumber() returnTotal?: number;

  @IsOptional() @IsNumber() startingBalance?: number;
  @IsOptional() @IsNumber() endingBalance?: number;
  @IsOptional() @IsNumber() deposits?: number;
  @IsOptional() @IsNumber() adjustments?: number | null;

  @IsOptional() @IsNumber() totalPayments?: number;
  @IsOptional() @IsNumber() invoiceTotal?: number;
  @IsOptional() @IsNumber() cannabisSales?: number;
  @IsOptional() @IsNumber() nonCannabisSales?: number;
  @IsOptional() @IsNumber() netSales?: number;

  @IsOptional() @IsNumber() revenueFeesDonations?: number;
  @IsOptional() @IsNumber() nonRevenueFeesDonations?: number;
  @IsOptional() @IsNumber() rounding?: number;
  @IsOptional() @IsNumber() totalIncome?: number;
  @IsOptional() @IsNumber() averageCartNetSales?: number;
  @IsOptional() @IsNumber() overShort?: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => FeesDonationDto)
  feesDonations: FeesDonationDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => CategorySummaryDto)
  categorySummary: CategorySummaryDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentSummaryDto)
  paymentSummary: PaymentSummaryDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => TaxSummaryDto)
  taxSummary: TaxSummaryDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => CustomerTypeSummaryDto)
  customerTypeSummary: CustomerTypeSummaryDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderTypeSummaryDto)
  orderTypeSummary: OrderTypeSummaryDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderSourceSummaryDto)
  orderSourceSummary: OrderSourceSummaryDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => PayByBankFileDto)
  payByBankBatchFile: PayByBankFileDto[] = [];

  @IsArray() @ValidateNested({ each: true }) @Type(() => DutchiePayFileDto)
  dutchiePayBatchFileSums: DutchiePayFileDto[] = [];
}

export class ClosingReportDto {
  @IsString() storeId: string;           // se mapea a int4 con tu catálogo
  @IsString() month: string;             // "YYYY-MM"
  @IsString() periodStartUTC: string;
  @IsString() periodEndUTC: string;
  @IsString() version: string;
  @IsString() variant: string;

  @IsObject() @ValidateNested() @Type(() => ClosingDataDto)
  data: ClosingDataDto;
}
