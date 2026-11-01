import { Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { AuthUser, CurrentUser, hasRole, toActor } from '../auth/auth.types';
import { RadarService } from './radar.service';
import { FdrsService } from '../fdrs/fdrs.service';

@Controller()
export class NotificationsController {
  constructor(private prisma: PrismaService, private radar: RadarService, private fdrs: FdrsService) {}

  @Get('notifications')
  async list(@CurrentUser() u: AuthUser) {
    const items = await this.prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const reminderIds = items.map((i) => i.reminderId).filter((x): x is string => !!x);
    const rems = reminderIds.length ? await this.prisma.reminder.findMany({ where: { id: { in: reminderIds } }, select: { id: true, ackedAt: true } }) : [];
    return {
      unread: items.filter((i) => !i.readAt).length,
      items: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        body: i.body,
        fdrId: i.fdrId,
        reminderId: i.reminderId,
        createdAt: i.createdAt,
        readAt: i.readAt,
        acknowledged: i.reminderId ? !!rems.find((r) => r.id === i.reminderId)?.ackedAt : null,
      })),
    };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: u.id, readAt: null }, data: { readAt: new Date() } });
    return { id };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('reminders/:id/ack')
  @HttpCode(200)
  async ack(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!hasRole(u, 'INSTITUTION', 'SCRUTINY', 'APPROVER')) throw new ForbiddenException('Only institution, scrutiny or approving officers acknowledge reminders.');
    const r = await this.prisma.reminder.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Reminder not found');
    await this.fdrs.getAccessible(u, r.fdrId);
    await this.radar.acknowledge(id, toActor(u));
    return { id };
  }
}
