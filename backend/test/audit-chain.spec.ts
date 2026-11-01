import { GENESIS_HASH, StoredAuditEntry, canonicalJson, computeHash, verifyChain } from '../src/domain/audit-chain';

function build(n: number): StoredAuditEntry[] {
  const out: StoredAuditEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const payload = {
      at: new Date(Date.UTC(2026, 0, i)).toISOString(),
      clockDate: null,
      actorId: 'u1',
      actorEmail: 'a@demo.test',
      actorRole: 'ADMIN',
      action: 'TEST',
      entityType: 'Fdr',
      entityId: 'f' + i,
      detail: { b: 2, a: { y: 1, x: [1, 2] } },
    };
    const hash = computeHash(prev, payload);
    out.push({ seq: i, prevHash: prev, hash, ...payload });
    prev = hash;
  }
  return out;
}

describe('audit hash chain', () => {
  it('canonicalises key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
  });

  it('verifies an untouched chain', () => {
    expect(verifyChain(build(5))).toEqual({ intact: true, entries: 5 });
  });

  it('survives jsonb-style key reordering of detail', () => {
    const c = build(3);
    c[1].detail = { a: { x: [1, 2], y: 1 }, b: 2 };
    expect(verifyChain(c).intact).toBe(true);
  });

  it('reports the first altered entry', () => {
    const c = build(6);
    (c[3].detail as any).b = 999;
    const r = verifyChain(c);
    expect(r.intact).toBe(false);
    expect(r.firstBrokenSeq).toBe(4);
  });

  it('detects a deleted entry', () => {
    const c = build(6);
    c.splice(2, 1);
    const r = verifyChain(c);
    expect(r.intact).toBe(false);
    expect(r.firstBrokenSeq).toBe(4);
  });

  it('detects a rewritten action', () => {
    const c = build(4);
    c[0].action = 'FORGED';
    expect(verifyChain(c).firstBrokenSeq).toBe(1);
  });
});
