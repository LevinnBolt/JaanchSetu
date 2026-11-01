import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DISCREPANCY_TYPES } from '../domain/discrepancy-rules';
import { FIELD_KEYS } from '../domain/fields';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class CreateFdrDto {
  @IsString() @IsNotEmpty() @MaxLength(40) fdrNumber: string;
  @IsString() @IsNotEmpty() @MaxLength(80) bank: string;
  @IsString() @IsNotEmpty() @MaxLength(80) branch: string;
  @IsString() @IsNotEmpty() @MaxLength(20) ifsc: string;
  @Matches(/^[\d,]+$/, { message: 'amount must be a whole number of rupees, for example 500000 or 5,00,000' }) amount: string;
  @IsISO8601({ strict: true }, { message: 'issueDate must be a date like 2026-03-12' }) issueDate: string;
  @IsISO8601({ strict: true }, { message: 'maturityDate must be a date like 2027-03-12' }) maturityDate: string;
  @IsString() @IsNotEmpty() @MaxLength(160) depositorName: string;
  @IsString() @IsNotEmpty() @MaxLength(200) inFavourOf: string;
  @IsOptional() @IsString() renewsFdrId?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() asDraft?: boolean;
}

/** Whatever has been typed so far. Nothing is required: this only compares it with the scan. */
export class PreflightDto {
  @IsOptional() @IsString() @MaxLength(40) fdrNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) bank?: string;
  @IsOptional() @IsString() @MaxLength(80) branch?: string;
  @IsOptional() @IsString() @MaxLength(20) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(20) amount?: string;
  @IsOptional() @IsString() @MaxLength(20) issueDate?: string;
  @IsOptional() @IsString() @MaxLength(20) maturityDate?: string;
  @IsOptional() @IsString() @MaxLength(200) depositorName?: string;
  @IsOptional() @IsString() @MaxLength(200) inFavourOf?: string;
}

export class FieldReviewDto {
  @IsIn(['CONFIRM', 'CORRECT']) action: 'CONFIRM' | 'CORRECT';
  @IsOptional() @IsString() @MaxLength(200) value?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectDto {
  @IsString() @MinLength(5, { message: 'Please give a reason of at least 5 characters.' }) @MaxLength(500) reason: string;
}

export class RaiseDiscrepancyDto {
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @IsOptional() @IsIn([...FIELD_KEYS]) fieldKey?: (typeof FIELD_KEYS)[number];
}

export class ResolveDto {
  @IsString() @MinLength(3, { message: 'Please describe how it was resolved.' }) @MaxLength(500) note: string;
}

export class WaiveDto {
  @IsString() @MinLength(10, { message: 'Waiving needs a written reason of at least 10 characters.' }) @MaxLength(500) reason: string;
}

export class ListQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() institutionId?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() bank?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsISO8601() maturityFrom?: string;
  @IsOptional() @IsISO8601() maturityTo?: string;
  @IsOptional() @IsIn([...DISCREPANCY_TYPES]) discrepancyType?: string;
  @IsOptional() @IsIn(['active', 'expiring90', 'matured', 'renewal', 'release', 'discrepancy', 'overdue', 'scrutiny', 'pending', 'bankconfirmed']) bucket?: string;
  @IsOptional() @IsIn(['PENDING', 'BANK_CONFIRMED', 'DISCREPANCY']) verification?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
