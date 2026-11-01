import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ClockService } from '../infra/clock.service';
import { AuditService } from '../infra/audit.service';
import { AuthUser, CurrentUser, Roles, toActor } from '../auth/auth.types';
import { RadarService } from '../radar/radar.service';
import { istDateString } from '../domain/dates';

class ReminderRulesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsInt({ each: true }) @Min(1, { each: true }) @Max(730, { each: true }) days: number[];
}
class EscalationDto {
  @IsInt() @Min(1) @Max(60) days: number;
}
class ClockDto {
  @IsOptional() @IsISO8601({ strict: true }) date?: string | null;
}
class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters.' }) password: string;
  @IsArray() @ArrayMinSize(1) @IsIn(['INSTITUTION', 'SCRUTINY', 'APPROVER', 'ADMIN'], { each: true }) roles: ('INSTITUTION' | 'SCRUTINY' | 'APPROVER' | 'ADMIN')[];
  @IsOptional() @IsString() institutionId?: string;
}
class UpdateUserDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8, { message: 'Password must be at least 8 characters.' }) password?: string;
}
class ImportDto {
  @IsArray() @ArrayMinSize(1, { message: 'The file has no rows.' }) @ArrayMaxSize(300, { message: 'Send at most 300 rows per request (the screen does this for you).' }) rows: Record<string, unknown>[];
}
class SetRequirementDto {
  /** INR the institution must keep as security deposit; null clears it. */
  @IsOptional() @IsInt() @Min(0) @Max(100000000000) requiredDeposit?: number | null;
}
class CreateInstitutionDto {
  @IsOptional() @IsInt() @Min(0) @Max(100000000000) requiredDeposit?: number;
  @IsString() @MinLength(3) @MaxLength(120) name: string;
  @IsString() @MinLength(2) @MaxLength(60) city: string;
  @IsString() @MinLength(2) @MaxLength(60) state: string;
}

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(private prisma: PrismaService, private clock: ClockService, private audit: AuditService, private radar: RadarService) {}

  @Get('settings')
  async settings() {
    return { ...(await this.radar.settings()), clock: await this.clock.info() };
  }

  @Put('reminder-rules')
  async rules(@CurrentUser() u: AuthUser, @Body() dto: ReminderRulesDto) {
    const days = [...new Set(dto.days)].sort((a, b) => b - a);
    await this.prisma.$transaction([this.prisma.reminderRule.deleteMany({}), this.prisma.reminderRule.createMany({ data: days.map((d) => ({ days: d })) })]);
    await this.audit.log({ actor: toActor(u), action: 'REMINDER_RULES_CHANGED', entityType: 'Setting', detail: { days } });
    return { reminderDays: days };
  }

  @Put('escalation')
  async escalation(@CurrentUser() u: AuthUser, @Body() dto: EscalationDto) {
    await this.prisma.setting.upsert({ where: { key: 'escalationDays' }, update: { value: String(dto.days) }, create: { key: 'escalationDays', value: String(dto.days) } });
    await this.audit.log({ actor: toActor(u), action: 'ESCALATION_PERIOD_CHANGED', entityType: 'Setting', detail: { days: dto.days } });
    return { escalationDays: dto.days };
  }

  /** Demo clock: set a date (or null to return to the real date) and run the Maturity Radar straight away. */
  @Put('clock')
  async setClock(@CurrentUser() u: AuthUser, @Body() dto: ClockDto) {
    const before = await this.clock.now();
    const date = dto.date || null;
    await this.clock.setDemoDate(date && date !== istDateString(new Date()) ? date : null);
    const after = await this.clock.now();
    if (after < before) await this.radar.rewind(after);
    await this.audit.log({ actor: toActor(u), action: 'DEMO_CLOCK_CHANGED', entityType: 'Setting', detail: { demoDate: date } });
    const summary = await this.radar.run(toActor(u));
    return { clock: await this.clock.info(), radar: summary };
  }

  @Post('radar/run')
  @HttpCode(200)
  async runRadar(@CurrentUser() u: AuthUser) {
    return this.radar.run(toActor(u));
  }

  @Get('users')
  async users(@Query('q') q?: string, @Query('role') role?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const size = Math.min(100, Math.max(1, Number(pageSize) || 15));
    const pg = Math.max(1, Number(page) || 1);
    const where: Prisma.UserWhereInput = {
      AND: [
        q ? { OR: [{ email: { contains: q.slice(0, 80), mode: 'insensitive' } }, { name: { contains: q.slice(0, 80), mode: 'insensitive' } }, { institution: { name: { contains: q.slice(0, 80), mode: 'insensitive' } } }] } : {},
        role && ['INSTITUTION', 'SCRUTINY', 'APPROVER', 'ADMIN'].includes(role) ? { roles: { has: role as Role } } : {},
      ],
    };
    const [total, all, staff, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { NOT: { roles: { has: 'INSTITUTION' } } } }),
      this.prisma.user.findMany({ where, include: { institution: true }, orderBy: [{ email: 'asc' }], skip: (pg - 1) * size, take: size }),
    ]);
    return {
      total, page: pg, pageSize: size, counts: { all, staff, institution: all - staff },
      items: rows.map((x) => ({ id: x.id, email: x.email, name: x.name, roles: x.roles, active: x.active, institutionName: x.institution?.name ?? null })),
    };
  }

  @Post('users')
  async createUser(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('A user with this email already exists.');
    if (dto.roles.includes('INSTITUTION') && !dto.institutionId) throw new BadRequestException('Institution users need an institution.');
    const user = await this.prisma.user.create({
      data: { email, name: dto.name, passwordHash: await bcrypt.hash(dto.password, 10), roles: dto.roles, institutionId: dto.institutionId ?? null },
    });
    await this.audit.log({ actor: toActor(u), action: 'USER_CREATED', entityType: 'User', entityId: user.id, detail: { email, roles: dto.roles } });
    return { id: user.id };
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    if (dto.active === undefined && dto.password === undefined) throw new BadRequestException('Nothing to change.');
    if (id === u.id && dto.active === false) throw new BadRequestException('You cannot deactivate your own account.');
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw new NotFoundException('User not found.');
    const data: { active?: boolean; passwordHash?: string } = {};
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.password !== undefined) data.passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({ where: { id }, data });
    if (dto.active !== undefined) await this.audit.log({ actor: toActor(u), action: dto.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: id });
    if (dto.password !== undefined) await this.audit.log({ actor: toActor(u), action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: id, detail: { note: 'The password itself is never logged.' } });
    return { id, ...(dto.active !== undefined ? { active: dto.active } : {}) };
  }

  @Post('institutions')
  async createInstitution(@CurrentUser() u: AuthUser, @Body() dto: CreateInstitutionDto) {
    const name = dto.name.trim();
    const dup = await this.prisma.institution.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, state: { equals: dto.state.trim(), mode: 'insensitive' } } });
    if (dup) throw new BadRequestException('An institution with this name already exists in that state.');
    const inst = await this.prisma.institution.create({ data: { name, city: dto.city.trim(), state: dto.state.trim(), requiredDeposit: dto.requiredDeposit || null } });
    await this.audit.log({ actor: toActor(u), action: 'INSTITUTION_CREATED', entityType: 'Institution', entityId: inst.id, detail: { name: inst.name, state: inst.state } });
    return { id: inst.id, name: inst.name };
  }

  /**
   * Bulk onboarding: institutions from a CSV (name, city, state, optional email). A row with an email also gets an
   * institution login with a random temporary password, returned ONCE in the response so the admin can hand it over.
   * Rows that are invalid or already exist are skipped and reported; nothing else in the file is affected.
   */
  /** Set or clear the security deposit an institution must keep in place (drives the Coverage Guard). */
  @Patch('institutions/:id')
  async setRequirement(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SetRequirementDto) {
    if (dto.requiredDeposit === undefined) throw new BadRequestException('Send requiredDeposit (a number of rupees, or null to clear it).');
    const inst = await this.prisma.institution.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException('Institution not found.');
    const value = dto.requiredDeposit && dto.requiredDeposit > 0 ? dto.requiredDeposit : null;
    await this.prisma.institution.update({ where: { id }, data: { requiredDeposit: value } });
    await this.audit.log({ actor: toActor(u), action: 'REQUIRED_DEPOSIT_SET', entityType: 'Institution', entityId: id, detail: { name: inst.name, before: inst.requiredDeposit, after: value } });
    return { id, requiredDeposit: value };
  }

  @Post('institutions/import')
  @HttpCode(200)
  async importInstitutions(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) {
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const key = (name: string, state: string) => `${name.toLowerCase()}|${state.toLowerCase()}`;
    const existing = new Set((await this.prisma.institution.findMany({ select: { name: true, state: true } })).map((i) => key(i.name, i.state)));
    const emails = new Set((await this.prisma.user.findMany({ select: { email: true } })).map((x) => x.email));
    const skipped: { row: number; name: string; reason: string }[] = [];
    const creds: { institution: string; email: string; password: string }[] = [];
    let created = 0;
    for (let i = 0; i < dto.rows.length; i++) {
      const r = dto.rows[i] || {};
      const name = text(r.name), city = text(r.city), state = text(r.state), email = text(r.email).toLowerCase();
      const skip = (reason: string) => skipped.push({ row: i + 1, name: name || '(blank)', reason });
      if (name.length < 3 || name.length > 120) { skip('The name must be 3 to 120 characters.'); continue; }
      if (city.length < 2 || city.length > 60) { skip('The city is missing or too long.'); continue; }
      if (state.length < 2 || state.length > 60) { skip('The state is missing or too long.'); continue; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { skip('The email address is not valid.'); continue; }
      if (existing.has(key(name, state))) { skip('This institution already exists in that state.'); continue; }
      if (email && emails.has(email)) { skip('A user with this email already exists.'); continue; }
      const requiredRaw = text(r.required ?? r.requireddeposit ?? r['required deposit']).replace(/[,\s₹]/g, '');
      if (requiredRaw && !/^\d{1,11}$/.test(requiredRaw)) { skip('The required deposit must be a whole number of rupees.'); continue; }
      const inst = await this.prisma.institution.create({ data: { id: randomUUID(), name, city, state, requiredDeposit: requiredRaw ? Number(requiredRaw) || null : null } });
      existing.add(key(name, state));
      created++;
      if (email) {
        const password = randomBytes(9).toString('base64url'); // 12 characters
        // cost 8 keeps a 300-row batch to a few seconds; the account can have its password reset in Admin at any time
        await this.prisma.user.create({ data: { email, name: `Registrar, ${name}`, passwordHash: await bcrypt.hash(password, 8), roles: ['INSTITUTION'], institutionId: inst.id } });
        emails.add(email);
        creds.push({ institution: name, email, password });
      }
    }
    await this.audit.log({ actor: toActor(u), action: 'INSTITUTIONS_IMPORTED', entityType: 'Institution', detail: { rows: dto.rows.length, created, skipped: skipped.length, usersCreated: creds.length, note: 'Passwords are not logged.' } });
    return { created, skipped, users: creds };
  }

  /** Every email the system tried to send, newest first. */
  @Get('emails')
  async emails(@Query('limit') limit?: string) {
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const [rows, byStatus] = await Promise.all([
      this.prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take }),
      this.prisma.emailLog.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      mailEnabled: process.env.MAIL_DISABLED !== 'true',
      counts: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])),
      items: rows.map((e) => ({ id: e.id, to: e.toEmail, subject: e.subject, body: e.body, status: e.status, error: e.error, fdrId: e.fdrId, createdAt: e.createdAt })),
    };
  }
}
