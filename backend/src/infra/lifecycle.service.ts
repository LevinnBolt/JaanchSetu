import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FdrStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AuditService, Actor } from './audit.service';
import { ClockService } from './clock.service';
import { FdrStatusName, InvalidTransitionError, assertTransition } from '../domain/state-machine';

/** The single place an FDR's status changes. Every change is validated by the state machine and logged. */
@Injectable()
export class LifecycleService {
  constructor(private prisma: PrismaService, private audit: AuditService, private clock: ClockService) {}

  async transition(fdrId: string, to: FdrStatusName, actor: Actor, note?: string): Promise<FdrStatus> {
    const fdr = await this.prisma.fdr.findUnique({ where: { id: fdrId }, select: { status: true, fdrNumber: true } });
    if (!fdr) throw new NotFoundException('FDR not found');
    try {
      assertTransition(fdr.status, to);
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new BadRequestException(e.message);
      throw e;
    }
    const clockDate = await this.clock.demoDate();
    await this.prisma.$transaction(async (tx) => {
      await tx.fdr.update({ where: { id: fdrId }, data: { status: to } });
      await tx.fdrTransition.create({
        data: {
          fdrId,
          fromStatus: fdr.status,
          toStatus: to,
          actorId: actor.id,
          actorLabel: `${actor.name} (${actor.role})`,
          note: note ?? null,
          at: await this.clock.now(),
          clockDate,
        },
      });
      await this.audit.log(
        { actor, action: 'FDR_STATUS_CHANGED', entityType: 'Fdr', entityId: fdrId, detail: { fdrNumber: fdr.fdrNumber, from: fdr.status, to, note: note ?? null } },
        tx,
      );
    });
    return to as FdrStatus;
  }

  /** Same as transition but returns false instead of throwing when the move is not allowed. */
  async tryTransition(fdrId: string, to: FdrStatusName, actor: Actor, note?: string): Promise<boolean> {
    try {
      await this.transition(fdrId, to, actor, note);
      return true;
    } catch (e) {
      if (e instanceof BadRequestException) return false;
      throw e;
    }
  }
}
