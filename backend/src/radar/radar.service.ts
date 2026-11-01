import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { LifecycleService } from '../infra/lifecycle.service';
import { NotifyService } from '../infra/notify.service';
import { AuditService, Actor, SYSTEM_ACTOR } from '../infra/audit.service';
import { addDays, daysBetween, istDateString } from '../domain/dates';
import { RADAR_DERIVED, RADAR_WATCHED, FdrStatusName, radarTarget } from '../domain/state-machine';
import { Prisma, Role } from '@prisma/client';

export const DEFAULT_REMINDER_DAYS = [90, 60, 30, 7];
export const DEFAULT_ESCALATION_DAYS = 7;
const LEVEL_ROLE: Role[] = ['INSTITUTION', 'SCRUTINY', 'APPROVER'];
const LEVEL_LABEL = ['institution', 'scrutiny officer', 'approving officer'];

/** Everything a run needs, read once so a pass over thousands of FDRs does not repeat these queries per FDR. */
interface RunContext {
  reminderDays: number[];
  escalationDays: number;
  today: Date;
  now: Date;
  /** Recipients per escalation level (level 0 is per institution), filled on first use. */
  recipients: Map<string, { id: string; email: string }[]>;
}
type FdrWithRelations = Prisma.FdrGetPayload<{ include: { institution: true; reminders: true } }>;

export interface RadarSummary {
  date: string;
  checked: number;
  statusChanges: number;
  remindersSent: number;
  escalations: number;
}

/**
 * Maturity Radar: derives EXPIRING_SOON / MATURED from maturity dates, sends reminders at the
 * configured thresholds, and escalates unacknowledged reminders institution -> scrutiny -> approver.
 * Runs daily from the BullMQ scheduler, and immediately whenever the demo clock changes.
 */
@Injectable()
export class RadarService {
  private log = new Logger('Radar');

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private lifecycle: LifecycleService,
    private notify: NotifyService,
    private audit: AuditService,
  ) {}

  async settings() {
    const rules = (await this.prisma.reminderRule.findMany({ orderBy: { days: 'desc' } })).map((r) => r.days);
    const esc = await this.prisma.setting.findUnique({ where: { key: 'escalationDays' } });
    return { reminderDays: rules.length ? rules : DEFAULT_REMINDER_DAYS, escalationDays: esc ? Number(esc.value) : DEFAULT_ESCALATION_DAYS };
  }

  private async context(): Promise<RunContext> {
    const { reminderDays, escalationDays } = await this.settings();
    return { reminderDays, escalationDays, today: await this.clock.today(), now: await this.clock.now(), recipients: new Map() };
  }

  private async recipients(ctx: RunContext, level: number, institutionId: string) {
    const key = level === 0 ? `0:${institutionId}` : String(level);
    let r = ctx.recipients.get(key);
    if (!r) {
      r = await this.notify.recipientsForLevel(level, institutionId);
      ctx.recipients.set(key, r);
    }
    return r;
  }

  async run(actor: Actor = SYSTEM_ACTOR): Promise<RadarSummary> {
    const ctx = await this.context();
    const summary: RadarSummary = { date: istDateString(ctx.today), checked: 0, statusChanges: 0, remindersSent: 0, escalations: 0 };
    // Walk the watched FDRs in id order, 500 at a time, so memory stays flat at any size.
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.fdr.findMany({
        where: { status: { in: RADAR_WATCHED }, maturityDate: { not: null } },
        include: { institution: true, reminders: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      for (const f of batch) {
        summary.checked++;
        await this.processFdr(f, ctx, summary);
      }
      cursor = batch[batch.length - 1].id;
    }
    await this.escalate(ctx, summary);
    await this.audit.log({ actor, action: 'RADAR_RUN', entityType: 'System', detail: { ...summary } });
    this.log.log(`Radar ${summary.date}: ${summary.checked} FDRs, ${summary.statusChanges} status changes, ${summary.remindersSent} reminders, ${summary.escalations} escalations`);
    return summary;
  }

  /** Status sync + reminders for one FDR (used right after an FDR is accepted). */
  async syncOne(fdrId: string) {
    const ctx = await this.context();
    const summary: RadarSummary = { date: istDateString(ctx.today), checked: 1, statusChanges: 0, remindersSent: 0, escalations: 0 };
    const fdr = await this.prisma.fdr.findUnique({ where: { id: fdrId }, include: { institution: true, reminders: true } });
    if (fdr) await this.processFdr(fdr, ctx, summary);
    return summary;
  }

  private async processFdr(fdr: FdrWithRelations, ctx: RunContext, summary: RadarSummary) {
    if (!fdr.maturityDate || !RADAR_WATCHED.includes(fdr.status as FdrStatusName)) return;
    const { reminderDays, today, now } = ctx;
    const days = daysBetween(today, fdr.maturityDate);

    if (RADAR_DERIVED.includes(fdr.status as FdrStatusName)) {
      const target = radarTarget(days, Math.max(...reminderDays));
      if (target !== fdr.status) {
        const note =
          target === 'MATURED' ? `Maturity date passed ${Math.abs(days)} day(s) ago` : target === 'EXPIRING_SOON' ? `Matures in ${days} day(s)` : 'More than the first reminder threshold from maturity';
        if (await this.lifecycle.tryTransition(fdr.id, target, SYSTEM_ACTOR, note)) summary.statusChanges++;
      }
    }

    const crossed = reminderDays.filter((t) => days <= t);
    if (!crossed.length) return;
    const tightest = Math.min(...crossed);
    for (const t of crossed) {
      if (fdr.reminders.some((e) => e.thresholdDays === t)) continue;
      // If the clock jumped past several thresholds at once, only the tightest one is sent.
      const suppressed = t !== tightest;
      const rem = await this.prisma.reminder.create({
        data: { fdrId: fdr.id, thresholdDays: t, suppressed, level: 0, createdAt: now, levelSince: now },
      });
      if (suppressed) continue;
      await this.prisma.escalationEvent.create({
        data: { reminderId: rem.id, fdrId: fdr.id, level: 0, toRole: 'INSTITUTION', at: now, note: `${t}-day reminder sent to ${fdr.institution.name}` },
      });
      const users = await this.recipients(ctx, 0, fdr.institutionId);
      await this.notify.notify(users, {
        kind: 'REMINDER',
        title: `FDR ${fdr.fdrNumber}: ${this.when(days)}`,
        body: `${t}-day maturity reminder for FDR ${fdr.fdrNumber} (${fdr.institution.name}). ${this.when(days)}. Please renew it or request its release, and acknowledge this reminder. If it is not acknowledged within the escalation period it will go to the scrutiny officer.`,
        fdrId: fdr.id,
        reminderId: rem.id,
      }, now);
      await this.audit.log({
        actor: SYSTEM_ACTOR,
        action: 'REMINDER_SENT',
        entityType: 'Reminder',
        entityId: rem.id,
        detail: { fdrId: fdr.id, fdrNumber: fdr.fdrNumber, thresholdDays: t, daysToMaturity: days, recipients: users.length },
      });
      summary.remindersSent++;
    }
  }

  private when(days: number) {
    return days < 0 ? `matured ${Math.abs(days)} day(s) ago` : days === 0 ? 'matures today' : `matures in ${days} day(s)`;
  }

  private async escalate(ctx: RunContext, summary: RadarSummary) {
    const { escalationDays, now } = ctx;
    const open = await this.prisma.reminder.findMany({
      where: { suppressed: false, ackedAt: null, level: { lt: 2 }, fdr: { status: { in: RADAR_WATCHED } } },
      include: { fdr: { include: { institution: true } } },
    });
    for (const r of open) {
      let level = r.level;
      let since = r.levelSince;
      while (level < 2 && now.getTime() >= addDays(since, escalationDays).getTime()) {
        level++;
        since = addDays(since, escalationDays);
        const toRole = LEVEL_ROLE[level];
        const note = `Not acknowledged within ${escalationDays} days: escalated to the ${LEVEL_LABEL[level]}`;
        await this.prisma.escalationEvent.create({ data: { reminderId: r.id, fdrId: r.fdrId, level, toRole, at: since, note } });
        const users = await this.recipients(ctx, level, r.fdr.institutionId);
        await this.notify.notify(users, {
          kind: 'ESCALATION',
          title: `ESCALATED: FDR ${r.fdr.fdrNumber} (${r.fdr.institution.name}) reminder unacknowledged`,
          body: `The ${r.thresholdDays}-day maturity reminder for FDR ${r.fdr.fdrNumber} of ${r.fdr.institution.name} was not acknowledged within ${escalationDays} days and has been escalated to you (${LEVEL_LABEL[level]}). Please follow up.`,
          fdrId: r.fdrId,
          reminderId: r.id,
        }, now);
        await this.audit.log({
          actor: SYSTEM_ACTOR,
          action: 'ESCALATION',
          entityType: 'Reminder',
          entityId: r.id,
          detail: { fdrId: r.fdrId, fdrNumber: r.fdr.fdrNumber, thresholdDays: r.thresholdDays, level, toRole },
        });
        summary.escalations++;
      }
      if (level !== r.level) await this.prisma.reminder.update({ where: { id: r.id }, data: { level, levelSince: since } });
    }
  }

  /**
   * Called when the demo clock moves backwards: forget reminders, escalations and notifications
   * that "happened in the future" so the demo can be replayed. The audit trail is never rewound.
   */
  async rewind(newNow: Date) {
    await this.prisma.notification.deleteMany({ where: { createdAt: { gt: newNow }, kind: { in: ['REMINDER', 'ESCALATION'] } } });
    await this.prisma.reminder.deleteMany({ where: { createdAt: { gt: newNow } } });
    await this.prisma.escalationEvent.deleteMany({ where: { at: { gt: newNow } } });
    const rems = await this.prisma.reminder.findMany({ include: { events: { orderBy: { level: 'asc' } } } });
    for (const r of rems) {
      const last = r.events[r.events.length - 1];
      const level = last ? last.level : 0;
      const levelSince = last ? last.at : r.createdAt;
      const unack = r.ackedAt && r.ackedAt > newNow;
      if (level !== r.level || unack || r.levelSince.getTime() !== levelSince.getTime()) {
        await this.prisma.reminder.update({
          where: { id: r.id },
          data: { level, levelSince, ...(unack ? { ackedAt: null, ackedById: null, ackedByName: null } : {}) },
        });
      }
    }
  }

  async acknowledge(reminderId: string, actor: Actor) {
    const r = await this.prisma.reminder.findUnique({ where: { id: reminderId }, include: { fdr: true } });
    if (!r) return null;
    if (r.ackedAt) return r;
    const updated = await this.prisma.reminder.update({
      where: { id: reminderId },
      data: { ackedAt: await this.clock.now(), ackedById: actor.id, ackedByName: actor.name },
    });
    await this.audit.log({
      actor,
      action: 'REMINDER_ACKNOWLEDGED',
      entityType: 'Reminder',
      entityId: reminderId,
      detail: { fdrId: r.fdrId, fdrNumber: r.fdr.fdrNumber, thresholdDays: r.thresholdDays, level: r.level },
    });
    return updated;
  }

  async acknowledgeAllForFdr(fdrId: string, actor: Actor) {
    const rems = await this.prisma.reminder.findMany({ where: { fdrId, ackedAt: null, suppressed: false } });
    for (const r of rems) await this.acknowledge(r.id, actor);
  }
}
