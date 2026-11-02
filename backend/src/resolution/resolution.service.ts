import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../infra/audit.service';
import { ClockService } from '../infra/clock.service';
import { NotifyService } from '../infra/notify.service';
import { BankService } from '../infra/bank.service';
import { AuthUser, hasRole, isInstitution, toActor } from '../auth/auth.types';
import { scopeWhere } from '../fdrs/filters';
import { FIELD_KEYS } from '../domain/fields';
import { daysBetween, istMidnightUtc, utcMidnight } from '../domain/dates';
import {
  ACTIVE_STATES,
  CaseRuleError,
  CaseState,
  CaseTransitionError,
  CaseType,
  RESOLVABLE_FDR_STATUSES,
  UNRESOLVED_FDR_STATUSES,
  assertCanApprove,
  assertMove,
  blockers,
  caseNo,
  maturityBand,
  verificationChecks,
} from '../domain/resolution';

const EVIDENCE_KINDS = ['NOTE', 'DOCUMENT', 'BANK_LETTER', 'BOARD_RESOLUTION', 'OTHER'];

export interface CreateCaseInput {
  type: CaseType;
  delayReason: string;
  assignedToId?: string;
  dueDate?: string;
}

@Injectable()
export class ResolutionService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private clock: ClockService,
    private notify: NotifyService,
    private bank: BankService,
  ) {}

  /** One active case per FDR, enforced by the database itself (a partial unique index; db push cannot express it). */
  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ResolutionCase_one_active" ON "ResolutionCase"("fdrId") WHERE "state" NOT IN ('COMPLETED','REJECTED','CANCELLED')`,
    );
  }

  // ------------------------------------------------------------------ policy

  /** Whether approval needs every field to carry a bank answer. Admin can relax it; default is strict. */
  async requireBank(): Promise<boolean> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'resolutionRequireBank' } });
    return s ? s.value !== 'false' : true;
  }

  async setRequireBank(value: boolean, actor: ReturnType<typeof toActor>) {
    await this.prisma.setting.upsert({ where: { key: 'resolutionRequireBank' }, create: { key: 'resolutionRequireBank', value: String(value) }, update: { value: String(value) } });
    await this.audit.log({ actor, action: 'RESOLUTION_POLICY_CHANGED', entityType: 'Setting', entityId: 'resolutionRequireBank', detail: { requireBank: value } });
    return { requireBank: value };
  }

  // ------------------------------------------------------------------ access

  private async fdrFor(user: AuthUser, fdrId: string) {
    const fdr = await this.prisma.fdr.findFirst({ where: { id: fdrId, ...scopeWhere(user) } });
    if (!fdr) throw new NotFoundException('FDR not found');
    return fdr;
  }

  private async caseFor(user: AuthUser, id: string) {
    const c = await this.prisma.resolutionCase.findUnique({ where: { id }, include: { fdr: true } });
    if (!c) throw new NotFoundException('Resolution case not found');
    await this.fdrFor(user, c.fdrId);
    return c;
  }

  /** A refused action is logged too, then refused. */
  private async deny(user: AuthUser, action: string, caseId: string, message: string): Promise<never> {
    await this.audit.log({ actor: toActor(user), action: 'RESOLUTION_DENIED', entityType: 'ResolutionCase', entityId: caseId, detail: { attempted: action, reason: message } });
    throw new ForbiddenException(message);
  }

  private actorLabel(user: AuthUser) {
    return `${user.name} (${user.roles[0]})`;
  }

  // ------------------------------------------------------------------ maturity

  async maturity(user: AuthUser, fdrId: string) {
    const fdr = await this.fdrFor(user, fdrId);
    const today = await this.clock.today();
    const daysPast = fdr.maturityDate ? daysBetween(fdr.maturityDate, istMidnightUtc(today)) : null;
    const active = await this.prisma.resolutionCase.findFirst({ where: { fdrId, state: { in: ACTIVE_STATES as any } }, select: { id: true, caseNo: true, state: true, type: true } });
    const unresolved = UNRESOLVED_FDR_STATUSES.includes(fdr.status);
    const matured = daysPast !== null && daysPast >= 0;
    const band = daysPast === null ? null : maturityBand(daysPast);
    return {
      fdrId,
      financialStatus: fdr.status,
      maturityDate: fdr.maturityDate,
      daysPastMaturity: daysPast !== null && daysPast > 0 ? daysPast : 0,
      daysToMaturity: daysPast !== null && daysPast < 0 ? -daysPast : 0,
      matured,
      band,
      // Matured is a date fact; unresolved means no completed disposition. Overdue only means a set deadline was missed.
      pendingResolution: matured && unresolved,
      hasActiveCase: !!active,
      activeCase: active,
      canOpenCase: RESOLVABLE_FDR_STATUSES.includes(fdr.status) && !active,
    };
  }

  // ------------------------------------------------------------------ reads

  private async view(c: Awaited<ReturnType<ResolutionService['caseFor']>>, user: AuthUser) {
    const [evidence, approvals, events, fdrFull, fieldRows, openDisc, order] = await Promise.all([
      this.prisma.resolutionEvidence.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.resolutionApproval.findMany({ where: { caseId: c.id }, orderBy: { at: 'asc' } }),
      this.prisma.resolutionEvent.findMany({ where: { caseId: c.id }, orderBy: { at: 'asc' } }),
      this.prisma.fdr.findUniqueOrThrow({ where: { id: c.fdrId }, include: { documents: { select: { id: true } } } }),
      this.prisma.fdrField.findMany({ where: { fdrId: c.fdrId }, select: { key: true, bankValue: true } }),
      this.prisma.discrepancy.count({ where: { fdrId: c.fdrId, status: 'OPEN' } }),
      this.prisma.releaseOrder.findFirst({ where: { fdrId: c.fdrId }, select: { orderNo: true } }),
    ]);
    const requireBank = await this.requireBank();
    const checks = verificationChecks({
      type: c.type,
      hasDocument: fdrFull.documents.length > 0,
      openDiscrepancies: openDisc,
      bankFields: fieldRows.filter((f) => !!f.bankValue).length,
      totalFields: FIELD_KEYS.length,
      bankSimulated: this.bank.mode === 'simulation',
      requireBank,
    });
    const renewed = c.type === 'RENEWAL' ? await this.prisma.fdr.findFirst({ where: { previousFdrId: c.fdrId }, orderBy: { createdAt: 'desc' }, select: { id: true, fdrNumber: true, status: true } }) : null;
    const today = await this.clock.today();
    const overdue = !!c.dueDate && ACTIVE_STATES.includes(c.state as CaseState) && c.dueDate < istMidnightUtc(today);
    const staff = !isInstitution(user);
    let canApprove = false;
    let approveBlockedReason: string | null = null;
    if (c.state === 'APPROVAL_PENDING' && hasRole(user, 'APPROVER')) {
      try {
        assertCanApprove(user.id, c);
        canApprove = true;
      } catch (e) {
        approveBlockedReason = (e as Error).message;
      }
    }
    const open = ACTIVE_STATES.includes(c.state as CaseState);
    const owner = hasRole(user, 'INSTITUTION') && user.institutionId === c.fdr.institutionId;
    return {
      id: c.id,
      caseNo: c.caseNo,
      fdrId: c.fdrId,
      type: c.type,
      state: c.state,
      delayReason: c.delayReason,
      assignedToName: c.assignedToName,
      assignedToId: c.assignedToId,
      dueDate: c.dueDate,
      overdue,
      escalationLevel: c.escalationLevel,
      version: c.version,
      openedByName: c.openedByName,
      submittedByName: c.submittedByName,
      blockedReasons: (c.blockedReasons as string[] | null) ?? [],
      linkedFdrId: c.linkedFdrId,
      acknowledgment: c.acknowledgment,
      completedAt: c.completedAt,
      createdAt: c.createdAt,
      checks,
      requireBank,
      bankSimulated: this.bank.mode === 'simulation',
      bankFields: fieldRows.filter((f) => !!f.bankValue).length,
      totalFields: FIELD_KEYS.length,
      renewedFdr: renewed,
      orderNo: order?.orderNo ?? null,
      fdrStatus: c.fdr.status,
      evidence: evidence.map((e) => ({ id: e.id, kind: e.kind, note: e.note, documentId: e.documentId, by: e.addedByName, at: e.createdAt })),
      approvals: approvals.map((a) => ({ id: a.id, decision: a.decision, by: a.reviewerName, role: a.role, comment: a.comment, at: a.at })),
      events: events.map((e) => ({ id: e.id, event: e.event, from: e.fromState, to: e.toState, by: e.actorLabel, meta: e.meta, at: e.at })),
      can: {
        addEvidence: open && (owner || hasRole(user, 'SCRUTINY')),
        submit: hasRole(user, 'SCRUTINY') && ['OPEN', 'EVIDENCE_PENDING', 'BLOCKED'].includes(c.state),
        approve: canApprove,
        reject: canApprove,
        approveBlockedReason,
        complete: hasRole(user, 'SCRUTINY') && c.state === 'EXECUTION_PENDING',
        escalate: open && staff,
        cancel: open && (owner || hasRole(user, 'SCRUTINY') || hasRole(user, 'ADMIN')),
        reopen: hasRole(user, 'SCRUTINY') && c.state === 'BLOCKED',
      },
    };
  }

  async list(user: AuthUser, fdrId: string) {
    await this.fdrFor(user, fdrId);
    const cases = await this.prisma.resolutionCase.findMany({ where: { fdrId }, include: { fdr: true }, orderBy: { createdAt: 'desc' } });
    return Promise.all(cases.map((c) => this.view(c, user)));
  }

  async get(user: AuthUser, id: string) {
    return this.view(await this.caseFor(user, id), user);
  }

  async events(user: AuthUser, id: string) {
    await this.caseFor(user, id);
    return this.prisma.resolutionEvent.findMany({ where: { caseId: id }, orderBy: { at: 'asc' } });
  }

  // ------------------------------------------------------------------ writes

  /**
   * The one place a case changes state: version-checked in the database so two simultaneous
   * actions cannot both win, with the event and the audit entry in the same transaction.
   */
  private async move(
    c: { id: string; state: CaseState; version: number; fdrId: string; caseNo: string },
    to: CaseState,
    user: AuthUser,
    event: string,
    data: Prisma.ResolutionCaseUncheckedUpdateManyInput = {},
    meta: Record<string, unknown> = {},
    idemKey?: string,
    extra?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      assertMove(c.state, to);
    } catch (e) {
      if (e instanceof CaseTransitionError) throw new BadRequestException(e.message);
      throw e;
    }
    const at = await this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        const r = await tx.resolutionCase.updateMany({ where: { id: c.id, version: c.version, state: c.state }, data: { ...data, state: to, version: { increment: 1 } } });
        if (r.count !== 1) throw new ConflictException('This case was just changed by someone else. Reload it and try again.');
        await tx.resolutionEvent.create({ data: { caseId: c.id, actorId: user.id, actorLabel: this.actorLabel(user), event, fromState: c.state, toState: to, meta: meta as any, idemKey: idemKey ?? null, at } });
        if (extra) await extra(tx);
        await this.audit.log({ actor: toActor(user), action: `RESOLUTION_${event}`, entityType: 'ResolutionCase', entityId: c.id, detail: { caseNo: c.caseNo, fdrId: c.fdrId, from: c.state, to, ...meta } }, tx);
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('This request was already processed.');
      throw e;
    }
  }

  private async oneEventWithKey(key?: string) {
    if (!key) return null;
    return this.prisma.resolutionEvent.findUnique({ where: { idemKey: key } });
  }

  async create(user: AuthUser, fdrId: string, input: CreateCaseInput, idemKey?: string) {
    const prior = await this.oneEventWithKey(idemKey ? `create:${idemKey}` : undefined);
    if (prior) return this.get(user, prior.caseId);
    const fdr = await this.fdrFor(user, fdrId);
    if (!(hasRole(user, 'SCRUTINY') || (hasRole(user, 'INSTITUTION') && user.institutionId === fdr.institutionId))) {
      throw new ForbiddenException('Only the institution that holds the FDR, or a scrutiny officer, can open a resolution case.');
    }
    if (!RESOLVABLE_FDR_STATUSES.includes(fdr.status)) {
      throw new BadRequestException(`A resolution case cannot be opened while the FDR is ${fdr.status}. It must be accepted and still held.`);
    }
    if (!['RENEWAL', 'RELEASE'].includes(input.type)) throw new BadRequestException('Type must be RENEWAL or RELEASE.');
    const reason = (input.delayReason ?? '').trim();
    if (reason.length < 5) throw new BadRequestException('Please give the reason (at least 5 characters).');
    let assignee: { id: string; name: string } | null = null;
    if (input.assignedToId) {
      const a = await this.prisma.user.findFirst({ where: { id: input.assignedToId, active: true, roles: { hasSome: ['SCRUTINY', 'APPROVER'] } } });
      if (!a) throw new BadRequestException('The assigned officer must be an active scrutiny or approving officer.');
      assignee = { id: a.id, name: a.name };
    }
    let due: Date | null = null;
    if (input.dueDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new BadRequestException('Due date must look like 2026-12-31.');
      due = utcMidnight(input.dueDate);
    }
    const existing = await this.prisma.resolutionCase.findFirst({ where: { fdrId, state: { in: ACTIVE_STATES as any } }, select: { caseNo: true, state: true } });
    if (existing) throw new ConflictException(`This FDR already has an active resolution case (${existing.caseNo}, ${existing.state}). Finish or cancel it first.`);
    const at = await this.clock.now();
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const c = await tx.resolutionCase.create({
          data: {
            caseNo: caseNo(at), fdrId, type: input.type, state: 'OPEN', delayReason: reason,
            assignedToId: assignee?.id ?? null, assignedToName: assignee?.name ?? null, dueDate: due,
            openedById: user.id, openedByName: user.name,
          },
        });
        await tx.resolutionEvent.create({ data: { caseId: c.id, actorId: user.id, actorLabel: this.actorLabel(user), event: 'CASE_OPENED', toState: 'OPEN', meta: { type: input.type, reason, assignedTo: assignee?.name ?? null, dueDate: input.dueDate ?? null } as any, idemKey: idemKey ? `create:${idemKey}` : null, at } });
        await this.audit.log({ actor: toActor(user), action: 'RESOLUTION_CASE_OPENED', entityType: 'ResolutionCase', entityId: c.id, detail: { caseNo: c.caseNo, fdrId, fdrNumber: fdr.fdrNumber, type: input.type, reason } }, tx);
        return c;
      });
    } catch (e) {
      // Two simultaneous requests: the database's one-active-case index lets only one through.
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('This FDR already has an active resolution case.');
      throw e;
    }
    const scrutiny = await this.notify.recipientsForLevel(1, fdr.institutionId);
    await this.notify.notify(scrutiny.filter((s) => s.id !== user.id), { kind: 'RESOLUTION', title: `${input.type === 'RENEWAL' ? 'Renewal' : 'Release'} case opened: FDR ${fdr.fdrNumber}`, body: `${user.name} opened ${created.caseNo}. Reason: ${reason}`, fdrId });
    return this.get(user, created.id);
  }

  async addEvidence(user: AuthUser, id: string, input: { kind: string; note: string; documentId?: string }) {
    const c = await this.caseFor(user, id);
    if (!ACTIVE_STATES.includes(c.state as CaseState)) throw new BadRequestException(`The case is ${c.state}; evidence can no longer be added.`);
    if (!(hasRole(user, 'SCRUTINY') || (hasRole(user, 'INSTITUTION') && user.institutionId === c.fdr.institutionId))) throw new ForbiddenException('Only the institution or a scrutiny officer can add evidence.');
    const kind = EVIDENCE_KINDS.includes(input.kind) ? input.kind : 'NOTE';
    const note = (input.note ?? '').trim();
    if (note.length < 3) throw new BadRequestException('Please describe the evidence (at least 3 characters).');
    if (input.documentId) {
      const d = await this.prisma.document.findFirst({ where: { id: input.documentId, fdrId: c.fdrId } });
      if (!d) throw new BadRequestException('That document does not belong to this FDR.');
    }
    const at = await this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.resolutionEvidence.create({ data: { caseId: id, kind, note, documentId: input.documentId ?? null, addedById: user.id, addedByName: user.name } });
      await tx.resolutionEvent.create({ data: { caseId: id, actorId: user.id, actorLabel: this.actorLabel(user), event: 'EVIDENCE_ADDED', meta: { kind, note } as any, at } });
      await this.audit.log({ actor: toActor(user), action: 'RESOLUTION_EVIDENCE_ADDED', entityType: 'ResolutionCase', entityId: id, detail: { caseNo: c.caseNo, kind } }, tx);
      if (c.state === 'OPEN') {
        const r = await tx.resolutionCase.updateMany({ where: { id, version: c.version, state: 'OPEN' }, data: { state: 'EVIDENCE_PENDING', version: { increment: 1 } } });
        if (r.count === 1) await tx.resolutionEvent.create({ data: { caseId: id, actorId: user.id, actorLabel: this.actorLabel(user), event: 'EVIDENCE_STARTED', fromState: 'OPEN', toState: 'EVIDENCE_PENDING', at } });
      }
    });
    return this.get(user, id);
  }

  /** Scrutiny submits: the checks are run on the live record. Failing blockers stop the case in BLOCKED, with the reasons. */
  async submit(user: AuthUser, id: string, idemKey?: string) {
    if (await this.oneEventWithKey(idemKey ? `submit:${id}:${idemKey}` : undefined)) return this.get(user, id);
    if (!hasRole(user, 'SCRUTINY')) await this.deny(user, 'submit', id, 'Only a scrutiny officer submits a case for approval.');
    const c = await this.caseFor(user, id);
    if (!['OPEN', 'EVIDENCE_PENDING', 'BLOCKED'].includes(c.state)) throw new BadRequestException(`The case is ${c.state}; it cannot be submitted now.`);
    const v = await this.view(c, user);
    const stops = blockers(v.checks);
    const key = idemKey ? `submit:${id}:${idemKey}` : undefined;
    // Pass through VERIFICATION_PENDING so the history shows the verification step.
    await this.move(c as any, 'VERIFICATION_PENDING', user, 'SUBMITTED_FOR_VERIFICATION', { submittedById: user.id, submittedByName: user.name }, {}, key);
    const fresh = await this.prisma.resolutionCase.findUniqueOrThrow({ where: { id } });
    if (stops.length) {
      const reasons = stops.map((s) => `${s.label}: ${s.detail}`);
      await this.move(fresh as any, 'BLOCKED', user, 'BLOCKED', { blockedReasons: reasons as any }, { reasons });
      return this.get(user, id);
    }
    await this.move(fresh as any, 'APPROVAL_PENDING', user, 'VERIFIED', { blockedReasons: Prisma.DbNull }, { checks: v.checks.map((x) => ({ key: x.key, pass: x.pass })) });
    const approvers = await this.notify.recipientsForLevel(2, c.fdr.institutionId);
    await this.notify.notify(approvers.filter((a) => a.id !== user.id), { kind: 'RESOLUTION', title: `Needs your approval: ${c.caseNo}`, body: `${user.name} verified the ${c.type.toLowerCase()} case for FDR ${c.fdr.fdrNumber}. Please approve or reject it.`, fdrId: c.fdrId });
    return this.get(user, id);
  }

  async decide(user: AuthUser, id: string, approve: boolean, comment: string, idemKey?: string) {
    if (await this.oneEventWithKey(idemKey ? `decide:${id}:${idemKey}` : undefined)) return this.get(user, id);
    if (!hasRole(user, 'APPROVER')) await this.deny(user, approve ? 'approve' : 'reject', id, 'Only an approving officer can decide a case.');
    const c = await this.caseFor(user, id);
    if (c.state !== 'APPROVAL_PENDING') throw new BadRequestException(`The case is ${c.state}; only a case waiting for approval can be decided.`);
    try {
      assertCanApprove(user.id, c);
    } catch (e) {
      if (e instanceof CaseRuleError) await this.deny(user, approve ? 'approve' : 'reject', id, e.message);
      throw e;
    }
    const text = (comment ?? '').trim();
    if (text.length < 5) throw new BadRequestException('A comment of at least 5 characters is mandatory.');
    if (approve) {
      // Re-check on the live record: something may have changed since verification.
      const v = await this.view(c, user);
      const stops = blockers(v.checks);
      if (stops.length) throw new BadRequestException(`Approval is blocked. ${stops.map((s) => `${s.label}: ${s.detail}`).join(' ')}`);
    }
    const key = idemKey ? `decide:${id}:${idemKey}` : undefined;
    await this.move(c as any, approve ? 'APPROVED' : 'REJECTED', user, approve ? 'APPROVED' : 'REJECTED', approve ? {} : { completedAt: await this.clock.now() }, { comment: text }, key, async (tx) => {
      await tx.resolutionApproval.create({ data: { caseId: id, decision: approve ? 'APPROVED' : 'REJECTED', reviewerId: user.id, reviewerName: user.name, role: user.roles[0], comment: text } });
    });
    if (approve) {
      const fresh = await this.prisma.resolutionCase.findUniqueOrThrow({ where: { id } });
      await this.move(fresh as any, 'EXECUTION_PENDING', user, 'READY_FOR_EXECUTION', {}, {});
      const scrutiny = await this.notify.recipientsForLevel(1, c.fdr.institutionId);
      await this.notify.notify(scrutiny, { kind: 'RESOLUTION', title: `Approved: ${c.caseNo}`, body: `${user.name} approved the case. ${c.type === 'RENEWAL' ? 'Complete it once the renewed FDR is accepted.' : 'Complete the release through the release request, then record the acknowledgement.'}`, fdrId: c.fdrId });
    } else {
      const inst = await this.notify.recipientsForLevel(0, c.fdr.institutionId);
      await this.notify.notify(inst, { kind: 'RESOLUTION', title: `Rejected: ${c.caseNo}`, body: `The case was rejected: ${text}`, fdrId: c.fdrId });
    }
    return this.get(user, id);
  }

  async complete(user: AuthUser, id: string, acknowledgment: string, idemKey?: string) {
    if (await this.oneEventWithKey(idemKey ? `complete:${id}:${idemKey}` : undefined)) return this.get(user, id);
    if (!hasRole(user, 'SCRUTINY')) await this.deny(user, 'complete', id, 'Only a scrutiny officer records completion.');
    const c = await this.caseFor(user, id);
    if (c.state !== 'EXECUTION_PENDING') throw new BadRequestException(`The case is ${c.state}; only an approved case can be completed.`);
    let linked: string | null = null;
    let releaseId: string | null = null;
    const ack = (acknowledgment ?? '').trim();
    if (c.type === 'RENEWAL') {
      const renewed = await this.prisma.fdr.findFirst({ where: { previousFdrId: c.fdrId, status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'MATURED'] } }, orderBy: { createdAt: 'desc' } });
      if (!renewed || c.fdr.status !== 'RENEWED') {
        throw new BadRequestException('A renewal is complete only when the renewed FDR has been uploaded and accepted, and the original is marked Renewed. Upload the renewed FDR and have it accepted first.');
      }
      linked = renewed.id;
    } else {
      const rr = await this.prisma.releaseRequest.findFirst({ where: { fdrId: c.fdrId, status: 'APPROVED' }, orderBy: { requestedAt: 'desc' } });
      const order = rr ? await this.prisma.releaseOrder.findUnique({ where: { releaseRequestId: rr.id } }) : null;
      if (c.fdr.status !== 'RELEASED' || !rr || !order) {
        throw new BadRequestException('A release is complete only after the release request has been approved (maker-checker) and its order issued. Finish that first.');
      }
      if (ack.length < 5) throw new BadRequestException('Record the release acknowledgement (who confirmed receipt, at least 5 characters).');
      releaseId = rr.id;
    }
    const key = idemKey ? `complete:${id}:${idemKey}` : undefined;
    await this.move(c as any, 'COMPLETED', user, 'COMPLETED', { completedAt: await this.clock.now(), linkedFdrId: linked, releaseRequestId: releaseId, acknowledgment: ack || null }, { linkedFdrId: linked, releaseRequestId: releaseId, acknowledgment: ack || null }, key);
    return this.get(user, id);
  }

  async escalate(user: AuthUser, id: string, reason: string) {
    if (isInstitution(user)) throw new ForbiddenException('Only officials escalate a case.');
    const c = await this.caseFor(user, id);
    if (!ACTIVE_STATES.includes(c.state as CaseState)) throw new BadRequestException(`The case is ${c.state}; it cannot be escalated.`);
    const text = (reason ?? '').trim();
    if (text.length < 5) throw new BadRequestException('Please give the reason for escalating (at least 5 characters).');
    if (c.escalationLevel >= 2) throw new BadRequestException('This case is already at the highest escalation level.');
    const at = await this.clock.now();
    const next = c.escalationLevel + 1;
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.resolutionCase.updateMany({ where: { id, version: c.version }, data: { escalationLevel: next, version: { increment: 1 } } });
      if (r.count !== 1) throw new ConflictException('This case was just changed by someone else. Reload it and try again.');
      await tx.resolutionEvent.create({ data: { caseId: id, actorId: user.id, actorLabel: this.actorLabel(user), event: 'ESCALATED', fromState: c.state, toState: c.state, meta: { level: next, reason: text } as any, at } });
      await this.audit.log({ actor: toActor(user), action: 'RESOLUTION_ESCALATED', entityType: 'ResolutionCase', entityId: id, detail: { caseNo: c.caseNo, level: next, reason: text } }, tx);
    });
    const to = await this.notify.recipientsForLevel(2, c.fdr.institutionId);
    await this.notify.notify(to, { kind: 'RESOLUTION', title: `Escalated: ${c.caseNo}`, body: `${user.name} escalated the case for FDR ${c.fdr.fdrNumber}: ${text}`, fdrId: c.fdrId });
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, reason: string) {
    const c = await this.caseFor(user, id);
    const owner = hasRole(user, 'INSTITUTION') && user.institutionId === c.fdr.institutionId;
    if (!(owner || hasRole(user, 'SCRUTINY', 'ADMIN'))) throw new ForbiddenException('You cannot cancel this case.');
    const text = (reason ?? '').trim();
    if (text.length < 5) throw new BadRequestException('Please give the reason for cancelling (at least 5 characters).');
    await this.move(c as any, 'CANCELLED', user, 'CANCELLED', { completedAt: await this.clock.now() }, { reason: text });
    return this.get(user, id);
  }

  async reopen(user: AuthUser, id: string) {
    if (!hasRole(user, 'SCRUTINY')) throw new ForbiddenException('Only a scrutiny officer reopens a blocked case.');
    const c = await this.caseFor(user, id);
    if (c.state !== 'BLOCKED') throw new BadRequestException('Only a blocked case can be reopened. A rejected or cancelled case needs a new case.');
    await this.move(c as any, 'OPEN', user, 'REOPENED', { blockedReasons: Prisma.DbNull, submittedById: null, submittedByName: null }, {});
    return this.get(user, id);
  }

  async officers() {
    const rows = await this.prisma.user.findMany({ where: { active: true, roles: { hasSome: ['SCRUTINY', 'APPROVER'] } }, select: { id: true, name: true, roles: true }, orderBy: { name: 'asc' }, take: 200 });
    return rows.map((r) => ({ id: r.id, name: r.name, roles: r.roles }));
  }

  // ------------------------------------------------------------------ dashboard

  async risk(user: AuthUser) {
    const today = istMidnightUtc(await this.clock.today());
    const scope = scopeWhere(user);
    const matured = await this.prisma.fdr.findMany({
      where: { ...scope, status: { in: UNRESOLVED_FDR_STATUSES as any }, maturityDate: { lt: today } },
      select: { id: true, fdrNumber: true, amount: true, maturityDate: true, status: true, institution: { select: { name: true } }, resolutionCases: { where: { state: { in: ACTIVE_STATES as any } }, select: { state: true, caseNo: true, dueDate: true } } },
      orderBy: { maturityDate: 'asc' },
      take: 2000,
    });
    const rows = matured.map((f) => {
      const days = daysBetween(f.maturityDate!, today);
      const active = f.resolutionCases[0] ?? null;
      return { id: f.id, fdrNumber: f.fdrNumber, amount: f.amount, institution: f.institution.name, days, status: f.status, band: maturityBand(days), caseNo: active?.caseNo ?? null, caseState: active?.state ?? null, overdue: !!active?.dueDate && active.dueDate < today };
    });
    const by = (b: string) => rows.filter((r) => r.band === b).length;
    const cases = await this.prisma.resolutionCase.groupBy({ by: ['state'], where: { fdr: scope }, _count: true });
    const done = await this.prisma.resolutionCase.findMany({ where: { fdr: scope, state: 'COMPLETED', completedAt: { not: null } }, select: { createdAt: true, completedAt: true }, take: 500 });
    const avg = done.length ? Math.round((done.reduce((s, c) => s + (c.completedAt!.getTime() - c.createdAt.getTime()), 0) / done.length / 86400000) * 10) / 10 : null;
    return {
      unresolved: rows.length,
      withoutCase: rows.filter((r) => !r.caseNo).length,
      recent: by('MATURED_RECENT'),
      late: by('MATURED_LATE'),
      critical: by('MATURED_CRITICAL'),
      overdueCases: rows.filter((r) => r.overdue).length,
      casesByState: Object.fromEntries(cases.map((c) => [c.state, c._count])),
      completed: done.length,
      avgDaysToComplete: avg,
      worst: rows.slice(0, 6),
    };
  }
}
