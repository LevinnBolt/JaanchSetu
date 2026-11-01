import { FieldKey, normalizeValue } from './fields';

/**
 * BANK CONFIRMATION.
 *
 * An uploaded file, OCR text or matching typed values never prove that an FDR is genuine. Only the
 * issuing bank can. Two adapters implement the same interface:
 *
 *  - `SimulatedBankAdapter` (default): answers from seed data only. Every value it produces is
 *    labelled "Bank-confirmed (simulation)". No real bank is contacted.
 *  - `HttpBankAdapter`: calls an authorised bank (or aggregator) API that you configure with
 *    BANK_API_URL. The real route would be an authorised bank API or RBI's consent-based Account
 *    Aggregator framework; you need a formal agreement and credentials for that, which this
 *    prototype does not have. Values from it are labelled with the API name, never as a simulation.
 */
export type BankVerifyStatus = 'MATCH' | 'MISMATCH' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE';

export interface BankRecord {
  fdrNumber: string;
  bankName: string;
  branch: string;
  ifsc: string;
  amount: number;
  issueDate: string; // ISO
  maturityDate: string; // ISO
  depositorName: string;
  inFavourOf: string;
  outage?: boolean;
}

export interface BankVerifyResult {
  status: BankVerifyStatus;
  differingFields: FieldKey[];
  /** Bank-side values. Present for MATCH and MISMATCH. */
  record?: BankRecord;
}

export interface BankVerificationAdapter {
  verify(fdrNumber: string, ifsc: string, amount: number, maturityDate: string): Promise<BankVerifyResult>;
}

/** Compare the values AICTE holds with a bank record. The bank record is the reference. */
export function compareRecord(rec: BankRecord, ifsc: string, amount: number, maturityDate: string): BankVerifyResult {
  const differing: FieldKey[] = [];
  if (normalizeValue('ifsc', ifsc) !== normalizeValue('ifsc', rec.ifsc)) differing.push('ifsc');
  if (Number(amount) !== Number(rec.amount)) differing.push('amount');
  if (normalizeValue('maturityDate', maturityDate) !== normalizeValue('maturityDate', rec.maturityDate)) differing.push('maturityDate');
  return { status: differing.length ? 'MISMATCH' : 'MATCH', differingFields: differing, record: rec };
}

export type SimRecordLookup = (fdrNumber: string) => Promise<BankRecord | null>;

export class SimulatedBankAdapter implements BankVerificationAdapter {
  constructor(private readonly lookup: SimRecordLookup) {}

  async verify(fdrNumber: string, ifsc: string, amount: number, maturityDate: string): Promise<BankVerifyResult> {
    const key = normalizeValue('fdrNumber', fdrNumber);
    const rec = key ? await this.lookup(key) : null;
    if (!rec) return { status: 'NOT_FOUND', differingFields: [] };
    if (rec.outage) return { status: 'SERVICE_UNAVAILABLE', differingFields: [] };
    return compareRecord(rec, ifsc, amount, maturityDate);
  }
}

// ---------------------------------------------------------------------------------------------
// External bank API
//
// Request  POST {BANK_API_URL}   (Authorization: Bearer {BANK_API_KEY}, also sent as X-API-Key)
//   { "fdrNumber": "FDR123", "ifsc": "SBIN0001234", "amount": 1000000, "maturityDate": "2026-11-10" }
// Response 200
//   { "found": true,  "record": { fdrNumber, bankName, branch, ifsc, amount, issueDate, maturityDate, depositorName, inFavourOf } }
//   { "found": false }                      (a 404 status means the same)
// Any network error, timeout, non-2xx status or unreadable body is reported as SERVICE_UNAVAILABLE:
// the app never guesses an answer when the bank cannot be reached.
// ---------------------------------------------------------------------------------------------

export interface HttpBankOptions {
  url: string;
  apiKey?: string;
  timeoutMs: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: (url: string, init: any) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Returns a validated record, or null when the body is not what the contract promises. */
export function parseBankRecord(raw: any): BankRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const amount = Number(raw.amount);
  const rec = {
    fdrNumber: str(raw.fdrNumber), bankName: str(raw.bankName), branch: str(raw.branch), ifsc: str(raw.ifsc),
    issueDate: str(raw.issueDate), maturityDate: str(raw.maturityDate), depositorName: str(raw.depositorName), inFavourOf: str(raw.inFavourOf),
  };
  if (Object.values(rec).some((v) => v === null) || !Number.isFinite(amount) || amount <= 0) return null;
  return { ...(rec as Record<string, string>), amount } as unknown as BankRecord;
}

export class HttpBankAdapter implements BankVerificationAdapter {
  constructor(private readonly o: HttpBankOptions) {}

  async verify(fdrNumber: string, ifsc: string, amount: number, maturityDate: string): Promise<BankVerifyResult> {
    const unavailable: BankVerifyResult = { status: 'SERVICE_UNAVAILABLE', differingFields: [] };
    const key = normalizeValue('fdrNumber', fdrNumber);
    if (!key) return { status: 'NOT_FOUND', differingFields: [] };
    const doFetch = this.o.fetchImpl ?? ((url: string, init: any) => (globalThis as any).fetch(url, init));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
      if (this.o.apiKey) {
        headers.authorization = `Bearer ${this.o.apiKey}`;
        headers['x-api-key'] = this.o.apiKey;
      }
      const res = await doFetch(this.o.url, { method: 'POST', headers, body: JSON.stringify({ fdrNumber: key, ifsc, amount, maturityDate }), signal: ctrl.signal });
      if (res.status === 404) return { status: 'NOT_FOUND', differingFields: [] };
      if (!res.ok) return unavailable;
      const body: any = await res.json();
      if (body && body.found === false) return { status: 'NOT_FOUND', differingFields: [] };
      const rec = parseBankRecord(body?.record);
      if (!rec) return unavailable;
      return compareRecord(rec, ifsc, amount, maturityDate);
    } catch {
      return unavailable;
    } finally {
      clearTimeout(timer);
    }
  }
}
