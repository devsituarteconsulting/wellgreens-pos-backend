import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class TransactionDto {
  @IsInt() transactionId: number;
  // storeId puede venir numérico o string (lo resolvemos en el servicio)
  storeId: string;

  @IsOptional() @IsInt() customerId?: number;
  @IsOptional() @IsInt() employeeId?: number;

  @IsDateString() transactionDate: string;
  @IsOptional() @IsDateString() voidDate?: string;
  @IsBoolean() isVoid: boolean;

  @IsNumber() subtotal: number;
  @IsNumber() totalDiscount: number;
  @IsNumber() totalBeforeTax: number;
  @IsNumber() tax: number;
  @IsOptional() @IsNumber() tipAmount?: number;
  @IsNumber() total: number;
  @IsNumber() paid: number;
  @IsNumber() changeDue: number;

  @IsInt() totalItems: number;
  @IsOptional() @IsString() terminalName?: string;
  @IsOptional() @IsDateString() checkInDate?: string;
  @IsOptional() @IsString() invoiceNumber?: string;

  @IsBoolean() isTaxInclusive: boolean;
  @IsOptional() @IsString() transactionType?: string;

  @IsOptional() @IsNumber() loyaltyEarned?: number;
  @IsOptional() @IsNumber() loyaltySpent?: number;

  @IsDateString() lastModifiedDateUTC: string;

  @IsOptional() @IsNumber() cashPaid?: number;
  @IsOptional() @IsNumber() debitPaid?: number;
  @IsOptional() @IsNumber() electronicPaid?: number;
  @IsOptional() @IsString() electronicPaymentMethod?: string;
  @IsOptional() @IsNumber() checkPaid?: number;
  @IsOptional() @IsNumber() creditPaid?: number;
  @IsOptional() @IsNumber() giftPaid?: number;
  @IsOptional() @IsNumber() mmapPaid?: number;
  @IsOptional() @IsNumber() prePaymentAmount?: number;

  @IsOptional() @IsNumber() revenueFeesAndDonations?: number;
  @IsOptional() @IsNumber() nonRevenueFeesAndDonations?: number;

  @IsOptional() @IsInt() returnOnTransactionId?: number;
  @IsOptional() @IsInt() adjustmentForTransactionId?: number;

  @IsOptional() @IsString() orderType?: string;
  @IsBoolean() wasPreOrdered: boolean;
  @IsOptional() @IsString() orderSource?: string;
  @IsOptional() @IsString() orderMethod?: string;
  @IsOptional() @IsString() invoiceName?: string;

  @IsBoolean() isReturn: boolean;
  @IsOptional() @IsString() authCode?: string;

  @IsInt() customerTypeId: number;
  @IsBoolean() isMedical: boolean;

  @IsOptional() @IsArray() orderIds?: number[];

  @IsNumber() totalCredit: number;
  @IsOptional() @IsString() completedByUser?: string;
  @IsInt() responsibleForSaleUserId: number;

  @IsDateString() transactionDateLocalTime: string;
  @IsOptional() @IsDateString() estTimeArrivalLocal?: string;
  @IsOptional() @IsDateString() estDeliveryDateLocal?: string;
  @IsOptional() @IsString() referenceId?: string;

  @IsOptional() @IsArray() items?: any[];
  @IsOptional() @IsArray() discounts?: any[];
  @IsOptional() @IsArray() feesAndDonations?: any[];
  @IsOptional() @IsArray() taxSummary?: any[];
  @IsOptional() @IsArray() manualPayments?: any[];
  @IsOptional() @IsArray() integratedPayments?: any[];
}
