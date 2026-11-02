import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { AuthUser, isInstitution } from '../auth/auth.types';
import { COVERAGE_ORDER, CoverageItem, CoverageResult, CoverageStatus, computeCoverage } from '../domain/coverage';
import { isoDate } from '../domain/dates';

/** Deposits that count towards cover: accepted and not yet matured. */
const COUNTED = ['ACCEPTED', 'EXPIRING_SOON', 'RENEWAL_PENDING'] as const;

export interface CoverageRow extends CoverageResult {
  institutionId: string;
  name: string;
  city: string;
  state: string;
}

@Injectable()
export class CoverageService {
  constructor(private prisma: PrismaService, private clock: ClockService) {}

  private async itemsFor(institutionIds: string[]): Promise<Map<string, (CoverageItem & { status: string })[]>> {
    const out = new Map<string, (CoverageItem & { status: string })[]>();
    if (!institutionIds.length) return out;
    const rows = await this.prisma.fdr.findMany({
      where: { institutionId: { in: institutionIds }, status: { in: COUNTED as unknown as Prisma.EnumFdrStatusFilter['in'] }, maturityDate: { not: null }, amount: { not: null } },
      select: { id: true, institutionId: true, fdrNumber: true, amount: true, issueDate: true, maturityDate: true, status: true },
    });
    for (const r of rows) {
      const list = out.get(r.institutionId) ?? [];
      list.push({ id: r.id, fdrNumber: r.fdrNumber, amount: r.amount!, issue: r.issueDate, maturity: r.maturityDate!, renewalRequested: r.status === 'RENEWAL_PENDING', status: r.status });
      out.set(r.institutionId, list);
    }
    return out;
  }

  /** One institution, with its timeline and the deposits behind it. Staff, or the institution itself. */
  async forInstitution(user: AuthUser, id: string) {
    if (isInstitution(user) && user.institutionId !== id) throw new ForbiddenException('You can only view your own institution.');
    const inst = await this.prisma.institution.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException('Institution not found.');
    const today = await this.clock.today();
    const items = (await this.itemsFor([id])).get(id) ?? [];
    const result = computeCoverage(inst.requiredDeposit, items, today);
    return {
      institution: { id: inst.id, name: inst.name, city: inst.city, state: inst.state, requiredDeposit: inst.requiredDeposit },
      ...result,
      instruments: items
        .slice()
        .sort((a, b) => a.maturity.getTime() - b.maturity.getTime())
        .map((i) => ({ id: i.id, fdrNumber: i.fdrNumber, amount: i.amount, issueDate: isoDate(i.issue), maturityDate: isoDate(i.maturity), status: i.status })),
    };
  }

  /** Every institution that has a requirement, most urgent first. Staff only. */
  async overview(opts: { status?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const today = await this.clock.today();
    const where: Prisma.InstitutionWhereInput = {
      requiredDeposit: { not: null },
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' } }, { state: { contains: opts.q, mode: 'insensitive' } }, { city: { contains: opts.q, mode: 'insensitive' } }] } : {}),
    };
    const [insts, notSet] = await Promise.all([
      this.prisma.institution.findMany({ where, select: { id: true, name: true, city: true, state: true, requiredDeposit: true } }),
      this.prisma.institution.count({ where: { requiredDeposit: null } }),
    ]);
    const items = await this.itemsFor(insts.map((i) => i.id));
    const rows: CoverageRow[] = insts.map((i) => ({ institutionId: i.id, name: i.name, city: i.city, state: i.state, ...computeCoverage(i.requiredDeposit, items.get(i.id) ?? [], today) }));
    const counts: Record<CoverageStatus, number> = { SHORTFALL: 0, AT_RISK: 0, WATCH: 0, OK: 0, NOT_SET: notSet };
    for (const r of rows) counts[r.status]++;
    const filtered = opts.status ? rows.filter((r) => r.status === opts.status) : rows;
    filtered.sort((a, b) => COVERAGE_ORDER[a.status] - COVERAGE_ORDER[b.status] || (a.firstGap?.daysAway ?? 9999) - (b.firstGap?.daysAway ?? 9999) || b.shortfallNow - a.shortfallNow || a.name.localeCompare(b.name));
    const pageSize = Math.min(20000, Math.max(1, opts.pageSize ?? 15));
    const page = Math.max(1, opts.page ?? 1);
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, counts };
  }
}
