import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Actor } from '../infra/audit.service';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  institutionId: string | null;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
/** Route is allowed for users holding ANY of these roles. Routes without @Roles need only a valid login. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const hasRole = (u: AuthUser, ...roles: Role[]) => u.roles.some((r) => roles.includes(r));
export const isInstitution = (u: AuthUser) => u.roles.includes('INSTITUTION') && u.roles.length === 1;

export function toActor(u: AuthUser): Actor {
  return { id: u.id, email: u.email, name: u.name, role: u.roles[0] };
}
