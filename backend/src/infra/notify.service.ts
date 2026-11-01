import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { MailService } from './mail.service';
import { ClockService } from './clock.service';

export interface NotifyPayload {
  kind: string;
  title: string;
  body: string;
  fdrId?: string;
  reminderId?: string;
}

@Injectable()
export class NotifyService {
  constructor(private prisma: PrismaService, private mail: MailService, private clock: ClockService) {}

  /** Users who should hear about an FDR at a given escalation level (0 institution, 1 scrutiny, 2 approver). */
  async recipientsForLevel(level: number, institutionId: string) {
    if (level === 0) return this.prisma.user.findMany({ where: { active: true, roles: { has: 'INSTITUTION' }, institutionId } });
    const role: Role = level === 1 ? 'SCRUTINY' : 'APPROVER';
    return this.prisma.user.findMany({ where: { active: true, roles: { has: role } } });
  }

  async notify(users: { id: string; email: string }[], p: NotifyPayload, at?: Date) {
    const createdAt = at ?? (await this.clock.now());
    for (const u of users) {
      await this.prisma.notification.create({
        data: { userId: u.id, fdrId: p.fdrId, reminderId: p.reminderId, kind: p.kind, title: p.title, body: p.body, createdAt },
      });
      await this.mail.send(u.email, p.title, p.body, { userId: u.id, fdrId: p.fdrId });
    }
  }
}
