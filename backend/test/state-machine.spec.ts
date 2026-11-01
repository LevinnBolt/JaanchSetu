import {
  FDR_STATUSES,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  radarTarget,
  TRANSITIONS,
} from '../src/domain/state-machine';

describe('FDR state machine', () => {
  it('allows the normal happy path', () => {
    const path = ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED', 'RELEASED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('allows the renewal path', () => {
    expect(canTransition('MATURED', 'RENEWAL_PENDING')).toBe(true);
    expect(canTransition('RENEWAL_PENDING', 'RENEWED')).toBe(true);
  });

  it('rejects skipping scrutiny with a clear error', () => {
    expect(() => assertTransition('SUBMITTED', 'ACCEPTED')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('SUBMITTED', 'ACCEPTED')).toThrow(/cannot move from SUBMITTED to ACCEPTED/);
  });

  it('rejects release from a discrepancy state', () => {
    expect(canTransition('DISCREPANCY_RAISED', 'RELEASE_REQUESTED')).toBe(false);
  });

  it('treats RELEASED, RENEWED and REJECTED as final', () => {
    for (const s of ['RELEASED', 'RENEWED', 'REJECTED'] as const) {
      expect(TRANSITIONS[s]).toEqual([]);
      expect(() => assertTransition(s, 'ACCEPTED')).toThrow(/final state/);
    }
  });

  it('covers every status', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...FDR_STATUSES].sort());
  });

  it('derives radar status from days to maturity', () => {
    expect(radarTarget(-1, 90)).toBe('MATURED');
    expect(radarTarget(0, 90)).toBe('EXPIRING_SOON');
    expect(radarTarget(90, 90)).toBe('EXPIRING_SOON');
    expect(radarTarget(91, 90)).toBe('ACCEPTED');
  });
});
