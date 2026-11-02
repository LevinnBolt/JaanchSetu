import {
  ACTIVE_STATES,
  CASE_STATES,
  CASE_TRANSITIONS,
  CaseRuleError,
  CaseTransitionError,
  assertCanApprove,
  assertMove,
  blockers,
  canMove,
  caseNo,
  maturityBand,
  milestonesReached,
  verificationChecks,
} from '../src/domain/resolution';

const base = { type: 'RENEWAL' as const, hasDocument: true, openDiscrepancies: 0, bankFields: 9, totalFields: 9, bankSimulated: true, requireBank: true };

describe('resolution case state machine', () => {
  it('allows the main path in order', () => {
    const path = ['OPEN', 'VERIFICATION_PENDING', 'APPROVAL_PENDING', 'APPROVED', 'EXECUTION_PENDING', 'COMPLETED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canMove(path[i], path[i + 1])).toBe(true);
  });
  it('cannot skip approval', () => {
    expect(canMove('OPEN', 'APPROVED')).toBe(false);
    expect(canMove('VERIFICATION_PENDING', 'EXECUTION_PENDING')).toBe(false);
    expect(() => assertMove('OPEN', 'COMPLETED')).toThrow(CaseTransitionError);
  });
  it('final states have no way out', () => {
    for (const s of ['COMPLETED', 'REJECTED', 'CANCELLED'] as const) expect(CASE_TRANSITIONS[s]).toEqual([]);
  });
  it('a blocked case can be reopened or resubmitted', () => {
    expect(canMove('BLOCKED', 'OPEN')).toBe(true);
    expect(canMove('BLOCKED', 'VERIFICATION_PENDING')).toBe(true);
  });
  it('every state is known and active states exclude finals', () => {
    expect(CASE_STATES.length).toBe(10);
    expect(ACTIVE_STATES).not.toContain('COMPLETED');
    expect(ACTIVE_STATES).not.toContain('REJECTED');
    expect(ACTIVE_STATES).not.toContain('CANCELLED');
  });
});

describe('verification checks', () => {
  it('passes when everything is in place', () => {
    expect(blockers(verificationChecks(base))).toEqual([]);
  });
  it('blocks without a document', () => {
    expect(blockers(verificationChecks({ ...base, hasDocument: false })).map((c) => c.key)).toEqual(['DOCUMENT']);
  });
  it('blocks on an open discrepancy and says how many', () => {
    const b = blockers(verificationChecks({ ...base, openDiscrepancies: 2 }));
    expect(b.map((c) => c.key)).toEqual(['NO_OPEN_DISCREPANCIES']);
    expect(b[0].detail).toContain('2');
  });
  it('blocks without a bank answer when policy requires it', () => {
    const b = blockers(verificationChecks({ ...base, bankFields: 0 }));
    expect(b.map((c) => c.key)).toEqual(['BANK_CONFIRMED']);
    expect(b[0].detail).toContain('0/9');
  });
  it('does not block on the bank when policy does not require it', () => {
    const c = verificationChecks({ ...base, bankFields: 3, requireBank: false });
    expect(blockers(c)).toEqual([]);
    expect(c.find((x) => x.key === 'BANK_CONFIRMED')!.pass).toBe(false);
  });
  it('labels a simulation honestly', () => {
    expect(verificationChecks(base).find((c) => c.key === 'BANK_CONFIRMED')!.label).toContain('simulation');
    expect(verificationChecks({ ...base, bankSimulated: false }).find((c) => c.key === 'BANK_CONFIRMED')!.label).toBe('Bank-confirmed');
  });
});

describe('maturity age', () => {
  it('classifies days past maturity', () => {
    expect(maturityBand(-90)).toBe('NOT_DUE');
    expect(maturityBand(-10)).toBe('DUE_SOON');
    expect(maturityBand(0)).toBe('DUE_SOON');
    expect(maturityBand(1)).toBe('MATURED_RECENT');
    expect(maturityBand(7)).toBe('MATURED_RECENT');
    expect(maturityBand(8)).toBe('MATURED_LATE');
    expect(maturityBand(36)).toBe('MATURED_CRITICAL');
  });
  it('lists the milestones reached, highest first', () => {
    expect(milestonesReached(0)).toEqual([]);
    expect(milestonesReached(1).map((m) => m.key)).toEqual(['PM1']);
    expect(milestonesReached(36).map((m) => m.key)).toEqual(['PM30', 'PM7', 'PM1']);
  });
});

describe('case approver rules', () => {
  const c = { openedById: 'u1', submittedById: 'u2' };
  it('refuses the person who opened or submitted', () => {
    expect(() => assertCanApprove('u1', c)).toThrow(CaseRuleError);
    expect(() => assertCanApprove('u2', c)).toThrow(CaseRuleError);
  });
  it('lets someone else approve', () => {
    expect(() => assertCanApprove('u3', c)).not.toThrow();
  });
  it('makes readable case numbers', () => {
    expect(caseNo(new Date('2026-10-31T10:00:00Z'), () => 0)).toBe('JSRC-20261031-AAAAA');
  });
});
