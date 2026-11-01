import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { AuthUser, CurrentUser, hasRole } from '../auth/auth.types';
import { BankService } from '../infra/bank.service';
import { DashboardService } from './dashboard.service';
import { FdrsService } from '../fdrs/fdrs.service';
import { isInstitution } from '../auth/auth.types';
import { FIELD_KEYS, FIELD_LABELS } from '../domain/fields';
import { DISCREPANCY_TYPES } from '../domain/discrepancy-rules';
import { FDR_STATUSES } from '../domain/state-machine';

@Controller()
export class DashboardController {
  constructor(private dash: DashboardService, private prisma: PrismaService, private clock: ClockService, private fdrs: FdrsService, private bank: BankService) {}

  @Get('dashboard')
  summary(@CurrentUser() u: AuthUser) {
    return this.dash.summary(u);
  }

  /** Staff only: figures measured from the system's own records. */
  @Get('dashboard/impact')
  impact(@CurrentUser() u: AuthUser) {
    if (isInstitution(u)) throw new ForbiddenException('These figures are for officials.');
    return this.dash.impact();
  }

  @Get('institutions')
  institutions(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.dash.institutions(u, { q: q?.slice(0, 80), page: Number(page) || 1, pageSize: Number(pageSize) || 15 });
  }

  @Get('institutions/:id')
  async institution(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (isInstitution(u) && u.institutionId !== id) throw new ForbiddenException('You can only view your own institution.');
    const summary = await this.dash.institutionSummary(u, id);
    const list = await this.fdrs.list(u, { institutionId: id, pageSize: 100 } as any);
    return { institution: summary ?? null, fdrs: list.items, totalFdrs: list.total };
  }

  /** Lookup data for filters and forms. */
  @Get('meta')
  async meta(@CurrentUser() u: AuthUser) {
    const institutions = await this.prisma.institution.findMany({
      where: isInstitution(u) ? { id: u.institutionId ?? '' } : {},
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true, state: true, city: true },
    });
    const banks = await this.prisma.fdr.findMany({ where: { bankName: { not: null } }, distinct: ['bankName'], select: { bankName: true }, orderBy: { bankName: 'asc' } });
    return {
      institutions,
      states: (await this.prisma.institution.findMany({ where: isInstitution(u) ? { id: u.institutionId ?? '' } : {}, distinct: ['state'], select: { state: true }, orderBy: { state: 'asc' } })).map((s) => s.state),
      banks: banks.map((b) => b.bankName),
      statuses: FDR_STATUSES,
      discrepancyTypes: DISCREPANCY_TYPES,
      fields: FIELD_KEYS.map((k) => ({ key: k, label: FIELD_LABELS[k] })),
      clock: await this.clock.info(),
      bank: { mode: this.bank.mode, label: this.bank.label },
    };
  }

  @Get('clock')
  clockInfo() {
    return this.clock.info();
  }
}
