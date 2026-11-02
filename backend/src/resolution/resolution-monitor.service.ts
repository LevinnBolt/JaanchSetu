import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { NotifyService } from '../infra/notify.service';
import { AuditService, SYSTEM_ACTOR } from '../infra/audit.service';
import { daysBetween, istMidnightUtc } from '../domain/dates';
import { ACTIVE_STATES, UNRESOLVED_FDR_STATUSES, milestonesReached } from '../domain/resolution';

/**
 * Post-maturity monitoring, run by the Maturity Radar. For every deposit that matured and still has no
 * completed disposition, the highest milestone reached (1, 7 or 30 days past maturity) is announced once:
 * a MilestoneNotice row is unique per FDR and milestone, so re-running the radar never repeats a notice.
 * Deadlines on cases are announced once too. These are proposed operating defaults, not statutory deadlines.
 */
@Injectable()
export class ResolutionMonitorService {
  private log = new Logger('ResolutionMonitor');
  constructor(private prisma: PrismaService, private clock: ClockService, private notify: NotifyService, private audit: AuditService) {}

  /** Returns how many new notices were sent. */
  async run(): Promise<number> {
    const today = istMidnightUtc(await this.clock.today());
    let sent = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.fdr.findMany({
        where: { status: { in: UNRESOLVED_FDR_STATUSES as any }, maturityDate: { lt: today } },
        select: { id: true, fdrNumber: true, institutionId: true, maturityDate: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      for (const f of batch) {
        const days = daysBetween(f.maturityDate!, today);
        const reached = milestonesReached(days);
        if (!reached.length) continue;
        // Make sure every reached milestone is recorded, but only announce the highest new one.
        let announce: (typeof reached)[number] | null = null;
        for (const m of [...reached].reverse()) {
          const made = await this.prisma.milestoneNotice.createMany({ data: [{ fdrId: f.id, milestone: m.key }], skipDuplicates: true });
          if (made.count === 1) announce = m;
        }
        if (!announce) continue;
        const level = announce.days >= 30 ? 3 : announce.days >= 7 ? 2 : 1;
        const to = level === 1 ? await this.notify.recipientsForLevel(1, f.institutionId) : await this.notify.recipientsForLevel(2, f.institutionId);
        const extra = level === 3 ? await this.notify.recipientsForLevel(1, f.institutionId) : [];
        await this.notify.notify([...to, ...extra], { kind: 'MATURITY', title: `${announce.label}: FDR ${f.fdrNumber}`, body: `FDR ${f.fdrNumber} matured ${days} day(s) ago and has no completed renewal or release. Open the Resolution panel to act.`, fdrId: f.id });
        sent++;
      }
      cursor = batch[batch.length - 1].id;
    }
    // Case deadlines: one notice per case.
    const late = await this.prisma.resolutionCase.findMany({ where: { state: { in: ACTIVE_STATES as any }, dueDate: { lt: today } }, include: { fdr: { select: { fdrNumber: true, institutionId: true } } } });
    for (const c of late) {
      const made = await this.prisma.milestoneNotice.createMany({ data: [{ fdrId: c.fdrId, milestone: `DUE:${c.id}` }], skipDuplicates: true });
      if (made.count !== 1) continue;
      const to = c.assignedToId ? await this.prisma.user.findMany({ where: { id: c.assignedToId, active: true } }) : await this.notify.recipientsForLevel(1, c.fdr.institutionId);
      await this.notify.notify(to, { kind: 'RESOLUTION', title: `Case deadline missed: ${c.caseNo}`, body: `The deadline for case ${c.caseNo} (FDR ${c.fdr.fdrNumber}) has passed and it is still ${c.state}.`, fdrId: c.fdrId });
      sent++;
    }
    if (sent) await this.audit.log({ actor: SYSTEM_ACTOR, action: 'RESOLUTION_MONITOR_RUN', entityType: 'System', detail: { notices: sent } });
    this.log.log(`${sent} post-maturity notice(s) sent`);
    return sent;
  }
}
