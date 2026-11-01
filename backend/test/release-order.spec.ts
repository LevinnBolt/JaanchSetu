import { AuditPayload, GENESIS_HASH, StoredAuditEntry, computeHash } from '../src/domain/audit-chain';
import { OrderSnapshot, checkOrder, hashSnapshot, maskFdrNumber, newOrderNo } from '../src/domain/release-order';

const snapshot: OrderSnapshot = {
  orderNo: 'JSRO-20261031-ABCDEF',
  issuedAt: '2026-10-31T10:00:00.000Z',
  institution: { name: 'Sample Institute', city: 'Salem', state: 'Tamil Nadu' },
  fdr: { fdrNumber: 'FDR1234567', bank: 'Sample Bank A', amount: 1200000, issueDate: '2025-06-01', maturityDate: '2026-06-01' },
  request: { reason: 'Deposit matured', requestedBy: 'Anita', requestedAt: '2026-10-20T10:00:00.000Z' },
  maker: { name: 'Suresh', note: 'All conditions met', at: '2026-10-25T10:00:00.000Z' },
  checker: { name: 'Asha', reason: 'Approved', at: '2026-10-31T10:00:00.000Z' },
  checklist: [{ label: 'No pending dues', ticked: true, note: 'ok' }],
  decision: 'APPROVED',
};

function anchored(prevHash = GENESIS_HASH) {
  const orderHash = hashSnapshot(snapshot);
  const payload: AuditPayload = {
    at: '2026-10-31T10:00:01.000Z', clockDate: null, actorId: 'u1', actorEmail: 'approver@demo.test', actorRole: 'APPROVER',
    action: 'RELEASE_ORDER_ISSUED', entityType: 'ReleaseOrder', entityId: 'x', detail: { orderNo: snapshot.orderNo, orderHash },
  };
  const entry: StoredAuditEntry = { ...payload, seq: 7, prevHash, hash: computeHash(prevHash, payload) };
  const order = { orderNo: snapshot.orderNo, snapshot, orderHash, auditSeq: 7, auditHash: entry.hash };
  return { order, entry };
}

describe('release order verification', () => {
  it('an untouched order matches the audit trail', () => {
    const { order, entry } = anchored('a'.repeat(64));
    expect(checkOrder(order, entry, { hash: 'a'.repeat(64) })).toEqual({ verdict: 'AUTHENTIC', reasons: [] });
  });

  it('the first entry in the log is accepted when it links to the genesis hash', () => {
    const { order, entry } = anchored();
    expect(checkOrder(order, entry, null).verdict).toBe('AUTHENTIC');
  });

  it('changing the amount in the stored order is detected', () => {
    const { order, entry } = anchored();
    const forged = { ...order, snapshot: { ...snapshot, fdr: { ...snapshot.fdr, amount: 9999999 } } };
    const r = checkOrder(forged, entry, null);
    expect(r.verdict).toBe('TAMPERED');
    expect(r.reasons[0]).toMatch(/no longer match/);
  });

  it('a missing audit entry is detected', () => {
    const { order } = anchored();
    expect(checkOrder(order, null, null).verdict).toBe('TAMPERED');
  });

  it('an edited audit entry is detected even when its hash field is left alone', () => {
    const { order, entry } = anchored();
    const edited = { ...entry, actorEmail: 'someone.else@demo.test' };
    expect(checkOrder(order, edited, null).reasons.join(' ')).toMatch(/altered/);
  });

  it('an entry that points at a different order is detected', () => {
    const { order, entry } = anchored();
    expect(checkOrder({ ...order, orderNo: 'JSRO-20261031-ZZZZZZ' }, entry, null).verdict).toBe('TAMPERED');
  });

  it('an entry whose previous link was changed is detected', () => {
    const { order, entry } = anchored('b'.repeat(64));
    expect(checkOrder(order, entry, { hash: 'c'.repeat(64) }).reasons.join(' ')).toMatch(/before this entry/);
  });
});

describe('order helpers', () => {
  it('the hash does not depend on key order', () => {
    expect(hashSnapshot({ a: 1, b: { c: 2, d: 3 } })).toBe(hashSnapshot({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it('order numbers look right and do not repeat', () => {
    const n = new Set(Array.from({ length: 500 }, () => newOrderNo(new Date('2026-10-31T00:00:00Z'))));
    expect(n.size).toBe(500);
    for (const x of n) expect(x).toMatch(/^JSRO-20261031-[A-HJ-NP-Z2-9]{6}$/);
  });
  it('the FDR number is masked on the public page', () => {
    expect(maskFdrNumber('FDR1234567')).toBe('******4567');
    expect(maskFdrNumber('AB')).toBe('****');
    expect(maskFdrNumber(null)).toBe('');
  });
});
