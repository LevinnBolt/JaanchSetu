// A stand-in for a bank's verification API, for trying the external-bank path locally.
// It is NOT a bank: it answers from the few records below and follows the contract in
// src/domain/bank-adapter.ts. Start it, then point the API at it:
//
//   node scripts/mock-bank-server.mjs                      (listens on http://localhost:4100/verify)
//   set BANK_API_URL=http://localhost:4100/verify          (then start the API; use BANK_API_KEY too if you set MOCK_BANK_KEY)
//
// FDR numbers it knows: FDRSMP260001 (agrees with the "Matching sample") and FDRSMP260002
// (holds Rs 4,50,000, so the "Mismatching sample" is reported as a MISMATCH). Anything else: not found.
import http from 'http';

const AUTHORITY = 'All India Council for Technical Education';
const RECORDS = {
  FDRSMP260001: { fdrNumber: 'FDRSMP260001', bankName: 'Sample Bank A', branch: 'Salem Main', ifsc: 'SBAA0001001', amount: 500000, issueDate: '2026-06-15', maturityDate: '2027-06-15', depositorName: 'Sample Institute of Technology, Salem', inFavourOf: AUTHORITY },
  FDRSMP260002: { fdrNumber: 'FDRSMP260002', bankName: 'Sample Bank B', branch: 'Coimbatore Central', ifsc: 'SBAB0002002', amount: 450000, issueDate: '2026-05-10', maturityDate: '2027-05-10', depositorName: 'Sample Institute of Technology, Salem', inFavourOf: AUTHORITY },
};
const PORT = Number(process.env.MOCK_BANK_PORT || 4100);
const KEY = process.env.MOCK_BANK_KEY || '';

http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  if (req.method !== 'POST' || req.url !== '/verify') return send(404, { error: 'POST /verify only' });
  if (KEY && req.headers['x-api-key'] !== KEY) return send(401, { error: 'bad key' });
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'invalid JSON' }); }
    const rec = RECORDS[String(body.fdrNumber || '').toUpperCase()];
    console.log(`${new Date().toISOString()} verify ${body.fdrNumber} -> ${rec ? 'found' : 'not found'}`);
    send(200, rec ? { found: true, record: rec } : { found: false });
  });
}).listen(PORT, () => console.log(`Mock bank API on http://localhost:${PORT}/verify (not a real bank)`));
