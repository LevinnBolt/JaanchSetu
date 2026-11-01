import { createHash } from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditPayload {
  at: string; // ISO
  clockDate: string | null;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
}

export interface StoredAuditEntry extends AuditPayload {
  seq: number;
  prevHash: string;
  hash: string;
}

/** JSON with recursively sorted keys, so the hash does not depend on key order (Postgres jsonb reorders keys). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  );
}

/** hash = SHA-256(previous entry hash + this entry's data) */
export function computeHash(prevHash: string, payload: AuditPayload): string {
  return createHash('sha256').update(prevHash + canonicalJson(payload)).digest('hex');
}

export interface ChainResult {
  intact: boolean;
  entries: number;
  firstBrokenSeq?: number;
  reason?: string;
}

/** Recompute the whole chain. Entries must be ordered by seq ascending. */
export function verifyChain(entries: StoredAuditEntry[]): ChainResult {
  let prev = GENESIS_HASH;
  for (const e of entries) {
    if (e.prevHash !== prev) {
      return { intact: false, entries: entries.length, firstBrokenSeq: e.seq, reason: 'Link to the previous entry does not match (an entry was removed, inserted or reordered).' };
    }
    const payload: AuditPayload = {
      at: e.at,
      clockDate: e.clockDate,
      actorId: e.actorId,
      actorEmail: e.actorEmail,
      actorRole: e.actorRole,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      detail: e.detail,
    };
    if (computeHash(prev, payload) !== e.hash) {
      return { intact: false, entries: entries.length, firstBrokenSeq: e.seq, reason: 'The stored data of this entry no longer matches its hash (the entry was altered).' };
    }
    prev = e.hash;
  }
  return { intact: true, entries: entries.length };
}
