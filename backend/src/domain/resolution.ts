/**
 * Pure rules for resolution cases: the case state machine, the verification checks and the
 * maturity-age classification. No database, no clock: everything is passed in, so it is unit tested.
 */

export const CASE_STATES = [
  'OPEN',
  'EVIDENCE_PENDING',
  'VERIFICATION_PENDING',
  'APPROVAL_PENDING',
  'APPROVED',
  'EXECUTION_PENDING',
  'COMPLETED',
  'REJECTED',
  'BLOCKED',
  'CANCELLED',
] as const;
export type CaseState = (typeof CASE_STATES)[number];
export type CaseType = 'RENEWAL' | 'RELEASE';

/** A case in one of these states is "active": at most one per FDR. */
export const ACTIVE_STATES: CaseState[] = ['OPEN', 'EVIDENCE_PENDING', 'VERIFICATION_PENDING', 'APPROVAL_PENDING', 'APPROVED', 'EXECUTION_PENDING', 'BLOCKED'];
export const FINAL_STATES: CaseState[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];

export const CASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
  OPEN: ['EVIDENCE_PENDING', 'VERIFICATION_PENDING', 'BLOCKED', 'CANCELLED'],
  EVIDENCE_PENDING: ['VERIFICATION_PENDING', 'BLOCKED', 'CANCELLED'],
  VERIFICATION_PENDING: ['APPROVAL_PENDING', 'BLOCKED', 'CANCELLED'],
  APPROVAL_PENDING: ['APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED'],
  APPROVED: ['EXECUTION_PENDING', 'CANCELLED'],
  EXECUTION_PENDING: ['COMPLETED', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['OPEN', 'VERIFICATION_PENDING', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export class CaseTransitionError extends Error {
  constructor(public from: CaseState, public to: CaseState) {
    super(`A resolution case cannot move from ${from} to ${to}.` + (CASE_TRANSITIONS[from].length ? ` From ${from} it can only move to: ${CASE_TRANSITIONS[from].join(', ')}.` : ` ${from} is final; open a new case instead.`));
  }
}

export const canMove = (from: CaseState, to: CaseState) => CASE_TRANSITIONS[from]?.includes(to) ?? false;
export function assertMove(from: CaseState, to: CaseState) {
  if (!canMove(from, to)) throw new CaseTransitionError(from, to);
}

/** FDR statuses from which a resolution case may be opened. */
export const RESOLVABLE_FDR_STATUSES = ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'];
/** Financial statuses where the deposit is still awaiting a disposition. */
export const UNRESOLVED_FDR_STATUSES = ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED'];

// ------------------------------------------------------------------ maturity classification

export type MaturityBand = 'NOT_DUE' | 'DUE_SOON' | 'MATURED_RECENT' | 'MATURED_LATE' | 'MATURED_CRITICAL';

/**
 * Days past maturity: 0 = on the maturity day, 1 = the day after. Negative = days still to go.
 * Bands (operational defaults, not statutory deadlines): up to 30 days to go = due soon; 1-7 days past =
 * recent; 8-30 = late; 31+ = critical.
 */
export function maturityBand(daysPast: number): MaturityBand {
  if (daysPast < -30) return 'NOT_DUE';
  if (daysPast <= 0) return 'DUE_SOON';
  if (daysPast <= 7) return 'MATURED_RECENT';
  if (daysPast <= 30) return 'MATURED_LATE';
  return 'MATURED_CRITICAL';
}

/** Post-maturity milestones the monitor notifies on, highest first. */
export const POST_MATURITY_MILESTONES = [
  { days: 30, key: 'PM30', label: 'Supervisory review: 30 days past maturity with no resolution' },
  { days: 7, key: 'PM7', label: 'Escalation: 7 days past maturity with no resolution' },
  { days: 1, key: 'PM1', label: 'Pending disposition: matured yesterday with no resolution' },
] as const;

export function milestonesReached(daysPast: number) {
  return POST_MATURITY_MILESTONES.filter((m) => daysPast >= m.days);
}

// ------------------------------------------------------------------ verification checks

export interface CheckInput {
  type: CaseType;
  hasDocument: boolean;
  openDiscrepancies: number;
  /** Fields that carry a bank answer, out of totalFields. */
  bankFields: number;
  totalFields: number;
  bankSimulated: boolean;
  requireBank: boolean;
}

export interface Check {
  key: string;
  label: string;
  pass: boolean;
  /** A failing blocking check stops the case from going to approval. */
  blocking: boolean;
  detail: string;
}

export function verificationChecks(i: CheckInput): Check[] {
  const bankOk = i.totalFields > 0 && i.bankFields >= i.totalFields;
  const checks: Check[] = [
    {
      key: 'DOCUMENT',
      label: 'FDR document on file',
      pass: i.hasDocument,
      blocking: true,
      detail: i.hasDocument ? 'A document is attached.' : 'No document is attached to this FDR.',
    },
    {
      key: 'NO_OPEN_DISCREPANCIES',
      label: 'No open discrepancies',
      pass: i.openDiscrepancies === 0,
      blocking: true,
      detail: i.openDiscrepancies === 0 ? 'None open.' : `${i.openDiscrepancies} discrepancy flag(s) are still Open. Resolve or waive them first.`,
    },
    {
      key: 'BANK_CONFIRMED',
      label: i.bankSimulated ? 'Bank-confirmed (simulation)' : 'Bank-confirmed',
      pass: bankOk,
      blocking: i.requireBank,
      detail: bankOk
        ? i.bankSimulated
          ? 'All fields were checked against the labelled bank simulator. This is not a real bank confirmation.'
          : 'All fields were confirmed by the bank source.'
        : `${i.bankFields}/${i.totalFields} fields have a bank answer. Run the bank check.${i.requireBank ? '' : ' (Not required by the current policy.)'}`,
    },
  ];
  return checks;
}

export const blockers = (checks: Check[]) => checks.filter((c) => !c.pass && c.blocking);

// ------------------------------------------------------------------ roles

export class CaseRuleError extends Error {}

/**
 * The checker of a case must be a different person from whoever opened it or submitted it.
 * (Roles already differ in the demo; this also holds for a user who has several roles.)
 */
export function assertCanApprove(userId: string, c: { openedById: string; submittedById: string | null }) {
  if (userId === c.openedById) throw new CaseRuleError('You opened this case, so you cannot approve it.');
  if (c.submittedById && userId === c.submittedById) throw new CaseRuleError('You submitted this case for approval, so you cannot approve it.');
}

export function caseNo(d: Date, rand: () => number = Math.random): string {
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const tail = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rand() * 32)]).join('');
  return `JSRC-${ymd}-${tail}`;
}
