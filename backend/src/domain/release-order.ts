import { createHash, randomBytes } from 'crypto';
import { AuditPayload, GENESIS_HASH, StoredAuditEntry, canonicalJson, computeHash } from './audit-chain';

/**
 * Verifiable Release / Refund Order.
 *
 * When a release is approved, a snapshot of the decision is hashed. The same hash is written into the audit trail
 * (a hash-chained, append-only log), so anyone can later check that the order was not altered. This proves the
 * order matches this system's own log. It is NOT an official AICTE document and does not prove the bank released money.
 */
export interface OrderSnapshot {
  orderNo: string;
  issuedAt: string;
  institution: { name: string; city: string; state: string };
  fdr: { fdrNumber: string | null; bank: string | null; amount: number | null; issueDate: string | null; maturityDate: string | null };
  request: { reason: string; requestedBy: string; requestedAt: string };
  maker: { name: string | null; note: string | null; at: string | null };
  checker: { name: string | null; reason: string | null; at: string | null };
  checklist: { label: string; ticked: boolean; note: string }[];
  decision: 'APPROVED';
}

export const hashSnapshot = (s: unknown) => createHash('sha256').update(canonicalJson(s)).digest('hex');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters
export function newOrderNo(now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = randomBytes(6);
  const tail = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `JSRO-${d}-${tail}`;
}

/** Hide most of an FDR number on the public page. */
export function maskFdrNumber(n: string | null | undefined): string {
  if (!n) return '';
  return n.length <= 4 ? '****' : '*'.repeat(n.length - 4) + n.slice(-4);
}

export type OrderVerdict = 'AUTHENTIC' | 'TAMPERED' | 'NOT_FOUND';
export interface OrderCheck { verdict: OrderVerdict; reasons: string[] }

/**
 * Pure check. `entry` is the audit-trail row the order was anchored to, `previous` the row before it (null when the
 * entry is the first one).
 */
export function checkOrder(
  order: { orderNo: string; snapshot: unknown; orderHash: string; auditSeq: number; auditHash: string },
  entry: StoredAuditEntry | null,
  previous: { hash: string } | null,
): OrderCheck {
  const reasons: string[] = [];
  if (hashSnapshot(order.snapshot) !== order.orderHash) reasons.push('The order contents no longer match the hash recorded when it was issued.');
  if (!entry) {
    reasons.push('The audit-trail entry that anchors this order is missing.');
    return { verdict: 'TAMPERED', reasons };
  }
  if (entry.hash !== order.auditHash) reasons.push('The audit-trail entry hash differs from the one stored with the order.');
  const payload: AuditPayload = {
    at: entry.at, clockDate: entry.clockDate, actorId: entry.actorId, actorEmail: entry.actorEmail, actorRole: entry.actorRole,
    action: entry.action, entityType: entry.entityType, entityId: entry.entityId, detail: entry.detail,
  };
  if (computeHash(entry.prevHash, payload) !== entry.hash) reasons.push('The audit-trail entry itself has been altered.');
  const detail = (entry.detail ?? {}) as Record<string, unknown>;
  if (detail.orderNo !== order.orderNo || detail.orderHash !== order.orderHash) reasons.push('The audit-trail entry does not refer to this order.');
  const expectedPrev = previous ? previous.hash : GENESIS_HASH;
  if (entry.prevHash !== expectedPrev) reasons.push('The audit trail was altered before this entry.');
  return { verdict: reasons.length ? 'TAMPERED' : 'AUTHENTIC', reasons };
}
