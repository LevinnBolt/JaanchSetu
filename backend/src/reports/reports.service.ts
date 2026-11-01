import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { AuthUser } from '../auth/auth.types';
import { scopeWhere } from '../fdrs/filters';
import { DashboardService } from '../dashboard/dashboard.service';
import { CoverageService } from '../coverage/coverage.service';
import { isInstitution } from '../auth/auth.types';
import { addDays, daysBetween, isoDate } from '../domain/dates';

type Cell = string | number | null;
export interface ReportColumn { key: string; label: string; kind?: 'amount' | 'date' | 'link' | 'status' | 'days' }
export interface ReportDef { key: string; title: string; description: string; columns: ReportColumn[]; param?: { key: string; label: string; default: number; options: number[] } }
export interface ReportResult extends ReportDef { rows: Record<string, Cell>[]; total: number; page: number; pageSize: number; generatedAt: string; today: string }

const FDR_COLS: ReportColumn[] = [
  { key: 'fdrNumber', label: 'FDR number', kind: 'link' },
  { key: 'institution', label: 'Institution' },
  { key: 'bank', label: 'Bank' },
  { key: 'amount', label: 'Amount (INR)', kind: 'amount' },
];

export const REPORTS: ReportDef[] = [
  {
    key: 'pending-verifications',
    title: 'Pending verifications',
    description: 'FDRs submitted but not yet accepted or rejected, oldest first, with what is holding each one up.',
    columns: [...FDR_COLS, { key: 'status', label: 'Status', kind: 'status' }, { key: 'waiting', label: 'Days waiting', kind: 'days' }, { key: 'openFlags', label: 'Open flags' }, { key: 'next', label: 'What is needed' }],
  },
  {
    key: 'upcoming-maturities',
    title: 'Upcoming maturities',
    description: 'Deposits still held that mature soon, plus those already past maturity, soonest first.',
    param: { key: 'days', label: 'Within (days)', default: 90, options: [30, 60, 90, 180, 365] },
    columns: [...FDR_COLS, { key: 'maturityDate', label: 'Matures', kind: 'date' }, { key: 'daysLeft', label: 'Days left', kind: 'days' }, { key: 'status', label: 'Status', kind: 'status' }, { key: 'lastReminder', label: 'Last reminder' }],
  },
  {
    key: 'coverage-gaps',
    title: 'Coverage gaps',
    description: 'Institutions whose security deposit is below the requirement now, or will drop below it within a year, with the FDR that causes the gap.',
    columns: [
      { key: 'institution', label: 'Institution', kind: 'link' }, { key: 'state', label: 'State' },
      { key: 'required', label: 'Required (INR)', kind: 'amount' }, { key: 'held', label: 'Held now (INR)', kind: 'amount' }, { key: 'shortNow', label: 'Short now (INR)', kind: 'amount' },
      { key: 'gapDate', label: 'First gap', kind: 'date' }, { key: 'daysAway', label: 'Days to gap', kind: 'days' }, { key: 'cover', label: 'Cover' }, { key: 'cause', label: 'Caused by' },
    ],
  },
  {
    key: 'missing-documents',
    title: 'Missing documents',
    description: 'Active submissions with no document attached, or with an open "missing document" flag.',
    columns: [...FDR_COLS, { key: 'status', label: 'Status', kind: 'status' }, { key: 'documents', label: 'Documents attached' }, { key: 'flag', label: 'Open flag' }],
  },
  {
    key: 'needs-intervention',
    title: 'Cases needing intervention',
    description: 'Unanswered reminders, long-open discrepancies, matured deposits with no next step, and releases waiting for a decision.',
    columns: [...FDR_COLS, { key: 'reason', label: 'Why it needs attention' }, { key: 'since', label: 'Days', kind: 'days' }, { key: 'owner', label: 'Who should act' }],
  },
  {
    key: 'institution-summary',
    title: 'Institution summary',
    description: 'One row per institution: instruments on record, deposit held and open discrepancies.',
    columns: [{ key: 'institution', label: 'Institution', kind: 'link' }, { key: 'state', label: 'State' }, { key: 'fdrs', label: 'FDRs' }, { key: 'held', label: 'Held' }, { key: 'deposit', label: 'Deposit held (INR)', kind: 'amount' }, { key: 'openFlags', label: 'Open flags' }],
  },
];

const STALE_DISCREPANCY_DAYS = 7;
const RELEASE_WAIT_DAYS = 7;

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private clock: ClockService, private dash: DashboardService, private coverage: CoverageService) {}

  definitions() {
    return REPORTS.map(({ key, title, description, param }) => ({ key, title, description, param }));
  }

  async run(user: AuthUser, key: string, o: { page?: number; pageSize?: number; days?: number; all?: boolean }): Promise<ReportResult> {
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw new BadRequestException('Unknown report.');
    const today = await this.clock.today();
    const pageSize = o.all ? 20000 : Math.min(100, Math.max(1, o.pageSize ?? 15));
    const page = o.all ? 1 : Math.max(1, o.page ?? 1);
    const skip = (page - 1) * pageSize;
    const scope = scopeWhere(user);
    let out: { rows: Record<string, Cell>[]; total: number };
    switch (key) {
      case 'pending-verifications': out = await this.pending(scope, skip, pageSize); break;
      case 'upcoming-maturities': out = await this.upcoming(scope, today, Math.min(730, Math.max(1, o.days ?? def.param!.default)), skip, pageSize); break;
      case 'coverage-gaps': out = await this.coverageGaps(user, skip, pageSize, page); break;
      case 'missing-documents': out = await this.missingDocs(scope, skip, pageSize); break;
      case 'needs-intervention': out = await this.intervention(scope, today, skip, pageSize); break;
      default: out = await this.institutionSummary(user, skip, pageSize, page);
    }
    return { ...def, ...out, page, pageSize, generatedAt: new Date().toISOString(), today: isoDate(today)! };
  }

  /** The same report as CSV, every row. */
  async csv(user: AuthUser, key: string, o: { days?: number }): Promise<string> {
    const r = await this.run(user, key, { ...o, all: true });
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cols = r.columns.filter((c) => c.key !== 'id');
    const lines = [cols.map((c) => esc(c.label)).join(',')];
    for (const row of r.rows) lines.push(cols.map((c) => esc(row[c.key])).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ individual reports

  private base(f: { id: string; fdrNumber: string | null; bankName: string | null; amount: number | null; institution: { name: string } }) {
    return { id: f.id, fdrNumber: f.fdrNumber, institution: f.institution.name, bank: f.bankName, amount: f.amount };
  }

  /** First SUBMITTED time per FDR, for "days waiting". */
  private async submittedAt(ids: string[]) {
    const rows = ids.length ? await this.prisma.fdrTransition.findMany({ where: { fdrId: { in: ids }, toStatus: 'SUBMITTED' }, orderBy: { at: 'asc' }, select: { fdrId: true, at: true } }) : [];
    const m = new Map<string, Date>();
    for (const r of rows) if (!m.has(r.fdrId)) m.set(r.fdrId, r.at);
    return m;
  }

  private async pending(scope: Prisma.FdrWhereInput, skip: number, take: number) {
    const where: Prisma.FdrWhereInput = { AND: [scope, { status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'] } }] };
    const [total, rows] = await Promise.all([
      this.prisma.fdr.count({ where }),
      this.prisma.fdr.findMany({ where, include: { institution: true, discrepancies: { where: { status: 'OPEN' }, select: { id: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip, take }),
    ]);
    const since = await this.submittedAt(rows.map((r) => r.id));
    const now = Date.now();
    const next = (s: string) => (s === 'SUBMITTED' ? 'Start scrutiny' : s === 'UNDER_SCRUTINY' ? 'Confirm values, check with the bank, then accept' : 'Resolve or waive the open discrepancies');
    return {
      total,
      rows: rows.map((f) => ({ ...this.base(f), status: f.status, waiting: Math.max(0, Math.floor((now - (since.get(f.id) ?? f.createdAt).getTime()) / 86400000)), openFlags: f.discrepancies.length, next: next(f.status) })),
    };
  }

  private async upcoming(scope: Prisma.FdrWhereInput, today: Date, days: number, skip: number, take: number) {
    const where: Prisma.FdrWhereInput = { AND: [scope, { status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'] }, maturityDate: { lte: addDays(today, days) } }] };
    const [total, rows] = await Promise.all([
      this.prisma.fdr.count({ where }),
      this.prisma.fdr.findMany({ where, include: { institution: true, reminders: { where: { suppressed: false }, orderBy: { thresholdDays: 'asc' }, take: 1 } }, orderBy: [{ maturityDate: 'asc' }, { id: 'asc' }], skip, take }),
    ]);
    return {
      total,
      rows: rows.map((f) => ({
        ...this.base(f), maturityDate: isoDate(f.maturityDate), daysLeft: f.maturityDate ? daysBetween(today, f.maturityDate) : null, status: f.status,
        lastReminder: f.reminders[0] ? `${f.reminders[0].thresholdDays}-day reminder${f.reminders[0].ackedAt ? ' (acknowledged)' : f.reminders[0].level > 0 ? ' (escalated)' : ''}` : 'None yet',
      })),
    };
  }

  private async missingDocs(scope: Prisma.FdrWhereInput, skip: number, take: number) {
    const where: Prisma.FdrWhereInput = {
      AND: [scope, { status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED'] } },
        { OR: [{ documents: { none: {} } }, { discrepancies: { some: { type: 'MISSING_DOCUMENT', status: 'OPEN' } } }] }],
    };
    const [total, rows] = await Promise.all([
      this.prisma.fdr.count({ where }),
      this.prisma.fdr.findMany({ where, include: { institution: true, _count: { select: { documents: true } }, discrepancies: { where: { type: 'MISSING_DOCUMENT', status: 'OPEN' }, select: { id: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip, take }),
    ]);
    return { total, rows: rows.map((f) => ({ ...this.base(f), status: f.status, documents: f._count.documents, flag: f.discrepancies.length ? 'Missing document flag open' : f._count.documents === 0 ? 'No file attached' : '' })) };
  }

  private async intervention(scope: Prisma.FdrWhereInput, today: Date, skip: number, take: number) {
    const cap = 1000;
    const rows: (Record<string, Cell> & { sortDays: number })[] = [];
    const push = (f: any, reason: string, days: number, owner: string) => rows.push({ ...this.base(f), reason, since: days, owner, sortDays: days });
    const inst = { institution: true } as const;

    const rems = await this.prisma.reminder.findMany({
      where: { suppressed: false, ackedAt: null, level: { gte: 1 }, fdr: { AND: [scope, { status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'] } }] } },
      include: { fdr: { include: inst } }, orderBy: { levelSince: 'asc' }, take: cap,
    });
    const seen = new Set<string>();
    for (const r of rems) {
      if (seen.has(r.fdrId)) continue;
      seen.add(r.fdrId);
      push(r.fdr, `${r.thresholdDays}-day reminder not acknowledged and escalated`, daysBetween(r.levelSince, today), r.level >= 2 ? 'Approving officer' : 'Scrutiny officer');
    }

    const stale = await this.prisma.discrepancy.findMany({
      where: { status: 'OPEN', createdAt: { lte: new Date(today.getTime() - STALE_DISCREPANCY_DAYS * 86400000) }, fdr: scope },
      include: { fdr: { include: inst } }, orderBy: { createdAt: 'asc' }, take: cap,
    });
    const seenD = new Set<string>();
    for (const d of stale) {
      if (seenD.has(d.fdrId)) continue;
      seenD.add(d.fdrId);
      push(d.fdr, `Discrepancy open for over ${STALE_DISCREPANCY_DAYS} days`, daysBetween(d.createdAt, today), 'Scrutiny officer');
    }

    const matured = await this.prisma.fdr.findMany({ where: { AND: [scope, { status: 'MATURED' }] }, include: inst, orderBy: { maturityDate: 'asc' }, take: cap });
    for (const f of matured) push(f, 'Matured with no renewal or release started', f.maturityDate ? Math.abs(daysBetween(today, f.maturityDate)) : 0, 'Institution');

    const waiting = await this.prisma.releaseRequest.findMany({
      where: { status: 'RECOMMENDED', recommendedAt: { lte: new Date(today.getTime() - RELEASE_WAIT_DAYS * 86400000) }, fdr: scope },
      include: { fdr: { include: inst } }, orderBy: { recommendedAt: 'asc' }, take: cap,
    });
    for (const r of waiting) push(r.fdr, 'Release recommended and waiting for a decision', r.recommendedAt ? daysBetween(r.recommendedAt, today) : 0, 'Approving officer');

    rows.sort((a, b) => b.sortDays - a.sortDays);
    return { total: rows.length, rows: rows.slice(skip, skip + take).map(({ sortDays, ...r }) => r) };
  }

  private async coverageGaps(user: AuthUser, skip: number, take: number, page: number) {
    const label = { SHORTFALL: 'Short now', AT_RISK: 'At risk (within 90 days)', WATCH: 'Watch (within a year)', OK: 'Covered', NOT_SET: 'No requirement set' } as const;
    const toRow = (c: { institutionId: string; name: string; state: string; status: keyof typeof label; required: number | null; heldNow: number; shortfallNow: number; firstGap: { date: string; daysAway: number; causes: { fdrNumber: string | null }[] } | null }) => ({
      id: c.institutionId, institution: c.name, state: c.state, required: c.required, held: c.heldNow, shortNow: c.shortfallNow,
      gapDate: c.firstGap?.date ?? null, daysAway: c.firstGap?.daysAway ?? null, cover: label[c.status],
      cause: c.firstGap ? (c.firstGap.causes.length ? c.firstGap.causes.map((x) => x.fdrNumber).join(', ') : c.status === 'SHORTFALL' ? 'Held amount is below the requirement' : '') : '',
    });
    if (isInstitution(user)) {
      const c = user.institutionId ? await this.coverage.forInstitution(user, user.institutionId) : null;
      const rows = c && ['SHORTFALL', 'AT_RISK', 'WATCH'].includes(c.status) ? [toRow({ institutionId: c.institution.id, name: c.institution.name, state: c.institution.state, ...c })] : [];
      return { total: rows.length, rows };
    }
    const all: string[] = ['SHORTFALL', 'AT_RISK', 'WATCH'];
    const o = await this.coverage.overview({ pageSize: 20000 });
    const gaps = o.items.filter((i) => all.includes(i.status));
    return { total: gaps.length, rows: gaps.slice(skip, skip + take).map((i) => toRow(i)) };
  }

  private async institutionSummary(user: AuthUser, skip: number, take: number, page: number) {
    const r = await this.dash.institutions(user, { page, pageSize: take });
    return {
      total: r.total,
      rows: r.items.map((i) => ({ id: i.id, institution: i.name, state: i.state, fdrs: i.fdrCount, held: i.heldCount, deposit: i.totalDeposit, openFlags: i.openDiscrepancies })),
    };
  }
}
