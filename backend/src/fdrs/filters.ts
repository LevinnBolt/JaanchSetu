import { Prisma } from '@prisma/client';
import { AuthUser, isInstitution } from '../auth/auth.types';
import { addDays } from '../domain/dates';
import { ListQuery } from './dto';

/** Institution users only ever see their own institution's FDRs. Everyone else sees all (audit is read-only by route). */
export function scopeWhere(user: AuthUser): Prisma.FdrWhereInput {
  return isInstitution(user) ? { institutionId: user.institutionId ?? '__none__' } : {};
}

/** Bank-checked and nothing open against it. A bank answer is a simulation unless a bank API is configured. */
export const BANK_CONFIRMED: Prisma.FdrWhereInput = {
  status: { notIn: ['DRAFT', 'REJECTED'] },
  fields: { some: { key: 'fdrNumber', bankValue: { not: null } } },
  discrepancies: { none: { status: 'OPEN' } },
};

export function buildWhere(user: AuthUser, q: ListQuery, today: Date): Prisma.FdrWhereInput {
  const and: Prisma.FdrWhereInput[] = [scopeWhere(user)];
  if (q.q) {
    and.push({
      OR: [
        { fdrNumber: { contains: q.q, mode: 'insensitive' } },
        { bankName: { contains: q.q, mode: 'insensitive' } },
        { institution: { name: { contains: q.q, mode: 'insensitive' } } },
      ],
    });
  }
  if (q.institutionId) and.push({ institutionId: q.institutionId });
  if (q.state) and.push({ institution: { state: q.state } });
  if (q.bank) and.push({ bankName: { contains: q.bank, mode: 'insensitive' } });
  if (q.status) and.push({ status: { in: q.status.split(',') as any } });
  if (q.maturityFrom) and.push({ maturityDate: { gte: new Date(q.maturityFrom + 'T00:00:00Z') } });
  if (q.maturityTo) and.push({ maturityDate: { lte: new Date(q.maturityTo + 'T00:00:00Z') } });
  if (q.discrepancyType) and.push({ discrepancies: { some: { type: q.discrepancyType as any, status: 'OPEN' } } });
  if (q.verification === 'BANK_CONFIRMED') and.push(BANK_CONFIRMED);
  else if (q.verification === 'DISCREPANCY') and.push({ OR: [{ status: { in: ['REJECTED', 'DISCREPANCY_RAISED'] } }, { discrepancies: { some: { status: 'OPEN' } } }] });
  else if (q.verification === 'PENDING') {
    and.push({ status: { notIn: ['DRAFT', 'REJECTED', 'DISCREPANCY_RAISED'] }, discrepancies: { none: { status: 'OPEN' } }, NOT: { fields: { some: { key: 'fdrNumber', bankValue: { not: null } } } } });
  }
  switch (q.bucket) {
    case 'active':
      and.push({ status: { in: ['ACCEPTED', 'EXPIRING_SOON'] } });
      break;
    case 'expiring90':
      and.push({ status: { in: ['ACCEPTED', 'EXPIRING_SOON', 'RENEWAL_PENDING'] }, maturityDate: { gte: today, lte: addDays(today, 90) } });
      break;
    case 'matured':
      and.push({ status: 'MATURED' });
      break;
    case 'renewal':
      and.push({ status: 'RENEWAL_PENDING' });
      break;
    case 'release':
      and.push({ status: { in: ['RELEASE_REQUESTED', 'RELEASE_RECOMMENDED'] } });
      break;
    case 'discrepancy':
      and.push({ discrepancies: { some: { status: 'OPEN' } } });
      break;
    case 'overdue':
      and.push({ reminders: { some: { suppressed: false, ackedAt: null, level: { gte: 1 } } } });
      break;
    case 'pending':
      and.push({ status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'] } });
      break;
    case 'bankconfirmed':
      and.push(BANK_CONFIRMED);
      break;
    case 'scrutiny':
      and.push({ status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'] } });
      break;
  }
  return { AND: and };
}
