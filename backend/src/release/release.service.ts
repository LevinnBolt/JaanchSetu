import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../infra/audit.service';
import { LifecycleService } from '../infra/lifecycle.service';
import { NotifyService } from '../infra/notify.service';
import { RadarService } from '../radar/radar.service';
import { AuthUser, hasRole, toActor } from '../auth/auth.types';
import { FdrsService } from '../fdrs/fdrs.service';
import { OrdersService } from '../orders/orders.service';
import {
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  ChecklistItem,
  MakerCheckerError,
  assertCanDecide,
  assertCanRecommend,
  checklistProblems,
  emptyChecklist,
} from '../domain/maker-checker';

@Injectable()
export class ReleaseService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private lifecycle: LifecycleService,
    private notify: NotifyService,
    private radar: RadarService,
    private fdrs: FdrsService,
    private orders: OrdersService,
  ) {}

  private wrap<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof MakerCheckerError) throw new ForbiddenException(e.message);
      throw e;
    }
  }

  private async openDiscrepancies(fdrId: string) {
    return this.prisma.discrepancy.count({ where: { fdrId, status: 'OPEN' } });
  }

  private async load(id: string) {
    const rr = await this.prisma.releaseRequest.findUnique({ where: { id }, include: { fdr: true } });
    if (!rr) throw new NotFoundException('Release request not found');
    return rr;
  }

  async request(user: AuthUser, fdrId: string, reason: string) {
    const fdr = await this.fdrs.getAccessible(user, fdrId);
    if (!hasRole(user, 'INSTITUTION')) throw new ForbiddenException('Only the institution can request a release.');
    const open = await this.openDiscrepancies(fdrId);
    if (open) throw new BadRequestException(`Release is blocked: ${open} discrepancy flag(s) on this FDR are still Open.`);
    const actor = toActor(user);
    await this.lifecycle.transition(fdr.id, 'RELEASE_REQUESTED', actor, 'Release requested by institution');
    await this.radar.acknowledgeAllForFdr(fdr.id, actor);
    const rr = await this.prisma.releaseRequest.create({
      data: { fdrId, reason, requestedById: user.id, requestedByName: user.name, checklist: emptyChecklist() as any },
    });
    await this.audit.log({ actor, action: 'RELEASE_REQUESTED', entityType: 'ReleaseRequest', entityId: rr.id, detail: { fdrId, fdrNumber: fdr.fdrNumber, reason } });
    const scrutiny = await this.notify.recipientsForLevel(1, fdr.institutionId);
    await this.notify.notify(scrutiny, { kind: 'RELEASE', title: `Release requested: FDR ${fdr.fdrNumber}`, body: `${user.name} asked for the release of FDR ${fdr.fdrNumber}. Reason: ${reason}`, fdrId });
    return { id: rr.id };
  }

  async saveChecklist(user: AuthUser, id: string, items: ChecklistItem[]) {
    if (!hasRole(user, 'SCRUTINY')) throw new ForbiddenException('Only a scrutiny officer fills the checklist.');
    const rr = await this.load(id);
    if (rr.status !== 'REQUESTED') throw new BadRequestException('The checklist is locked once the request has been recommended.');
    this.wrap(() => assertCanRecommend(user.id, { requesterId: rr.requestedById, fdrCreatorId: rr.fdr.createdById, makerId: null }));
    const clean = CHECKLIST_KEYS.map((key) => {
      const it = items.find((i) => i.key === key);
      return { key, ticked: !!it?.ticked, note: (it?.note ?? '').slice(0, 300) };
    });
    const open = await this.openDiscrepancies(rr.fdrId);
    if (open && clean.find((c) => c.key === 'NO_OPEN_DISCREPANCIES')!.ticked) {
      throw new BadRequestException(`"${CHECKLIST_LABELS.NO_OPEN_DISCREPANCIES}" cannot be ticked: ${open} discrepancy flag(s) are Open.`);
    }
    await this.prisma.releaseRequest.update({ where: { id }, data: { checklist: clean as any } });
    await this.audit.log({ actor: toActor(user), action: 'RELEASE_CHECKLIST_SAVED', entityType: 'ReleaseRequest', entityId: id, detail: { fdrId: rr.fdrId, checklist: clean } });
    return { id };
  }

  async recommend(user: AuthUser, id: string, note: string) {
    if (!hasRole(user, 'SCRUTINY')) throw new ForbiddenException('Only a scrutiny officer (the maker) can recommend a release.');
    const rr = await this.load(id);
    if (rr.status !== 'REQUESTED') throw new BadRequestException(`This request is already ${rr.status}.`);
    this.wrap(() => assertCanRecommend(user.id, { requesterId: rr.requestedById, fdrCreatorId: rr.fdr.createdById, makerId: null }));
    const open = await this.openDiscrepancies(rr.fdrId);
    if (open) throw new BadRequestException(`Release is blocked: ${open} discrepancy flag(s) are still Open.`);
    const problems = checklistProblems(rr.checklist as unknown as ChecklistItem[]);
    if (problems.length) throw new BadRequestException(`Complete the checklist first. ${problems.join(' ')}`);
    const actor = toActor(user);
    await this.lifecycle.transition(rr.fdrId, 'RELEASE_RECOMMENDED', actor, 'Release recommended by scrutiny officer (maker)');
    await this.prisma.releaseRequest.update({
      where: { id },
      data: { status: 'RECOMMENDED', makerId: user.id, makerName: user.name, makerNote: note, recommendedAt: new Date() },
    });
    await this.audit.log({ actor, action: 'RELEASE_RECOMMENDED', entityType: 'ReleaseRequest', entityId: id, detail: { fdrId: rr.fdrId, fdrNumber: rr.fdr.fdrNumber, note, maker: user.email } });
    const approvers = await this.notify.recipientsForLevel(2, rr.fdr.institutionId);
    await this.notify.notify(approvers.filter((a) => a.id !== user.id), {
      kind: 'RELEASE',
      title: `Needs your approval: release of FDR ${rr.fdr.fdrNumber}`,
      body: `${user.name} recommended the release of FDR ${rr.fdr.fdrNumber}. Please approve or reject it.`,
      fdrId: rr.fdrId,
    });
    return { id };
  }

  async decide(user: AuthUser, id: string, approve: boolean, reason: string) {
    if (!hasRole(user, 'APPROVER')) throw new ForbiddenException('Only an approving officer (the checker) can decide a release.');
    const rr = await this.load(id);
    if (rr.status !== 'RECOMMENDED') throw new BadRequestException(`This request is ${rr.status}; only a RECOMMENDED request can be decided.`);
    // Enforced here on the server, whatever the UI shows.
    this.wrap(() => assertCanDecide(user.id, { requesterId: rr.requestedById, fdrCreatorId: rr.fdr.createdById, makerId: rr.makerId }));
    const actor = toActor(user);
    if (approve) {
      const open = await this.openDiscrepancies(rr.fdrId);
      if (open) throw new BadRequestException(`Release is blocked: ${open} discrepancy flag(s) are Open.`);
      await this.lifecycle.transition(rr.fdrId, 'RELEASED', actor, `Release approved: ${reason}`);
    } else {
      await this.lifecycle.transition(rr.fdrId, 'ACCEPTED', actor, `Release rejected: ${reason}`);
    }
    await this.prisma.releaseRequest.update({
      where: { id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', checkerId: user.id, checkerName: user.name, decisionReason: reason, decidedAt: new Date() },
    });
    await this.audit.log({
      actor,
      action: approve ? 'RELEASE_APPROVED' : 'RELEASE_REJECTED',
      entityType: 'ReleaseRequest',
      entityId: id,
      detail: { fdrId: rr.fdrId, fdrNumber: rr.fdr.fdrNumber, reason, maker: rr.makerName, checker: user.email },
    });
    let orderNo: string | undefined;
    if (approve) orderNo = (await this.orders.issue(id, actor)).orderNo;
    else await this.radar.syncOne(rr.fdrId);
    return { id, status: approve ? 'APPROVED' : 'REJECTED', orderNo };
  }

  async viewsForFdr(user: AuthUser, fdrId: string) {
    const rrs = await this.prisma.releaseRequest.findMany({ where: { fdrId }, orderBy: { requestedAt: 'desc' } });
    const orders = rrs.length ? await this.prisma.releaseOrder.findMany({ where: { releaseRequestId: { in: rrs.map((r) => r.id) } }, select: { releaseRequestId: true, orderNo: true } }) : [];
    const fdr = await this.prisma.fdr.findUniqueOrThrow({ where: { id: fdrId } });
    const open = await this.openDiscrepancies(fdrId);
    return rrs.map((r) => {
      const ctx = { requesterId: r.requestedById, fdrCreatorId: fdr.createdById, makerId: r.makerId };
      let canDecide = false;
      let decideBlockedReason: string | null = null;
      if (r.status === 'RECOMMENDED' && hasRole(user, 'APPROVER')) {
        try {
          assertCanDecide(user.id, ctx);
          canDecide = true;
        } catch (e) {
          decideBlockedReason = (e as Error).message;
        }
      }
      let canRecommend = false;
      let recommendBlockedReason: string | null = null;
      if (r.status === 'REQUESTED' && hasRole(user, 'SCRUTINY')) {
        try {
          assertCanRecommend(user.id, ctx);
          canRecommend = true;
        } catch (e) {
          recommendBlockedReason = (e as Error).message;
        }
      }
      return {
        id: r.id,
        orderNo: orders.find((o) => o.releaseRequestId === r.id)?.orderNo ?? null,
        status: r.status,
        reason: r.reason,
        requestedByName: r.requestedByName,
        requestedAt: r.requestedAt,
        checklist: (r.checklist as unknown as ChecklistItem[]).map((c) => ({ ...c, label: CHECKLIST_LABELS[c.key] })),
        makerName: r.makerName,
        makerNote: r.makerNote,
        recommendedAt: r.recommendedAt,
        checkerName: r.checkerName,
        decisionReason: r.decisionReason,
        decidedAt: r.decidedAt,
        openDiscrepancies: open,
        canEditChecklist: canRecommend,
        canRecommend,
        recommendBlockedReason,
        canDecide,
        decideBlockedReason,
      };
    });
  }
}
