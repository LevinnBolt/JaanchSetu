import { Controller, Get, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../infra/audit.service';
import { Roles } from '../auth/auth.types';
import { Prisma } from '@prisma/client';

class AuditQuery {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/** Read-only. There is intentionally no update or delete endpoint for the audit trail. */
@Controller('audit')
@Roles('ADMIN')
export class AuditController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  async list(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.action) where.action = q.action;
    if (q.q) where.OR = [{ actorEmail: { contains: q.q, mode: 'insensitive' } }, { entityId: { contains: q.q } }, { action: { contains: q.q, mode: 'insensitive' } }];
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: q.offset ?? 0, take: q.limit ?? 50 }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        seq: r.seq,
        at: r.at,
        clockDate: r.clockDate,
        actor: r.actorEmail,
        role: r.actorRole,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        detail: r.detail,
        prevHash: r.prevHash,
        hash: r.hash,
      })),
    };
  }

  @Get('verify')
  async verify() {
    const r = await this.audit.verify();
    return r.intact
      ? { ...r, message: `Chain intact: ${r.entries} entries verified.` }
      : { ...r, message: `Chain broken at entry #${r.firstBrokenSeq}. ${r.reason}` };
  }
}
