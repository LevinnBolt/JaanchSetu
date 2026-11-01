import * as http from 'http';
import { AddressInfo } from 'net';
import { HttpBankAdapter, parseBankRecord, compareRecord, BankRecord } from '../src/domain/bank-adapter';

const REC: BankRecord = {
  fdrNumber: 'FDR123', bankName: 'Sample Bank A', branch: 'Salem Main', ifsc: 'SBAA0001001', amount: 500000,
  issueDate: '2026-06-15', maturityDate: '2027-06-15', depositorName: 'Sample Institute', inFavourOf: 'All India Council for Technical Education',
};

/** A stand-in for a bank API that follows the contract in domain/bank-adapter.ts. */
function stubBank(handler: (body: any, headers: http.IncomingHttpHeaders) => { status: number; body?: unknown; delayMs?: number }) {
  const seen: { body: any; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ body, headers: req.headers });
      const r = handler(body, req.headers);
      setTimeout(() => {
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(r.body === undefined ? '' : JSON.stringify(r.body));
      }, r.delayMs ?? 0);
    });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => Promise<void> }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/verify`, seen, close: () => new Promise((r) => server.close(() => r())) })),
  );
}

describe('HttpBankAdapter (external bank API)', () => {
  it('MATCH when the bank record agrees, and it sends the key and the normalised FDR number', async () => {
    const bank = await stubBank(() => ({ status: 200, body: { found: true, record: REC } }));
    const a = new HttpBankAdapter({ url: bank.url, apiKey: 'secret-key', timeoutMs: 2000 });
    const r = await a.verify('fdr 123', 'SBAA0001001', 500000, '2027-06-15');
    await bank.close();
    expect(r.status).toBe('MATCH');
    expect(r.record?.bankName).toBe('Sample Bank A');
    expect(bank.seen[0].headers.authorization).toBe('Bearer secret-key');
    expect(bank.seen[0].headers['x-api-key']).toBe('secret-key');
    expect(bank.seen[0].body.fdrNumber).toBe('FDR123');
  });

  it('MISMATCH lists exactly the fields that differ', async () => {
    const bank = await stubBank(() => ({ status: 200, body: { found: true, record: { ...REC, amount: 450000, maturityDate: '2027-07-01' } } }));
    const r = await new HttpBankAdapter({ url: bank.url, timeoutMs: 2000 }).verify('FDR123', 'SBAA0001001', 500000, '2027-06-15');
    await bank.close();
    expect(r.status).toBe('MISMATCH');
    expect(r.differingFields.sort()).toEqual(['amount', 'maturityDate']);
  });

  it('NOT_FOUND for found:false and for HTTP 404', async () => {
    const a = await stubBank(() => ({ status: 200, body: { found: false } }));
    const b = await stubBank(() => ({ status: 404 }));
    expect((await new HttpBankAdapter({ url: a.url, timeoutMs: 2000 }).verify('FDR123', 'X', 1, '2027-01-01')).status).toBe('NOT_FOUND');
    expect((await new HttpBankAdapter({ url: b.url, timeoutMs: 2000 }).verify('FDR123', 'X', 1, '2027-01-01')).status).toBe('NOT_FOUND');
    await a.close();
    await b.close();
  });

  it('SERVICE_UNAVAILABLE on a server error, a malformed body, a timeout or a closed port (never a guess)', async () => {
    const e500 = await stubBank(() => ({ status: 503 }));
    const bad = await stubBank(() => ({ status: 200, body: { found: true, record: { fdrNumber: 'FDR123' } } }));
    const slow = await stubBank(() => ({ status: 200, body: { found: true, record: REC }, delayMs: 600 }));
    const verify = (url: string, timeoutMs = 2000) => new HttpBankAdapter({ url, timeoutMs }).verify('FDR123', 'SBAA0001001', 500000, '2027-06-15');
    expect((await verify(e500.url)).status).toBe('SERVICE_UNAVAILABLE');
    expect((await verify(bad.url)).status).toBe('SERVICE_UNAVAILABLE');
    expect((await verify(slow.url, 100)).status).toBe('SERVICE_UNAVAILABLE');
    const closed = e500.url;
    await e500.close();
    expect((await verify(closed)).status).toBe('SERVICE_UNAVAILABLE');
    await bad.close();
    await slow.close();
  });

  it('an empty FDR number is NOT_FOUND without calling the bank', async () => {
    const bank = await stubBank(() => ({ status: 200, body: { found: true, record: REC } }));
    const r = await new HttpBankAdapter({ url: bank.url, timeoutMs: 2000 }).verify('   ', 'X', 1, '2027-01-01');
    await bank.close();
    expect(r.status).toBe('NOT_FOUND');
    expect(bank.seen).toHaveLength(0);
  });
});

describe('bank record parsing and comparison', () => {
  it('parseBankRecord rejects missing fields and a non-positive amount', () => {
    expect(parseBankRecord(REC)).not.toBeNull();
    expect(parseBankRecord({ ...REC, branch: '' })).toBeNull();
    expect(parseBankRecord({ ...REC, amount: 0 })).toBeNull();
    expect(parseBankRecord({ ...REC, amount: 'abc' })).toBeNull();
    expect(parseBankRecord(null)).toBeNull();
  });
  it('compareRecord ignores formatting differences in IFSC case', () => {
    expect(compareRecord(REC, 'sbaa0001001', 500000, '2027-06-15').status).toBe('MATCH');
  });
});
