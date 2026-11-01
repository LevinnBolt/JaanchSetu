import { MakerCheckerError, assertCanDecide, assertCanRecommend, checklistProblems, emptyChecklist, CHECKLIST_KEYS } from '../src/domain/maker-checker';
import { SimulatedBankAdapter, BankRecord } from '../src/domain/bank-adapter';
import { RateLimiter } from '../src/domain/rate-limiter';

const ctx = { requesterId: 'inst', fdrCreatorId: 'inst', makerId: 'maker' };

describe('maker-checker', () => {
  it('lets a different person decide', () => {
    expect(() => assertCanDecide('checker', ctx)).not.toThrow();
  });

  it('blocks the maker from also being the checker', () => {
    expect(() => assertCanDecide('maker', ctx)).toThrow(MakerCheckerError);
    expect(() => assertCanDecide('maker', ctx)).toThrow(/different people/);
  });

  it('blocks the requester and the record creator', () => {
    expect(() => assertCanDecide('inst', ctx)).toThrow(MakerCheckerError);
    expect(() => assertCanDecide('creator', { ...ctx, fdrCreatorId: 'creator' })).toThrow(/created this FDR/);
  });

  it('blocks a decision before any recommendation', () => {
    expect(() => assertCanDecide('checker', { ...ctx, makerId: null })).toThrow(/not been recommended/);
  });

  it('blocks the requester from recommending', () => {
    expect(() => assertCanRecommend('inst', ctx)).toThrow(MakerCheckerError);
    expect(() => assertCanRecommend('maker', ctx)).not.toThrow();
  });

  it('requires every checklist item ticked with a note', () => {
    const items = emptyChecklist();
    expect(checklistProblems(items)).toHaveLength(CHECKLIST_KEYS.length);
    items.forEach((i) => ((i.ticked = true), (i.note = 'checked')));
    expect(checklistProblems(items)).toEqual([]);
    items[0].note = '';
    expect(checklistProblems(items)).toHaveLength(1);
  });
});

describe('simulated bank adapter', () => {
  const rec = (o: Partial<BankRecord> = {}): BankRecord => ({
    fdrNumber: 'FD1',
    bankName: 'Sample Bank A',
    branch: 'X',
    ifsc: 'SBAA0001234',
    amount: 500000,
    issueDate: '2026-01-01',
    maturityDate: '2027-01-01',
    depositorName: 'D',
    inFavourOf: 'AICTE',
    ...o,
  });
  const adapterFor = (r: BankRecord | null) => new SimulatedBankAdapter(async () => r);

  it('returns MATCH, MISMATCH, NOT_FOUND and SERVICE_UNAVAILABLE', async () => {
    expect((await adapterFor(rec()).verify('fd1', 'SBAA0001234', 500000, '2027-01-01')).status).toBe('MATCH');
    const mm = await adapterFor(rec()).verify('FD1', 'SBAA0001234', 450000, '2027-01-01');
    expect(mm.status).toBe('MISMATCH');
    expect(mm.differingFields).toEqual(['amount']);
    expect((await adapterFor(null).verify('FD1', 'x', 1, '2027-01-01')).status).toBe('NOT_FOUND');
    expect((await adapterFor(rec({ outage: true })).verify('FD1', 'x', 1, '2027-01-01')).status).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('login rate limiter', () => {
  it('allows N hits per window then blocks, then recovers', () => {
    let now = 0;
    const rl = new RateLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => rl.hit('a'))).toEqual([true, true, true, false]);
    expect(rl.hit('b')).toBe(true);
    now = 1001;
    expect(rl.hit('a')).toBe(true);
  });
});
