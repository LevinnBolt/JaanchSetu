import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles, isInstitution, toActor } from '../auth/auth.types';
import { ResolutionService } from './resolution.service';

class CreateCaseDto {
  @IsIn(['RENEWAL', 'RELEASE']) type: 'RENEWAL' | 'RELEASE';
  @IsString() @MinLength(5, { message: 'Please give the reason (at least 5 characters).' }) @MaxLength(500) delayReason: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() dueDate?: string;
}
class EvidenceDto {
  @IsString() @MaxLength(30) kind: string;
  @IsString() @MinLength(3) @MaxLength(500) note: string;
  @IsOptional() @IsString() documentId?: string;
}
class DecisionDto {
  @IsString() @MinLength(5, { message: 'A comment of at least 5 characters is mandatory.' }) @MaxLength(500) comment: string;
}
class CompleteDto {
  @IsOptional() @IsString() @MaxLength(500) acknowledgment?: string;
}
class ReasonDto {
  @IsString() @MinLength(5, { message: 'Please give a reason (at least 5 characters).' }) @MaxLength(500) reason: string;
}
class PolicyDto {
  @IsBoolean() requireBank: boolean;
}

@Controller()
export class ResolutionController {
  constructor(private res: ResolutionService) {}

  @Get('fdrs/:id/maturity')
  maturity(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.res.maturity(u, id);
  }

  @Get('fdrs/:id/resolutions')
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.res.list(u, id);
  }

  @Post('fdrs/:id/resolutions')
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreateCaseDto, @Headers('idempotency-key') key?: string) {
    return this.res.create(u, id, dto, key?.slice(0, 80));
  }

  @Get('resolutions/:id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.res.get(u, id);
  }

  @Get('resolutions/:id/events')
  events(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.res.events(u, id);
  }

  @Post('resolutions/:id/evidence')
  evidence(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: EvidenceDto) {
    return this.res.addEvidence(u, id, dto);
  }

  @Post('resolutions/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') key?: string) {
    return this.res.submit(u, id, key?.slice(0, 80));
  }

  @Post('resolutions/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto, @Headers('idempotency-key') key?: string) {
    return this.res.decide(u, id, true, dto.comment, key?.slice(0, 80));
  }

  @Post('resolutions/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto, @Headers('idempotency-key') key?: string) {
    return this.res.decide(u, id, false, dto.comment, key?.slice(0, 80));
  }

  @Post('resolutions/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CompleteDto, @Headers('idempotency-key') key?: string) {
    return this.res.complete(u, id, dto.acknowledgment ?? '', key?.slice(0, 80));
  }

  @Post('resolutions/:id/escalate')
  @HttpCode(200)
  escalate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.res.escalate(u, id, dto.reason);
  }

  @Post('resolutions/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.res.cancel(u, id, dto.reason);
  }

  @Post('resolutions/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.res.reopen(u, id);
  }

  @Get('dashboard/maturity-risk')
  risk(@CurrentUser() u: AuthUser) {
    return this.res.risk(u);
  }

  /** Officers a case can be assigned to (names only). */
  @Get('resolution-officers')
  officers(@CurrentUser() u: AuthUser) {
    if (isInstitution(u)) throw new ForbiddenException('The officer list is for officials.');
    return this.res.officers();
  }

  @Get('resolution-policy')
  async policy(@CurrentUser() u: AuthUser) {
    if (isInstitution(u)) throw new ForbiddenException('The approval policy is for officials.');
    return { requireBank: await this.res.requireBank() };
  }

  @Patch('resolution-policy')
  @Roles('ADMIN')
  setPolicy(@CurrentUser() u: AuthUser, @Body() dto: PolicyDto) {
    return this.res.setRequireBank(dto.requireBank, toActor(u));
  }
}
