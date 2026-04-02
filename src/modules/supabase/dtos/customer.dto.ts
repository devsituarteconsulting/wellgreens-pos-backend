// src/modules/dutchie/dtos/customer.dto.ts
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsISO8601,
} from 'class-validator';

export class CustomerDto {
  // Identificadores (PK compuesta en SQL)
  @IsInt()
  customerId!: number; // Unique internal identifier

  @IsString()
  uniqueId!: string; // String representation for external API

  // Nombre / identidad
  @IsOptional() @IsString()
  name?: string; // deprecated

  @IsOptional() @IsString()
  firstName?: string;

  @IsOptional() @IsString()
  lastName?: string;

  @IsOptional() @IsString()
  middleName?: string;

  @IsOptional() @IsString()
  nameSuffix?: string;

  @IsOptional() @IsString()
  namePrefix?: string;

  // Dirección
  @IsOptional() @IsString()
  address1?: string;

  @IsOptional() @IsString()
  address2?: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  state?: string;

  @IsOptional() @IsString()
  postalCode?: string;

  // Contacto
  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsString()
  cellPhone?: string;

  @IsOptional() @IsString()
  emailAddress?: string;

  // Estado / tipo / género
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  customerType?: string;

  @IsOptional() @IsString()
  gender?: string;

  // Datos médicos / compliance
  @IsOptional() @IsString()
  mmjidNumber?: string;

  @IsOptional() @IsISO8601()
  mmjidExpirationDate?: string; // date-time

  @IsOptional() @IsString()
  primaryQualifyingCondition?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryQualifyingConditions?: string[];

  // Fechas / timestamps
  @IsOptional() @IsISO8601()
  lastModifiedDateUTC?: string; // UTC timestamp

  @IsOptional() @IsISO8601()
  creationDate?: string; // date-time

  @IsOptional() @IsISO8601()
  dateOfBirth?: string; // date-time (DB: date)

  @IsOptional() @IsISO8601()
  loyaltyRegistrationDate?: string; // date-time

  @IsOptional() @IsISO8601()
  lastTransactionDate?: string; // date-time

  // Identificadores externos / integraciones
  @IsOptional() @IsString()
  externalCustomerId?: string;

  @IsOptional() @IsString()
  createdByIntegrator?: string;

  @IsOptional() @IsInt()
  springBigMemberId?: number;

  @IsOptional() @IsString()
  customIdentifier?: string;

  // Merge
  @IsOptional() @IsInt()
  mergedIntoCustomerId?: number;

  // Datos de licencia
  @IsOptional() @IsString()
  driversLicenseHash?: string;

  // Flags
  @IsBoolean()
  isAnonymous!: boolean;

  @IsOptional() @IsBoolean()
  isLoyaltyMember?: boolean;

  @IsOptional() @IsBoolean()
  optedIntoMarketing?: boolean;

  // Referral / marketing
  @IsOptional() @IsString()
  referralSource?: string;

  @IsOptional() @IsString()
  otherReferralSource?: string;

  // Loyalty
  @IsOptional() @IsString()
  loyaltyTier?: string;

  // Arrays / otros
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  discountGroups?: string[];

  @IsOptional() @IsString()
  createdAtLocation?: string;

  @IsOptional() @IsString()
  notes?: string;
}
