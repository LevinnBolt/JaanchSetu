import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { ClockService } from './clock.service';
import { AuditPayload, GENESIS_HASH, StoredAuditEntry, computeHash, verifyChain } from '../domain/audit-chain';

export interface Actor {
  id: string | null;
  email: string;
  name: string;
  role: string;
}

export const SYSTEM_ACTOR: Actor = { id: null, email: 'system@sakshi.local', name: 'JaanchSetu scheduler', role: 'SYSTEM' };

export interface AuditInput {
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService, private clock: ClockService) {}

  /**
   * Append one entry. The previous hash is read under an advisory lock so that concurrent
   * writers cannot fork the chain. Pass `tx` to make the entry part of a larger transaction.
   */
  async log(input: AuditInput, tx?: Prisma.TransactionClient): Promise<{ seq: number; hash: string }> {
    const clockDate = await this.clock.demoDate();
    const run = async (c: Prisma.TransactionClient): Promise<{ seq: number; hash: string }> => {
      await c.$executeRaw`SELECT pg_advisory_xact_lock(7001)`;
      const last = await c.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? GENESIS_HASH;
      const at = new Date();
      const payload: AuditPayload = {
        at: at.toISOString(),
        clockDate,
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        actorRole: input.actor.role,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        detail: JSON.parse(JSON.stringify(input.detail ?? {})),
      };
      const hash = computeHash(prevHash, payload);
      const row = await c.auditLog.create({
        data: {
          at,
          clockDate,
          actorId: payload.actorId,
          actorEmail: payload.actorEmail,
          actorRole: payload.actorRole,
          action: payload.action,
          entityType: payload.entityType,
          entityId: payload.entityId,
          detail: payload.detail as Prisma.InputJsonValue,
          prevHash,
          hash,
        },
      });
      return { seq: row.seq, hash: row.hash };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  async verify() {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
    const entries: StoredAuditEntry[] = rows.map((r) => ({
      seq: r.seq,
      at: r.at.toISOString(),
      clockDate: r.clockDate,
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      detail: r.detail,
      prevHash: r.prevHash,
      hash: r.hash,
    }));
    return verifyChain(entries);
  }
}
