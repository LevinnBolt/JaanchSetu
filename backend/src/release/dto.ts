import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CHECKLIST_KEYS } from '../domain/maker-checker';

export class ReleaseRequestDto {
  @IsString() @MinLength(5, { message: 'Please give the reason for the release (at least 5 characters).' }) @MaxLength(500) reason: string;
}

export class ChecklistItemDto {
  @IsIn([...CHECKLIST_KEYS]) key: (typeof CHECKLIST_KEYS)[number];
  @IsBoolean() ticked: boolean;
  @IsString() @MaxLength(300) note: string;
}

export class ChecklistDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemDto) items: ChecklistItemDto[];
}

export class RecommendDto {
  @IsString() @MinLength(3) @MaxLength(500) note: string;
}

export class DecisionDto {
  @IsBoolean() approve: boolean;
  @IsString() @MinLength(5, { message: 'A reason of at least 5 characters is mandatory.' }) @MaxLength(500) reason: string;
}
