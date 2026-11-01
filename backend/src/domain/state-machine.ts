export const FDR_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_SCRUTINY',
  'DISCREPANCY_RAISED',
  'ACCEPTED',
  'EXPIRING_SOON',
  'MATURED',
  'RENEWAL_PENDING',
  'RENEWED',
  'RELEASE_REQUESTED',
  'RELEASE_RECOMMENDED',
  'RELEASED',
  'REJECTED',
] as const;

export type FdrStatusName = (typeof FDR_STATUSES)[number];

/**
 * Allowed lifecycle transitions.
 *
 * ACCEPTED <-> EXPIRING_SOON and MATURED -> EXPIRING_SOON/ACCEPTED are only ever driven by the
 * Maturity Radar when the (demo) clock moves, including when the admin rewinds the demo clock.
 */
export const TRANSITIONS: Record<FdrStatusName, FdrStatusName[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_SCRUTINY', 'REJECTED'],
  UNDER_SCRUTINY: ['DISCREPANCY_RAISED', 'ACCEPTED', 'REJECTED'],
  DISCREPANCY_RAISED: ['UNDER_SCRUTINY', 'REJECTED'],
  ACCEPTED: ['EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'DISCREPANCY_RAISED'],
  EXPIRING_SOON: ['ACCEPTED', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'DISCREPANCY_RAISED'],
  MATURED: ['ACCEPTED', 'EXPIRING_SOON', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'DISCREPANCY_RAISED'],
  RENEWAL_PENDING: ['RENEWED', 'MATURED'],
  RENEWED: [],
  RELEASE_REQUESTED: ['RELEASE_RECOMMENDED', 'ACCEPTED'],
  RELEASE_RECOMMENDED: ['RELEASED', 'ACCEPTED'],
  RELEASED: [],
  REJECTED: [],
};

export class InvalidTransitionError extends Error {
  constructor(public from: FdrStatusName, public to: FdrStatusName) {
    super(
      `Invalid status change: an FDR cannot move from ${from} to ${to}. ` +
        (TRANSITIONS[from].length
          ? `From ${from} it can only move to: ${TRANSITIONS[from].join(', ')}.`
          : `${from} is a final state.`),
    );
  }
}

export function canTransition(from: FdrStatusName, to: FdrStatusName): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: FdrStatusName, to: FdrStatusName): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function allowedNext(from: FdrStatusName): FdrStatusName[] {
  return TRANSITIONS[from] ?? [];
}

/** Statuses the Maturity Radar watches for reminders. */
export const RADAR_WATCHED: FdrStatusName[] = ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'];
/** Statuses whose status the Radar derives from the maturity date. */
export const RADAR_DERIVED: FdrStatusName[] = ['ACCEPTED', 'EXPIRING_SOON', 'MATURED'];
/** Deposits that are still held (count towards institution deposit totals). */
export const HELD_STATUSES: FdrStatusName[] = [
  'ACCEPTED',
  'EXPIRING_SOON',
  'MATURED',
  'RENEWAL_PENDING',
  'RELEASE_REQUESTED',
  'RELEASE_RECOMMENDED',
];

/** Target status the Radar derives from days-to-maturity. */
export function radarTarget(days: number, maxThreshold: number): FdrStatusName {
  if (days < 0) return 'MATURED';
  if (days <= maxThreshold) return 'EXPIRING_SOON';
  return 'ACCEPTED';
}
