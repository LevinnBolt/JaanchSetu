import { Body, Controller, Get, HttpCode, Post, Req, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../infra/audit.service';
import { RateLimiter } from '../domain/rate-limiter';
import { AuthUser, CurrentUser, Public } from './auth.types';
import { config } from '../config';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
}

@Controller('auth')
export class AuthController {
  // 8 attempts per minute per (ip + email)
  private limiter = new RateLimiter(8, 60_000);

  constructor(private prisma: PrismaService, private jwt: JwtService, private audit: AuditService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const email = dto.email.toLowerCase();
    const key = `${req.ip}:${email}`;
    if (!this.limiter.hit(key)) {
      throw new HttpException('Too many sign-in attempts. Please wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email }, include: { institution: true } });
    const ok = !!user && user.active && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!ok || !user) {
      await this.audit.log({
        actor: { id: null, email, name: email, role: 'ANONYMOUS' },
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id ?? null,
        detail: { ip: req.ip },
      });
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    this.limiter.reset(key);
    await this.audit.log({
      actor: { id: user.id, email: user.email, name: user.name, role: user.roles[0] },
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      detail: { ip: req.ip },
    });
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: config.jwtExpiresIn });
    return { token, user: this.view(user, user.institution?.name ?? null) };
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const inst = u.institutionId ? await this.prisma.institution.findUnique({ where: { id: u.institutionId } }) : null;
    return this.view(u, inst?.name ?? null);
  }

  private view(u: { id: string; email: string; name: string; roles: string[]; institutionId: string | null }, institutionName: string | null) {
    return { id: u.id, email: u.email, name: u.name, roles: u.roles, institutionId: u.institutionId, institutionName };
  }
}
