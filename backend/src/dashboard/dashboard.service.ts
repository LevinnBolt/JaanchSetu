import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { AuthUser, hasRole, isInstitution } from '../auth/auth.types';
import { BANK_CONFIRMED, scopeWhere } from '../fdrs/filters';
import { addDays, daysBetween, isoDate } from '../domain/dates';
import { HELD_STATUSES, RADAR_WATCHED } from '../domain/state-machine';
import { assertCanDecide } from '../domain/maker-checker';
import { CoverageService } from '../coverage/coverage.service';

export interface QueueItem {
  fdrId: string;
  fdrNumber: string | null;
  institutionName: string;
  status: string;
  maturityDate: string | null;
  daysToMaturity: number | null;
  note: string;
  blocked?: string | null;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private clock: ClockService, private coverage: CoverageService) {}

  async summary(user: AuthUser) {
    const today = await this.clock.today();
    const scope = scopeWhere(user);
    const count = (where: Prisma.FdrWhereInput) => this.prisma.fdr.count({ where: { AND: [scope, where] } });

    const [active, expiring90, matured, renewal, release, overdue, openDiscrepancies, pendingVerification, bankConfirmed, totalInstitutions, totalFdrs] = await Promise.all([
      count({ status: { in: ['ACCEPTED', 'EXPIRING_SOON'] } }),
      count({ status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'RENEWAL_PENDING'] }, maturityDate: { gte: today, lte: addDays(today, 90) } }),
      count({ status: 'MATURED' }),
      count({ status: 'RENEWAL_PENDING' }),
      count({ status: { in: ['RELEASE_REQUESTED', 'RELEASE_RECOMMENDED'] } }),
      count({ reminders: { some: { suppressed: false, ackedAt: null, level: { gte: 1 } } } }),
      this.prisma.discrepancy.count({ where: { status: 'OPEN', fdr: scope } }),
      count({ status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'] } }),
      count(BANK_CONFIRMED),
      this.prisma.institution.count({ where: user.institutionId && Object.keys(scope).length ? { id: user.institutionId } : {} }),
      count({ status: { not: 'DRAFT' } }),
    ]);
    const recentAlerts = (await this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 6 })).map((n) => ({
      id: n.id, kind: n.kind, title: n.title, fdrId: n.fdrId, createdAt: n.createdAt.toISOString(), unread: !n.readAt,
    }));

    // 12-month maturity timeline starting with the current (demo) month
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 12, 1));
    const held = await this.prisma.fdr.findMany({
      where: { AND: [scope, { status: { in: HELD_STATUSES as any }, maturityDate: { lt: end } }] },
      select: { maturityDate: true, amount: true },
    });
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), count: 0, amount: 0 };
    });
    let earlier = 0;
    for (const f of held) {
      if (!f.maturityDate) continue;
      if (f.maturityDate < start) {
        earlier++;
        continue;
      }
      const m = months.find((x) => x.key === f.maturityDate!.toISOString().slice(0, 7));
      if (m) {
        m.count++;
        m.amount += f.amount ?? 0;
      }
    }

    const byStatusRows = await this.prisma.fdr.groupBy({ by: ['status'], where: scope, _count: { _all: true } });
    const upcomingRows = await this.prisma.fdr.findMany({
      where: { AND: [scope, { status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'] }, maturityDate: { lte: addDays(today, 90) } }] },
      include: { institution: true },
      orderBy: { maturityDate: 'asc' },
      take: 8,
    });

    // Coverage Guard: officers see how many institutions are short or about to be; an institution sees its own cover.
    let coverageSummary: { shortfall: number; atRisk: number; watch: number; notSet: number } | null = null;
    let myCoverage: unknown = null;
    if (user.institutionId && isInstitution(user)) {
      const c = await this.coverage.forInstitution(user, user.institutionId);
      myCoverage = { status: c.status, required: c.required, heldNow: c.heldNow, shortfallNow: c.shortfallNow, firstGap: c.firstGap };
    } else {
      const c = (await this.coverage.overview({ pageSize: 1 })).counts;
      coverageSummary = { shortfall: c.SHORTFALL, atRisk: c.AT_RISK, watch: c.WATCH, notSet: c.NOT_SET };
    }
    return {
      today: isoDate(today),
      coverage: coverageSummary,
      myCoverage,
      byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r._count._all])),
      upcoming: upcomingRows.map((f) => this.item(f, today, '')),
      cards: { totalInstitutions, totalFdrs, active, pendingVerification, bankConfirmed, expiring90, matured, renewalPending: renewal, releasePending: release, openDiscrepancies, overdue },
      recentAlerts,
      timeline: months,
      maturedBeforeThisMonth: earlier,
      queues: await this.queues(user, today),
    };
  }

  private item(f: { id: string; fdrNumber: string | null; status: string; maturityDate: Date | null; institution: { name: string } }, today: Date, note: string, blocked?: string | null): QueueItem {
    return {
      fdrId: f.id,
      fdrNumber: f.fdrNumber,
      institutionName: f.institution.name,
      status: f.status,
      maturityDate: isoDate(f.maturityDate),
      daysToMaturity: f.maturityDate ? daysBetween(today, f.maturityDate) : null,
      note,
      blocked,
    };
  }

  private async queues(user: AuthUser, today: Date) {
    const scope = scopeWhere(user);
    const out: { scrutiny?: QueueItem[]; approval?: QueueItem[]; overdue: QueueItem[] } = { overdue: [] };

    if (hasRole(user, 'SCRUTINY')) {
      const fdrs = await this.prisma.fdr.findMany({
        where: { status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'RELEASE_REQUESTED'] } },
        include: { institution: true },
        orderBy: { updatedAt: 'asc' },
        take: 25,
      });
      const note = (s: string) =>
        s === 'SUBMITTED' ? 'Newly submitted: start scrutiny' : s === 'UNDER_SCRUTINY' ? 'Confirm or correct extracted values' : s === 'DISCREPANCY_RAISED' ? 'Resolve or waive open discrepancies' : 'Release requested: complete checklist and recommend';
      out.scrutiny = fdrs.map((f) => this.item(f, today, note(f.status)));
    }

    if (hasRole(user, 'APPROVER')) {
      const rrs = await this.prisma.releaseRequest.findMany({
        where: { status: 'RECOMMENDED' },
        include: { fdr: { include: { institution: true } } },
        orderBy: { recommendedAt: 'asc' },
        take: 25,
      });
      out.approval = rrs.map((r) => {
        let blocked: string | null = null;
        try {
          assertCanDecide(user.id, { requesterId: r.requestedById, fdrCreatorId: r.fdr.createdById, makerId: r.makerId });
        } catch (e) {
          blocked = (e as Error).message;
        }
        return this.item(r.fdr, today, `Release recommended by ${r.makerName}: approve or reject`, blocked);
      });
    }

    // "My overdue items": unacknowledged reminders that have reached (or should have been handled by) my level.
    const minLevel = hasRole(user, 'INSTITUTION') && !hasRole(user, 'SCRUTINY', 'APPROVER', 'ADMIN') ? 0 : hasRole(user, 'SCRUTINY', 'ADMIN') ? 1 : 2;
    const rems = await this.prisma.reminder.findMany({
      where: { suppressed: false, ackedAt: null, level: { gte: minLevel }, fdr: { AND: [scope, { status: { in: RADAR_WATCHED as any } }] } },
      include: { fdr: { include: { institution: true } } },
      orderBy: [{ level: 'desc' }, { levelSince: 'asc' }],
      take: 50,
    });
    const seen = new Set<string>();
    for (const r of rems) {
      if (seen.has(r.fdrId)) continue;
      seen.add(r.fdrId);
      const lvl = ['institution', 'scrutiny officer', 'approving officer'][r.level];
      out.overdue.push(this.item(r.fdr, today, `${r.thresholdDays}-day reminder unacknowledged, now with the ${lvl}`));
    }
    return out;
  }

  // ---- institution-wise view (paged and aggregated in the database, so it holds at thousands of institutions)

  private instScope(user: AuthUser): Prisma.InstitutionWhereInput {
    const scope = scopeWhere(user);
    return user.institutionId && Object.keys(scope).length ? { id: user.institutionId } : {};
  }

  private async instStats(ids: string[]) {
    if (!ids.length) return new Map<string, { fdrCount: number; heldCount: number; totalDeposit: number; openDiscrepancies: number }>();
    const groups = await this.prisma.fdr.groupBy({ by: ['institutionId', 'status'], where: { institutionId: { in: ids } }, _count: { _all: true }, _sum: { amount: true } });
    const flags = await this.prisma.$queryRaw<{ institutionId: string; n: number }[]>`
      SELECT f."institutionId" AS "institutionId", COUNT(*)::int AS n FROM "Discrepancy" d JOIN "Fdr" f ON f.id = d."fdrId"
      WHERE d.status = 'OPEN' AND f."institutionId" = ANY(${ids}) GROUP BY 1`;
    const out = new Map<string, { fdrCount: number; heldCount: number; totalDeposit: number; openDiscrepancies: number }>();
    for (const id of ids) out.set(id, { fdrCount: 0, heldCount: 0, totalDeposit: 0, openDiscrepancies: 0 });
    for (const g of groups) {
      const o = out.get(g.institutionId)!;
      o.fdrCount += g._count._all;
      if ((HELD_STATUSES as string[]).includes(g.status)) {
        o.heldCount += g._count._all;
        o.totalDeposit += g._sum.amount ?? 0;
      }
    }
    for (const x of flags) out.get(x.institutionId)!.openDiscrepancies = x.n;
    return out;
  }

  async institutions(user: AuthUser, opts: { q?: string; page?: number; pageSize?: number } = {}) {
    const where: Prisma.InstitutionWhereInput = { AND: [this.instScope(user), opts.q ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' } }, { city: { contains: opts.q, mode: 'insensitive' } }, { state: { contains: opts.q, mode: 'insensitive' } }] } : {}] };
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 15));
    const page = Math.max(1, opts.page ?? 1);
    const scope = scopeWhere(user);
    const [total, rows, fdrTotal, held, flags] = await Promise.all([
      this.prisma.institution.count({ where }),
      this.prisma.institution.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.fdr.count({ where: scope }),
      this.prisma.fdr.aggregate({ where: { AND: [scope, { status: { in: HELD_STATUSES as any } }] }, _sum: { amount: true } }),
      this.prisma.discrepancy.count({ where: { status: 'OPEN', fdr: scope } }),
    ]);
    const stats = await this.instStats(rows.map((r) => r.id));
    return {
      items: rows.map((i) => ({ id: i.id, name: i.name, city: i.city, state: i.state, ...stats.get(i.id)! })),
      total,
      page,
      pageSize,
      totals: { institutions: await this.prisma.institution.count({ where: this.instScope(user) }), fdrs: fdrTotal, depositHeld: held._sum.amount ?? 0, openDiscrepancies: flags },
    };
  }

  async institutionSummary(user: AuthUser, id: string) {
    const i = await this.prisma.institution.findFirst({ where: { AND: [this.instScope(user), { id }] } });
    if (!i) return null;
    const stats = await this.instStats([id]);
    return { id: i.id, name: i.name, city: i.city, state: i.state, ...stats.get(id)! };
  }

  // ---- measured impact: figures computed from this system's own records

  async impact() {
    const [turn] = await this.prisma.$queryRaw<{ n: number; avg_days: number | null; median_days: number | null }[]>`
      SELECT COUNT(*)::int AS n,
             AVG(EXTRACT(EPOCH FROM (d.at - s.at)) / 86400.0)::float8 AS avg_days,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.at - s.at)) / 86400.0))::float8 AS median_days
      FROM (SELECT "fdrId", MIN(at) AS at FROM "FdrTransition" WHERE "toStatus" = 'SUBMITTED' GROUP BY "fdrId") s
      JOIN (SELECT "fdrId", MIN(at) AS at FROM "FdrTransition" WHERE "toStatus" IN ('ACCEPTED', 'REJECTED') GROUP BY "fdrId") d ON d."fdrId" = s."fdrId"
      WHERE d.at >= s.at`;
    const [pend] = await this.prisma.$queryRaw<{ n: number; avg_age: number | null; oldest: number | null }[]>`
      SELECT COUNT(*)::int AS n,
             AVG(EXTRACT(EPOCH FROM (NOW() - s.at)) / 86400.0)::float8 AS avg_age,
             MAX(EXTRACT(EPOCH FROM (NOW() - s.at)) / 86400.0)::float8 AS oldest
      FROM "Fdr" f JOIN (SELECT "fdrId", MIN(at) AS at FROM "FdrTransition" WHERE "toStatus" = 'SUBMITTED' GROUP BY "fdrId") s ON s."fdrId" = f.id
      WHERE f.status IN ('SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED')`;
    const today = await this.clock.today();
    const [submitted, withFlags, flagged, auto, corrected, extracted, reviewed, remindersSent, acked, escalated, emails, systemActs, bankChecks, soon, soonCovered] = await Promise.all([
      this.prisma.fdr.count({ where: { status: { not: 'DRAFT' } } }),
      this.prisma.fdr.count({ where: { status: { not: 'DRAFT' }, discrepancies: { some: {} } } }),
      this.prisma.discrepancy.count(),
      this.prisma.discrepancy.count({ where: { raisedByLabel: 'Automatic check' } }),
      this.prisma.fdrField.count({ where: { reviewAction: 'CORRECTED' } }),
      this.prisma.fdrField.count({ where: { extractedValue: { not: null } } }),
      this.prisma.fdrField.count({ where: { extractedValue: { not: null }, reviewAction: { not: null } } }),
      this.prisma.reminder.count({ where: { suppressed: false } }),
      this.prisma.reminder.count({ where: { suppressed: false, ackedAt: { not: null } } }),
      this.prisma.escalationEvent.count(),
      this.prisma.emailLog.count(),
      this.prisma.auditLog.count({ where: { actorRole: 'SYSTEM' } }),
      this.prisma.auditLog.count({ where: { action: { in: ['BANK_CHECK_SIMULATED', 'BANK_CHECK_EXTERNAL'] } } }),
      this.prisma.fdr.count({ where: { status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'RENEWAL_PENDING'] }, maturityDate: { gte: today, lte: addDays(today, 90) } } }),
      this.prisma.fdr.count({ where: { status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'RENEWAL_PENDING'] }, maturityDate: { gte: today, lte: addDays(today, 90) }, reminders: { some: { suppressed: false } } } }),
    ]);
    const [rightFirst, preflightRuns] = await Promise.all([
      this.prisma.fdr.count({ where: { status: { not: 'DRAFT' }, discrepancies: { none: { raisedByLabel: 'Automatic check' } } } }),
      this.prisma.$queryRaw<{ runs: number; diffs: number }[]>`SELECT COUNT(*)::int AS runs, COALESCE(SUM((detail->>'differences')::int), 0)::int AS diffs FROM "AuditLog" WHERE action = 'PREFLIGHT_RUN'`,
    ]);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
    const r1 = (n: number | null) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
    return {
      basis: 'Computed live from this system\'s own records. In this prototype those records are demo data, so these figures show what the portal measures, not a real before-and-after study.',
      groups: [
        { key: 'accuracy', title: 'Record accuracy', items: [
          { label: 'Discrepancies flagged automatically', value: auto, unit: '', note: `of ${flagged} flags in total, across ${withFlags} of ${submitted} submitted FDRs (${pct(withFlags, submitted) ?? 0}%)` },
          { label: 'Submitted right the first time', value: pct(rightFirst, submitted), unit: '%', note: `${rightFirst} of ${submitted} submitted FDRs raised no automatic flag` },
          { label: 'Pre-flight checks run before submitting', value: preflightRuns[0]?.runs ?? 0, unit: '', note: `${preflightRuns[0]?.diffs ?? 0} difference(s) between scan and typed values shown to institutions before they submitted` },
          { label: 'OCR readings confirmed by an officer', value: pct(reviewed, extracted), unit: '%', note: `${reviewed} of ${extracted} extracted values reviewed` },
          { label: 'Values corrected by an officer', value: corrected, unit: '', note: 'Typing or OCR errors caught before acceptance' },
        ] },
        { key: 'turnaround', title: 'Verification turnaround', items: [
          { label: 'Average time to a scrutiny decision', value: r1(turn?.avg_days ?? null), unit: ' days', note: `median ${r1(turn?.median_days ?? null) ?? 'n/a'} days, over ${turn?.n ?? 0} decided FDRs` },
          { label: 'Waiting for verification now', value: pend?.n ?? 0, unit: '', note: pend?.n ? `average age ${r1(pend.avg_age)} days, oldest ${r1(pend.oldest)} days` : 'Nothing is waiting' },
        ] },
        { key: 'timely', title: 'Timely renewal monitoring', items: [
          { label: 'Maturing in 90 days with a reminder sent', value: pct(soonCovered, soon), unit: '%', note: `${soonCovered} of ${soon} deposits` },
          { label: 'Reminders acknowledged', value: pct(acked, remindersSent), unit: '%', note: `${acked} of ${remindersSent} reminders; ${escalated} escalations raised` },
        ] },
        { key: 'manual', title: 'Manual tracking effort', items: [
          { label: 'Actions done automatically by the system', value: systemActs, unit: '', note: 'Status changes and reminders that would otherwise be tracked by hand' },
          { label: 'Bank checks run from the portal', value: bankChecks, unit: '', note: 'No separate correspondence needed' },
          { label: 'Reminder emails recorded', value: emails, unit: '', note: 'Every one is kept in Admin > Email outbox' },
        ] },
      ],
    };
  }
}
