// End-to-end test of the running API (default http://localhost:4000/api).
//   1. npm run seed          (start from the known demo data)
//   2. npm run dev           (API running, DEMO_MODE=true)
//   3. npm run test:e2e
// It signs in as every role and exercises the real workflows: submit, OCR, review, bank check,
// discrepancies, accept, Maturity Radar with the demo clock, reminders and the email outbox,
// renewal, maker-checker release, admin tools, reports, scoping and the audit chain.
// It creates test records (prefixed E2E / e2e); run `npm run seed` to reset.

const API = process.env.API || 'http://localhost:4000/api';
const PASSWORD = 'demo123';
const RUN = Date.now().toString(36);
let pass = 0;
const failures = [];

const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { failures.push(name + (extra ? ` -> ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` -> ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);
const short = (v) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 160);

async function req(token, method, path, { body, form, raw, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* csv or text */ }
  return { status: res.status, data: raw ? text : data, headers: res.headers };
}
const login = async (email, password = PASSWORD) => {
  const r = await req(null, 'POST', '/auth/login', { body: { email, password } });
  return r.status < 300 ? r.data.token : null;
};
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function sampleForm(sample, overrides = {}) {
  const png = await fetch(`${API}/demo/samples/${sample.file}`).then((r) => r.arrayBuffer());
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...sample.typed, ...overrides })) f.append(k, v);
  f.append('document', new Blob([png], { type: 'image/png' }), sample.file);
  return f;
}

/** Make an FDR ready to accept: resolve every open flag, then confirm every extracted value. */
async function readyAndAccept(scr, id) {
  let d = (await req(scr, 'GET', `/fdrs/${id}`)).data;
  for (const x of d.discrepancies.filter((x) => x.status === 'OPEN')) {
    await req(scr, 'POST', `/discrepancies/${x.id}/resolve`, { body: { note: 'Checked against the document (e2e)' } });
  }
  d = (await req(scr, 'GET', `/fdrs/${id}`)).data;
  for (const row of d.truthTable || []) if (row.extracted && !row.review) await req(scr, 'POST', `/fdrs/${id}/fields/${row.key}/review`, { body: { action: 'CONFIRM' } });
  return req(scr, 'POST', `/fdrs/${id}/accept`, { body: {} });
}

(async () => {
  console.log(`JaanchSetu end-to-end test against ${API}`);

  // ------------------------------------------------------------------ A. sign-in
  section('A. Sign-in and sessions');
  const demo = (await req(null, 'GET', '/demo/accounts')).data;
  ok('demo accounts are listed (4 roles)', demo.accounts?.length === 4, short(demo.accounts?.map((a) => a.role)));
  const inst = await login('institution@demo.test');
  const scr = await login('scrutiny@demo.test');
  const app = await login('approver@demo.test');
  const adm = await login('admin@demo.test');
  ok('all four roles can sign in', !!(inst && scr && app && adm));
  ok('a wrong password is refused (401)', (await req(null, 'POST', '/auth/login', { body: { email: 'admin@demo.test', password: 'nope-nope' } })).status === 401);
  ok('no token is refused (401)', (await req(null, 'GET', '/fdrs')).status === 401);
  ok('a removed role (audit@) cannot sign in', (await login('audit@demo.test')) === null);
  const me = (await req(adm, 'GET', '/auth/me')).data;
  ok('/auth/me returns the role', me.roles?.includes('ADMIN'));

  // ------------------------------------------------------------------ B. access control
  section('B. Access control');
  ok('institution cannot list users (403)', (await req(inst, 'GET', '/admin/users')).status === 403);
  ok('institution cannot read the email outbox (403)', (await req(inst, 'GET', '/admin/emails')).status === 403);
  ok('institution cannot read impact figures (403)', (await req(inst, 'GET', '/dashboard/impact')).status === 403);
  ok('scrutiny cannot read the audit trail (403)', (await req(scr, 'GET', '/audit')).status === 403);
  ok('admin can read the audit trail', (await req(adm, 'GET', '/audit')).status === 200);
  ok('scrutiny cannot submit an FDR (403)', (await req(scr, 'POST', '/fdrs', { body: {} })).status === 403);
  ok('approver cannot start scrutiny (403)', (await req(app, 'POST', '/fdrs/x/start-scrutiny', { body: {} })).status === 403);

  // ------------------------------------------------------------------ C. dashboard + lookups
  section('C. Dashboard, impact and lookups');
  const dash0 = (await req(scr, 'GET', '/dashboard')).data;
  const c0 = dash0.cards;
  ok('cards include total institutions', c0.totalInstitutions > 0, short(c0));
  ok('cards include pending verification and bank-confirmed', Number.isInteger(c0.pendingVerification) && Number.isInteger(c0.bankConfirmed));
  ok('recent alerts is a list', Array.isArray(dash0.recentAlerts));
  const impact = (await req(scr, 'GET', '/dashboard/impact')).data;
  ok('impact has four groups with figures', impact.groups?.length === 4 && impact.groups.every((g) => g.items.length > 0), short(impact.groups?.map((g) => g.key)));
  ok('impact states its basis honestly', /demo data/i.test(impact.basis || ''));
  const meta = (await req(scr, 'GET', '/meta')).data;
  ok('meta says the bank is a simulation by default', meta.bank?.mode === 'simulation' && /simulation/i.test(meta.bank.label), short(meta.bank));

  // ------------------------------------------------------------------ D. list, paging, filters, CSV
  section('D. FDR list, paging, filters and export');
  const p1 = (await req(scr, 'GET', '/fdrs?pageSize=5')).data;
  const p2 = (await req(scr, 'GET', '/fdrs?pageSize=5&page=2')).data;
  ok('page 1 has 5 items and a total', p1.items?.length === 5 && p1.total > 5 && p1.page === 1, short({ n: p1.items?.length, total: p1.total }));
  ok('page 2 is a different set', p2.items?.length === 5 && !p2.items.some((x) => p1.items.some((y) => y.id === x.id)));
  ok('total amount is returned', typeof p1.totalAmount === 'number' && p1.totalAmount > 0);
  ok('pageSize above 100 is refused (400)', (await req(scr, 'GET', '/fdrs?pageSize=101')).status === 400);
  const pend = (await req(scr, 'GET', '/fdrs?bucket=pending&pageSize=100')).data;
  ok('pending bucket matches the dashboard card', pend.total === c0.pendingVerification, `${pend.total} vs ${c0.pendingVerification}`);
  ok('pending bucket holds only pre-decision statuses', pend.items.every((x) => ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'].includes(x.status)));
  const bc = (await req(scr, 'GET', '/fdrs?verification=BANK_CONFIRMED&pageSize=100')).data;
  ok('bank-confirmed filter matches the dashboard card', bc.total === c0.bankConfirmed, `${bc.total} vs ${c0.bankConfirmed}`);
  ok('bank-confirmed rows are labelled so', bc.items.every((x) => x.verification === 'BANK_CONFIRMED'));
  const pv = (await req(scr, 'GET', '/fdrs?verification=PENDING&pageSize=100')).data;
  ok('pending-verification filter returns only PENDING rows', pv.items.length > 0 && pv.items.every((x) => x.verification === 'PENDING'));
  const dv = (await req(scr, 'GET', '/fdrs?verification=DISCREPANCY&pageSize=100')).data;
  ok('discrepancy filter returns only DISCREPANCY rows', dv.items.length > 0 && dv.items.every((x) => x.verification === 'DISCREPANCY'));
  const instList = (await req(inst, 'GET', '/fdrs?pageSize=100')).data;
  ok('an institution user sees only its own FDRs', instList.total > 0 && instList.total < p1.total && new Set(instList.items.map((x) => x.institutionId)).size === 1);
  const csv = (await req(scr, 'GET', '/fdrs/export', { raw: true }));
  const csvLines = csv.data.trim().split(/\r?\n/);
  ok('CSV export has a Verification column and every row', /Verification/.test(csvLines[0]) && csvLines.length - 1 === p1.total, `${csvLines.length - 1} rows vs ${p1.total}`);

  // ------------------------------------------------------------------ E. submit, OCR, review, bank check, accept
  section('E. New FDR: submit, OCR, review, bank check, accept');
  const samples = (await req(null, 'GET', '/demo/samples')).data;
  const matching = samples.find((s) => s.name === 'matching');
  const mismatching = samples.find((s) => s.name === 'problem' || s.name === 'mismatching' || s.name === 'mismatch');
  const created = await req(inst, 'POST', '/fdrs', { form: await sampleForm(matching) });
  ok('institution submits the matching sample (201)', created.status === 201 || created.status === 200, short(created.data));
  const idA = created.data.id;
  const dA = (await req(inst, 'GET', `/fdrs/${idA}`)).data;
  ok('the FDR is Submitted', dA.fdr.status === 'SUBMITTED', dA.fdr.status);
  ok('OCR filled the Extracted column (all 9 fields)', dA.truthTable?.filter((r) => r.extracted).length === 9, `${dA.truthTable?.filter((r) => r.extracted).length}`);
  ok('a matching document raises no discrepancy', dA.discrepancies.length === 0, short(dA.discrepancies.map((x) => x.type)));
  const startA = await req(scr, 'POST', `/fdrs/${idA}/start-scrutiny`, { body: {} });
  ok('scrutiny starts the review', startA.status < 300, short(startA.data));
  const earlyAccept = await req(scr, 'POST', `/fdrs/${idA}/accept`, { body: {} });
  ok('accept is refused until every extracted value is confirmed (400)', earlyAccept.status === 400, short(earlyAccept.data));
  const bankA = await req(scr, 'POST', `/fdrs/${idA}/bank-check`, { body: {} });
  ok('bank check (simulation) returns MATCH', bankA.data.status === 'MATCH', short(bankA.data));
  ok('the bank message says it is the simulated bank', /simulated bank/i.test(bankA.data.message || ''), short(bankA.data.message));
  const accA = await readyAndAccept(scr, idA);
  ok('FDR is accepted after review', accA.status < 300, short(accA.data));
  const dA2 = (await req(scr, 'GET', `/fdrs/${idA}`)).data;
  ok('status is ACCEPTED and bank values are stored', dA2.fdr.status === 'ACCEPTED' && dA2.truthTable.some((r) => r.bank), dA2.fdr.status);
  const listA = (await req(scr, 'GET', `/fdrs?q=${matching.typed.fdrNumber}&pageSize=20`)).data;
  ok('the list labels it Bank-confirmed (simulation)', listA.items.some((x) => x.id === idA && x.verification === 'BANK_CONFIRMED'));
  const dash1 = (await req(scr, 'GET', '/dashboard')).data.cards;
  ok('dashboard bank-confirmed count went up', dash1.bankConfirmed === c0.bankConfirmed + 1, `${c0.bankConfirmed} -> ${dash1.bankConfirmed}`);

  section('F. Mismatching document: flags, waive, resolve');
  if (!mismatching) ok('mismatching sample exists', false, short(samples.map((s) => s.name)));
  else {
    const m = await req(inst, 'POST', '/fdrs', { form: await sampleForm(mismatching) });
    const idB = m.data.id;
    const dB = (await req(inst, 'GET', `/fdrs/${idB}`)).data;
    ok('mismatching sample raises discrepancies automatically', dB.discrepancies.length > 0, short(dB.discrepancies.map((x) => x.type)));
    await req(scr, 'POST', `/fdrs/${idB}/start-scrutiny`, { body: {} });
    const blocked = await req(scr, 'POST', `/fdrs/${idB}/accept`, { body: {} });
    ok('accept is refused while a flag is Open (400)', blocked.status === 400, short(blocked.data));
    const first = dB.discrepancies.find((x) => x.status === 'OPEN');
    const shortWaive = await req(scr, 'POST', `/discrepancies/${first.id}/waive`, { body: { reason: 'too short' } });
    ok('waiving needs a written reason of 10+ characters (400)', shortWaive.status === 400);
    const waive = await req(scr, 'POST', `/discrepancies/${first.id}/waive`, { body: { reason: 'Authority confirmed this in writing (e2e test)' } });
    ok('waiving with a reason works', waive.status < 300, short(waive.data));
    const acc = await readyAndAccept(scr, idB);
    ok('after waive/resolve and review the FDR is accepted', acc.status < 300, short(acc.data));
    const bankB = await req(scr, 'POST', `/fdrs/${idB}/bank-check`, { body: {} });
    ok('bank check runs on the second FDR', ['MATCH', 'MISMATCH', 'NOT_FOUND', 'SERVICE_UNAVAILABLE'].includes(bankB.data.status), short(bankB.data));
  }

  // ------------------------------------------------------------------ G. Maturity Radar, reminders, emails
  section('G. Maturity Radar: demo clock, reminders, escalation, email outbox');
  const anchors = (await req(adm, 'GET', '/demo/guide')).data.anchors;
  const s3 = anchors.s3;
  const emails0 = (await req(adm, 'GET', '/admin/emails')).data;
  ok('the email outbox is readable by admin', Array.isArray(emails0.items) && typeof emails0.mailEnabled === 'boolean');
  const settings = (await req(adm, 'GET', '/admin/settings')).data;
  const today = settings.clock.today;
  const jump = await req(adm, 'PUT', '/admin/clock', { body: { date: addDays(today, 30) } });
  ok('admin jumps the demo clock +30 days and the radar runs', jump.status < 300 && jump.data.radar, short(jump.data));
  const s3d = (await req(adm, 'GET', `/fdrs/${s3}`)).data;
  ok('the 95-day FDR becomes Expiring soon', s3d.fdr.status === 'EXPIRING_SOON', s3d.fdr.status);
  const instNotes = (await req(inst, 'GET', '/notifications')).data;
  const rem = instNotes.items.find((n) => n.fdrId === s3 && n.reminderId);
  ok('the institution receives a reminder notification', !!rem, short(instNotes.items.slice(0, 2)));
  const emails1 = (await req(adm, 'GET', '/admin/emails')).data;
  const sum = (c) => Object.values(c || {}).reduce((a, b) => a + b, 0);
  ok('the reminder email is recorded in the outbox', sum(emails1.counts) > sum(emails0.counts), `${sum(emails0.counts)} -> ${sum(emails1.counts)}`);
  ok('outbox rows carry status, recipient and body', emails1.items.every((e) => e.status && e.to && e.body));
  await req(adm, 'PUT', '/admin/clock', { body: { date: addDays(today, 90) } });
  await req(adm, 'PUT', '/admin/clock', { body: { date: addDays(today, 120) } });
  const scrNotes = (await req(scr, 'GET', '/notifications')).data;
  ok('an unanswered reminder escalates to the scrutiny officer', scrNotes.items.some((n) => /ESCALAT/i.test(n.kind + n.title)), short(scrNotes.items.slice(0, 2).map((n) => n.title)));
  if (rem) {
    const ack = await req(inst, 'POST', `/reminders/${rem.reminderId}/ack`, { body: {} });
    ok('the institution can acknowledge a reminder', ack.status < 300, short(ack.data));
  }
  const readAll = await req(inst, 'POST', '/notifications/read-all', { body: {} });
  ok('mark-all-read works', readAll.status < 300);
  const back = await req(adm, 'PUT', '/admin/clock', { body: { date: null } });
  ok('resetting to the real date works', back.status < 300 && !back.data.clock.isShifted, short(back.data.clock));
  const s3back = (await req(adm, 'GET', `/fdrs/${s3}`)).data;
  ok('rewinding the clock restores the status', s3back.fdr.status === 'ACCEPTED', s3back.fdr.status);
  const rules = await req(adm, 'PUT', '/admin/reminder-rules', { body: { days: [90, 60, 30, 15, 7] } });
  ok('reminder days can be changed', rules.status < 300 && rules.data.reminderDays.includes(15), short(rules.data));
  await req(adm, 'PUT', '/admin/reminder-rules', { body: { days: [90, 60, 30, 7] } });
  ok('invalid reminder rules are refused (400)', (await req(adm, 'PUT', '/admin/reminder-rules', { body: { days: [] } })).status === 400);

  // ------------------------------------------------------------------ M1. resolution case for the renewal below
  section('M1. Resolution case: renewal of the matured FDR');
  const s4id = anchors.s4;
  const mat4 = (await req(inst, 'GET', `/fdrs/${s4id}/maturity`)).data;
  ok('the matured FDR shows its maturity age and a pending resolution', mat4.matured === true && mat4.daysPastMaturity >= 1 && mat4.pendingResolution === true && mat4.canOpenCase === true, short(mat4));
  const key1 = `k-${RUN}-1`;
  const c4a = await req(inst, 'POST', `/fdrs/${s4id}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'Renewal paperwork is with the bank (e2e)' }, headers: { 'idempotency-key': key1 } });
  ok('the institution opens a renewal case', c4a.status < 300 && c4a.data.state === 'OPEN' && /^JSRC-/.test(c4a.data.caseNo), short(c4a.data));
  const case4 = c4a.data.id;
  const c4b = await req(inst, 'POST', `/fdrs/${s4id}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'Renewal paperwork is with the bank (e2e)' }, headers: { 'idempotency-key': key1 } });
  ok('the same request sent twice returns the same case (no duplicate)', c4b.status < 300 && c4b.data.id === case4, short(c4b.data));
  const c4c = await req(inst, 'POST', `/fdrs/${s4id}/resolutions`, { body: { type: 'RELEASE', delayReason: 'A different request while one is active' } });
  ok('a second active case on the same FDR is refused (409)', c4c.status === 409, `${c4c.status} ${short(c4c.data)}`);
  const evid = await req(inst, 'POST', `/resolutions/${case4}/evidence`, { body: { kind: 'BANK_LETTER', note: 'Bank letter confirming the renewal is in process' } });
  ok('evidence is added and moves the case to Evidence pending', evid.status < 300 && evid.data.state === 'EVIDENCE_PENDING' && evid.data.evidence.length === 1, short(evid.data));
  const instSubmit = await req(inst, 'POST', `/resolutions/${case4}/submit`, { body: {} });
  ok('the institution cannot submit for approval (403)', instSubmit.status === 403, `${instSubmit.status}`);
  const apprSubmit = await req(app, 'POST', `/resolutions/${case4}/submit`, { body: {} });
  ok('an approving officer cannot submit it either (403)', apprSubmit.status === 403);
  const sub4 = await req(scr, 'POST', `/resolutions/${case4}/submit`, { body: {} });
  ok('scrutiny submits; every check passes and it waits for approval', sub4.status < 300 && sub4.data.state === 'APPROVAL_PENDING' && sub4.data.checks.every((c) => c.pass), short(sub4.data.state + ' ' + JSON.stringify(sub4.data.blockedReasons)));
  ok('the bank check is labelled as a simulation', sub4.data.checks.some((c) => /simulation/.test(c.label)) && sub4.data.bankSimulated === true);
  const scrApprove = await req(scr, 'POST', `/resolutions/${case4}/approve`, { body: { comment: 'Looks fine to me' } });
  ok('a scrutiny officer cannot approve (403)', scrApprove.status === 403);
  const instApprove = await req(inst, 'POST', `/resolutions/${case4}/approve`, { body: { comment: 'Looks fine to me' } });
  ok('the institution cannot approve (403)', instApprove.status === 403);
  const both = await Promise.all([
    req(app, 'POST', `/resolutions/${case4}/approve`, { body: { comment: 'Approved by checker, attempt one' } }),
    req(app, 'POST', `/resolutions/${case4}/approve`, { body: { comment: 'Approved by checker, attempt two' } }),
  ]);
  const wins = both.filter((r) => r.status < 300).length;
  ok('two simultaneous approvals: exactly one wins', wins === 1, both.map((r) => r.status).join(','));
  const after4 = (await req(scr, 'GET', `/resolutions/${case4}`)).data;
  ok('the case is ready for execution with exactly one approval on record', after4.state === 'EXECUTION_PENDING' && after4.approvals.length === 1, `${after4.state} ${after4.approvals.length}`);
  const early4 = await req(scr, 'POST', `/resolutions/${case4}/complete`, { body: {} });
  ok('a renewal cannot be completed before the renewed FDR is accepted (400)', early4.status === 400 && /renewed FDR/i.test(JSON.stringify(early4.data)), short(early4.data));
  const attemptLog = (await req(adm, 'GET', '/audit?limit=100&q=RESOLUTION_DENIED')).data;
  ok('refused attempts are written to the audit trail', attemptLog.items?.length >= 3, String(attemptLog.items?.length));

  // ------------------------------------------------------------------ H. renewal chain
  section('H. Renewal');
  const old = anchors.s4;
  const rr = await req(inst, 'POST', `/fdrs/${old}/renewal-request`, { body: {} });
  ok('institution requests renewal of the matured FDR', rr.status < 300, short(rr.data));
  const oldMid = (await req(inst, 'GET', `/fdrs/${old}`)).data;
  ok('the old FDR is Renewal pending', oldMid.fdr.status === 'RENEWAL_PENDING', oldMid.fdr.status);
  const renewedNumber = `FDRSMP26R${RUN}`.toUpperCase().slice(0, 18);
  const renewal = await req(inst, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: renewedNumber, renewsFdrId: old }) });
  ok('the renewed FDR is submitted and linked', renewal.status < 300 && renewal.data.id, short(renewal.data));
  const newId = renewal.data.id;
  await req(scr, 'POST', `/fdrs/${newId}/start-scrutiny`, { body: {} });
  const accN = await readyAndAccept(scr, newId);
  ok('scrutiny accepts the renewed FDR', accN.status < 300, short(accN.data));
  const oldDone = (await req(scr, 'GET', `/fdrs/${old}`)).data;
  ok('the old FDR becomes Renewed', oldDone.fdr.status === 'RENEWED', oldDone.fdr.status);
  const chain = (await req(scr, 'GET', `/fdrs/${newId}`)).data;
  ok('the chain shows both FDRs', (chain.chain || []).length >= 2, short(chain.chain));
  const done4 = await req(scr, 'POST', `/resolutions/${case4}/complete`, { body: {} });
  ok('now the renewal case completes and links the renewed FDR', done4.status < 300 && done4.data.state === 'COMPLETED' && done4.data.linkedFdrId === newId, short(done4.data));
  const again4 = await req(scr, 'POST', `/resolutions/${case4}/complete`, { body: {} });
  ok('completing it again is refused (400)', again4.status === 400);
  const mat4b = (await req(inst, 'GET', `/fdrs/${s4id}/maturity`)).data;
  ok('a renewed FDR has no pending resolution and no case can be opened', mat4b.pendingResolution === false && mat4b.canOpenCase === false, short(mat4b));
  const reopenFinal = await req(inst, 'POST', `/fdrs/${s4id}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'Trying again after completion' } });
  ok('opening a case on a renewed FDR is refused (400)', reopenFinal.status === 400);
  const ev4 = (await req(scr, 'GET', `/resolutions/${case4}/events`)).data;
  ok('the case history records every step in order', ev4.map((e) => e.event).join('|').includes('CASE_OPENED') && ev4.some((e) => e.event === 'APPROVED') && ev4.at(-1).event === 'COMPLETED', ev4.map((e) => e.event).join(','));

  // ------------------------------------------------------------------ M2. resolution case for the release below
  section('M2. Resolution case: release');
  const s6a = anchors.s6a;
  const c6 = await req(inst, 'POST', `/fdrs/${s6a}/resolutions`, { body: { type: 'RELEASE', delayReason: 'Obligation completed; security no longer needed (e2e)' } });
  ok('the institution opens a release case', c6.status < 300 && c6.data.type === 'RELEASE', short(c6.data));
  const case6 = c6.data.id;
  await req(scr, 'POST', `/resolutions/${case6}/submit`, { body: {} });
  const ap6 = await req(app, 'POST', `/resolutions/${case6}/approve`, { body: { comment: 'Obligations verified (e2e)' } });
  ok('the release case is approved and waits for execution', ap6.status < 300 && ap6.data.state === 'EXECUTION_PENDING', short(ap6.data));
  const early6 = await req(scr, 'POST', `/resolutions/${case6}/complete`, { body: { acknowledgment: 'Receipt confirmed by the institution' } });
  ok('a release cannot be completed before the release order exists (400)', early6.status === 400, short(early6.data));

  // ------------------------------------------------------------------ I. release with maker-checker
  section('I. Release / refund with maker-checker');
  const dualEmail = `dual.${RUN}@e2e.test`;
  const dualCreate = await req(adm, 'POST', '/admin/users', { body: { email: dualEmail, name: 'E2E Dual Officer', password: 'e2e-pass-123', roles: ['SCRUTINY', 'APPROVER'] } });
  ok('admin creates a user holding both officer roles', dualCreate.status < 300, short(dualCreate.data));
  const dual = await login(dualEmail, 'e2e-pass-123');
  ok('the new user can sign in', !!dual);
  const relId = anchors.s6a;
  const reqRel = await req(inst, 'POST', `/fdrs/${relId}/release-requests`, { body: { reason: 'Deposit matured and the requirement is complete (e2e)' } });
  ok('institution requests release / refund', reqRel.status < 300, short(reqRel.data));
  const relDetail = (await req(scr, 'GET', `/fdrs/${relId}`)).data;
  const rrId = relDetail.releaseRequests?.[0]?.id;
  ok('the release request is visible to scrutiny', !!rrId);
  const keys = (relDetail.releaseRequests?.[0]?.checklist || []).map((c) => c.key);
  const early = await req(dual, 'POST', `/release-requests/${rrId}/recommend`, { body: { note: 'ok to go' } });
  ok('recommend is refused until every checklist item is ticked', early.status === 400 || early.status === 403, `${early.status} ${short(early.data)}`);
  const cl = await req(dual, 'PUT', `/release-requests/${rrId}/checklist`, { body: { items: keys.map((key) => ({ key, ticked: true, note: 'Verified from records (e2e)' })) } });
  ok('scrutiny saves the checklist', cl.status < 300, short(cl.data));
  const rec = await req(dual, 'POST', `/release-requests/${rrId}/recommend`, { body: { note: 'All conditions met (e2e)' } });
  ok('scrutiny recommends release', rec.status < 300, short(rec.data));
  const self = await req(dual, 'POST', `/release-requests/${rrId}/decision`, { body: { approve: true, reason: 'Approving my own recommendation' } });
  ok('the maker cannot approve their own recommendation (403)', self.status === 403, `${self.status} ${short(self.data)}`);
  ok('a pure scrutiny officer cannot decide (403)', (await req(scr, 'POST', `/release-requests/${rrId}/decision`, { body: { approve: true, reason: 'not allowed' } })).status === 403);
  const noReason = await req(app, 'POST', `/release-requests/${rrId}/decision`, { body: { approve: true, reason: 'x' } });
  ok('a decision needs a written reason (400)', noReason.status === 400);
  const approve = await req(app, 'POST', `/release-requests/${rrId}/decision`, { body: { approve: true, reason: 'Competent authority approves the release (e2e)' } });
  ok('a different approving officer approves', approve.status < 300, short(approve.data));
  const rel = (await req(app, 'GET', `/fdrs/${relId}`)).data;
  ok('the FDR is Released', rel.fdr.status === 'RELEASED', rel.fdr.status);
  const noAck = await req(scr, 'POST', `/resolutions/${case6}/complete`, { body: {} });
  ok('a release needs a recorded acknowledgement (400)', noAck.status === 400 && /acknowledg/i.test(JSON.stringify(noAck.data)), short(noAck.data));
  const done6 = await req(scr, 'POST', `/resolutions/${case6}/complete`, { body: { acknowledgment: 'Receipt confirmed by the institution registrar' } });
  ok('with the order issued and an acknowledgement the release case completes', done6.status < 300 && done6.data.state === 'COMPLETED' && !!done6.data.orderNo && !!done6.data.acknowledgment, short(done6.data));
  const risk0 = (await req(scr, 'GET', '/dashboard/maturity-risk')).data;
  ok('a released FDR raises no overdue-resolution alert', !risk0.worst.some((w) => w.id === s6a), short(risk0.worst.map((w) => w.fdrNumber)));

  // ------------------------------------------------------------------ J. admin tools and scoping
  section('J. Admin tools: institutions, users, passwords, scoping');
  const iName = `E2E Test Institute ${RUN}`;
  const mk = await req(adm, 'POST', '/admin/institutions', { body: { name: iName, city: 'Pune', state: 'Maharashtra' } });
  ok('admin creates an institution', mk.status < 300 && mk.data.id, short(mk.data));
  ok('a duplicate institution is refused (400)', (await req(adm, 'POST', '/admin/institutions', { body: { name: iName, city: 'Pune', state: 'Maharashtra' } })).status === 400);
  ok('an invalid institution is refused (400)', (await req(adm, 'POST', '/admin/institutions', { body: { name: 'x', city: '', state: '' } })).status === 400);
  const found = (await req(adm, 'GET', `/institutions?q=${encodeURIComponent(iName)}`)).data;
  ok('the new institution is searchable', found.items?.some((i) => i.id === mk.data.id) && found.total === 1, short(found.items));
  ok('institution totals are returned', found.totals?.institutions > 1 && typeof found.totals?.fdrs === 'number');
  const uEmail = `inst.${RUN}@e2e.test`;
  const uc = await req(adm, 'POST', '/admin/users', { body: { email: uEmail, name: 'E2E Registrar', password: 'first-pass-1', roles: ['INSTITUTION'], institutionId: mk.data.id } });
  ok('admin creates an institution user', uc.status < 300, short(uc.data));
  ok('an institution user needs an institution (400)', (await req(adm, 'POST', '/admin/users', { body: { email: `x.${RUN}@e2e.test`, name: 'No Inst', password: 'first-pass-1', roles: ['INSTITUTION'] } })).status === 400);
  ok('a duplicate email is refused (400)', (await req(adm, 'POST', '/admin/users', { body: { email: uEmail, name: 'Dup', password: 'first-pass-1', roles: ['INSTITUTION'], institutionId: mk.data.id } })).status === 400);
  ok('a short password is refused (400)', (await req(adm, 'POST', '/admin/users', { body: { email: `y.${RUN}@e2e.test`, name: 'Short', password: 'abc', roles: ['SCRUTINY'] } })).status === 400);
  const newInst = await login(uEmail, 'first-pass-1');
  ok('the new institution user signs in', !!newInst);
  const own = (await req(newInst, 'GET', '/fdrs')).data;
  ok('they start with an empty, scoped list', own.total === 0);
  const sub = await req(newInst, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: `E2E${RUN}`.toUpperCase() }) });
  ok('they can submit an FDR', sub.status < 300, short(sub.data));
  ok('they cannot open another institution\'s FDR', [403, 404].includes((await req(newInst, 'GET', `/fdrs/${anchors.s2}`)).status));
  ok('they cannot open another institution\'s page', (await req(newInst, 'GET', `/institutions/${(await req(adm, 'GET', '/institutions?pageSize=1')).data.items[0].id}`)).status === 403);
  const list = (await req(adm, 'GET', `/admin/users?q=${encodeURIComponent(uEmail)}`)).data;
  ok('users are searchable with counts', list.total === 1 && list.counts.all > 5, short(list.counts));
  const staffOnly = (await req(adm, 'GET', '/admin/users?role=SCRUTINY&pageSize=100')).data;
  ok('users can be filtered by role', staffOnly.items.length > 0 && staffOnly.items.every((u) => u.roles.includes('SCRUTINY')));
  const uid = list.items[0].id;
  ok('admin resets a password', (await req(adm, 'PATCH', `/admin/users/${uid}`, { body: { password: 'second-pass-2' } })).status < 300);
  ok('the old password stops working', (await login(uEmail, 'first-pass-1')) === null);
  ok('the new password works', !!(await login(uEmail, 'second-pass-2')));
  ok('admin deactivates the user', (await req(adm, 'PATCH', `/admin/users/${uid}`, { body: { active: false } })).status < 300);
  ok('a deactivated user cannot sign in', (await login(uEmail, 'second-pass-2')) === null);
  ok('admin cannot deactivate themselves (400)', (await req(adm, 'PATCH', `/admin/users/${me.id}`, { body: { active: false } })).status === 400);
  ok('an empty update is refused (400)', (await req(adm, 'PATCH', `/admin/users/${uid}`, { body: {} })).status === 400);

  // ------------------------------------------------------------------ K. reports
  section('K. Reports');
  const defs = (await req(scr, 'GET', '/reports')).data;
  ok('six reports are offered', defs.length === 6, short(defs.map((d) => d.key)));
  for (const d of defs) {
    const r = await req(scr, 'GET', `/reports/${d.key}?pageSize=10`);
    ok(`report "${d.key}" returns columns, rows and a total`, r.status === 200 && r.data.columns?.length > 0 && Array.isArray(r.data.rows) && typeof r.data.total === 'number', `${r.status} ${short(r.data)}`);
    const c = await req(scr, 'GET', `/reports/${d.key}?format=csv`, { raw: true });
    ok(`report "${d.key}" downloads as CSV`, c.status === 200 && /^﻿?[^\r\n]+\r?\n/.test(c.data) && /text\/csv/.test(c.headers.get('content-type') || ''), `${c.status}`);
  }
  const pendRep = (await req(scr, 'GET', '/reports/pending-verifications?pageSize=100')).data;
  const dashNow = (await req(scr, 'GET', '/dashboard')).data.cards;
  ok('the pending report agrees with the dashboard', pendRep.total === dashNow.pendingVerification, `${pendRep.total} vs ${dashNow.pendingVerification}`);
  const up30 = (await req(scr, 'GET', '/reports/upcoming-maturities?days=30&pageSize=100')).data;
  const up365 = (await req(scr, 'GET', '/reports/upcoming-maturities?days=365&pageSize=100')).data;
  ok('the upcoming-maturities window is adjustable', up365.total >= up30.total && up30.rows.every((r) => r.daysLeft <= 30), `${up30.total} / ${up365.total}`);
  const intervene = (await req(scr, 'GET', '/reports/needs-intervention?pageSize=100')).data;
  ok('needs-intervention rows give a reason and an owner', intervene.rows.every((r) => r.reason && r.owner));
  const instRep = (await req(inst, 'GET', '/reports/upcoming-maturities?days=365&pageSize=100')).data;
  ok('an institution user\'s report holds only its own FDRs', instRep.rows.every((r) => r.institution === (instList.items[0].institutionName)), short(instRep.rows.slice(0, 1)));
  ok('an unknown report is refused (400)', (await req(scr, 'GET', '/reports/nope')).status === 400);

  // ------------------------------------------------------------------ M. several institutions side by side
  section('M. Several institutions side by side (isolation)');
  const multi = [];
  for (const [i, n] of [[0, 2], [1, 1], [2, 3]]) {
    const name = `E2E Multi ${i} ${RUN}`;
    const c = await req(adm, 'POST', '/admin/institutions', { body: { name, city: 'Pune', state: 'Maharashtra' } });
    const email = `multi${i}.${RUN}@e2e.test`;
    await req(adm, 'POST', '/admin/users', { body: { email, name: `Registrar ${i}`, password: 'multi-pass-1', roles: ['INSTITUTION'], institutionId: c.data.id } });
    const tok = await login(email, 'multi-pass-1');
    const ids = [];
    for (let k = 0; k < n; k++) {
      const r = await req(tok, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: `E2EM${i}${k}${RUN}`.toUpperCase() }) });
      ids.push(r.data.id);
    }
    multi.push({ i, name, id: c.data.id, tok, ids });
  }
  ok('three new institutions each submit their own FDRs (2, 1 and 3)', multi.every((m) => m.tok && m.ids.every(Boolean)));
  for (const m of multi) {
    const other = multi.find((o) => o !== m);
    const l = (await req(m.tok, 'GET', '/fdrs?pageSize=100')).data;
    ok(`#${m.i}: its list holds exactly its ${m.ids.length} FDR(s) and no other institution's`, l.total === m.ids.length && l.items.every((x) => x.institutionId === m.id), `${l.total}`);
    const cards = (await req(m.tok, 'GET', '/dashboard')).data.cards;
    ok(`#${m.i}: its dashboard counts only its own FDRs`, cards.totalFdrs === m.ids.length && cards.totalInstitutions === 1, short(cards));
    ok(`#${m.i}: another institution's FDR cannot be opened`, [403, 404].includes((await req(m.tok, 'GET', `/fdrs/${other.ids[0]}`)).status));
    const otherDoc = (await req(other.tok, 'GET', `/fdrs/${other.ids[0]}`)).data.documents?.[0]?.id;
    ok(`#${m.i}: another institution's document cannot be downloaded`, !!otherDoc && [403, 404].includes((await req(m.tok, 'GET', `/documents/${otherDoc}/download`, { raw: true })).status));
    ok(`#${m.i}: another institution's page is forbidden (403)`, (await req(m.tok, 'GET', `/institutions/${other.id}`)).status === 403);
    const rep = (await req(m.tok, 'GET', '/reports/pending-verifications?pageSize=100')).data;
    ok(`#${m.i}: its report holds only its own FDRs`, rep.total === m.ids.length && rep.rows.every((r) => r.institution === m.name), `${rep.total}`);
    ok(`#${m.i}: searching for another institution finds nothing`, (await req(m.tok, 'GET', `/fdrs?q=${encodeURIComponent(other.name)}`)).data.total === 0);
    ok(`#${m.i}: its notifications mention no other institution's FDR`, !(await req(m.tok, 'GET', '/notifications')).data.items.some((n) => other.ids.includes(n.fdrId)));
  }
  for (const m of multi) {
    const st = (await req(scr, 'GET', `/fdrs?institutionId=${m.id}&pageSize=100`)).data;
    ok(`officers see all of #${m.i}'s FDRs`, st.total === m.ids.length);
  }
  const insList = (await req(scr, 'GET', `/institutions?q=${encodeURIComponent('E2E Multi')}&pageSize=100`)).data;
  ok('the officers\' institution list shows all three with the right counts', multi.every((m) => insList.items.find((x) => x.id === m.id)?.fdrCount === m.ids.length), short(insList.items.map((x) => x.fdrCount)));
  const allFdrs = (await req(scr, 'GET', '/fdrs?pageSize=1')).data;
  ok('the officers\' total spans every institution', allFdrs.total >= 6 + 20, `${allFdrs.total}`);
  const crossDup = await req(multi[1].tok, 'POST', '/fdrs', { form: await sampleForm(matching) });
  const dupTypes = (await req(scr, 'GET', `/fdrs/${crossDup.data.id}`)).data.discrepancies.map((x) => x.type);
  ok('the same FDR number from a second institution is flagged as a duplicate', dupTypes.includes('DUPLICATE_FDR_NUMBER'), short(dupTypes));
  ok('the same file from a second institution is flagged as a duplicate document', dupTypes.includes('DUPLICATE_DOCUMENT'), short(dupTypes));

  // reminders must reach only the owning institution
  const soon = addDays(today, 10);
  const acceptSoon = async (m, tag) => {
    const r = await req(m.tok, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: `E2EA${tag}${RUN}`.toUpperCase(), issueDate: addDays(today, -355), maturityDate: soon }) });
    await req(scr, 'POST', `/fdrs/${r.data.id}/start-scrutiny`, { body: {} });
    // the document prints a 2027 maturity; the officer corrects both dates to the real ones before accepting
    for (const [key, value] of [['issueDate', addDays(today, -355)], ['maturityDate', soon]]) {
      await req(scr, 'POST', `/fdrs/${r.data.id}/fields/${key}/review`, { body: { action: 'CORRECT', value, note: 'Dates corrected by the officer (e2e)' } });
    }
    const a = await readyAndAccept(scr, r.data.id);
    return { id: r.data.id, ok: a.status < 300 };
  };
  const acc0 = await acceptSoon(multi[0], '0');
  const acc1 = await acceptSoon(multi[1], '1');
  ok('two institutions each get an FDR accepted that matures in 10 days', acc0.ok && acc1.ok);
  const nn = await Promise.all(multi.map(async (m) => (await req(m.tok, 'GET', '/notifications')).data.items));
  ok('institution #0 receives the reminder for its own FDR', nn[0].some((n) => n.fdrId === acc0.id && n.reminderId));
  ok('institution #1 receives its own reminder and not #0\'s', nn[1].some((n) => n.fdrId === acc1.id && n.reminderId) && !nn[1].some((n) => n.fdrId === acc0.id));
  ok('institution #2 receives neither', !nn[2].some((n) => n.fdrId === acc0.id || n.fdrId === acc1.id));
  ok('both FDRs are now Expiring soon', (await req(scr, 'GET', `/fdrs/${acc0.id}`)).data.fdr.status === 'EXPIRING_SOON' && (await req(scr, 'GET', `/fdrs/${acc1.id}`)).data.fdr.status === 'EXPIRING_SOON');

  // ------------------------------------------------------------------ N. other functions
  section('N. Drafts, upload rules, rejection, manual flags, release rejection, documents, login limit');
  const typedWith = (n) => ({ ...matching.typed, fdrNumber: `E2EN${n}${RUN}`.toUpperCase() });
  const form = (typed, extra = {}) => { const f = new FormData(); for (const [k, v] of Object.entries({ ...typed, ...extra })) f.append(k, v); return f; };
  const png = await fetch(`${API}/demo/samples/${matching.file}`).then((r) => r.arrayBuffer());

  const draftForm = form(typedWith('D'), { asDraft: 'true' });
  const draft = await req(inst, 'POST', '/fdrs', { form: draftForm });
  ok('saving a draft works', draft.status < 300 && draft.data.id, short(draft.data));
  let dd = (await req(inst, 'GET', `/fdrs/${draft.data.id}`)).data;
  ok('the draft is DRAFT and offers Submit', dd.fdr.status === 'DRAFT' && dd.actions.includes('SUBMIT'), dd.fdr.status);
  const attach = new FormData();
  attach.append('document', new Blob([png], { type: 'image/png' }), matching.file);
  ok('a document can be attached to the draft', (await req(inst, 'POST', `/fdrs/${draft.data.id}/documents`, { form: attach })).status < 300);
  ok('the draft can then be submitted', (await req(inst, 'POST', `/fdrs/${draft.data.id}/submit`, { body: {} })).status < 300);
  dd = (await req(inst, 'GET', `/fdrs/${draft.data.id}`)).data;
  ok('after submitting it is Submitted with all 9 values read by OCR', dd.fdr.status === 'SUBMITTED' && dd.truthTable.filter((r) => r.extracted).length === 9, `${dd.fdr.status}`);

  const txt = form(typedWith('T')); txt.append('document', new Blob(['hello, this is not an FDR'], { type: 'text/plain' }), 'notes.txt');
  ok('a .txt file is refused (400)', (await req(inst, 'POST', '/fdrs', { form: txt })).status === 400);
  const fake = form(typedWith('F')); fake.append('document', new Blob(['not really a png'], { type: 'image/png' }), 'fake.png');
  ok('a file renamed to .png but not an image is refused (400)', (await req(inst, 'POST', '/fdrs', { form: fake })).status === 400);
  const big = form(typedWith('B')); big.append('document', new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
  const bigRes = await req(inst, 'POST', '/fdrs', { form: big });
  ok('a file over 10 MB is refused', bigRes.status === 400 || bigRes.status === 413, `${bigRes.status}`);
  ok('an FDR with a missing field is refused (400)', (await req(inst, 'POST', '/fdrs', { form: form({ ...typedWith('M'), ifsc: '' }) })).status === 400);
  ok('a zero amount is refused (400)', (await req(inst, 'POST', '/fdrs', { form: form({ ...typedWith('Z'), amount: '0' }) })).status === 400);

  const rj = await req(inst, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: `E2EN-R${RUN}`.toUpperCase() }) });
  await req(scr, 'POST', `/fdrs/${rj.data.id}/start-scrutiny`, { body: {} });
  ok('rejecting needs a reason of 5+ characters (400)', (await req(scr, 'POST', `/fdrs/${rj.data.id}/reject`, { body: { reason: 'no' } })).status === 400);
  ok('scrutiny rejects an FDR with a reason', (await req(scr, 'POST', `/fdrs/${rj.data.id}/reject`, { body: { reason: 'Document is not acceptable (e2e)' } })).status < 300);
  const rjd = (await req(inst, 'GET', `/fdrs/${rj.data.id}`)).data;
  ok('the institution sees it as Rejected with the reason', rjd.fdr.status === 'REJECTED' && /not acceptable/.test(rjd.fdr.rejectionReason || ''), rjd.fdr.status);

  const mf = await req(inst, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: `E2EN-M${RUN}`.toUpperCase() }) });
  await req(scr, 'POST', `/fdrs/${mf.data.id}/start-scrutiny`, { body: {} });
  ok('a manual discrepancy needs a real description (400)', (await req(scr, 'POST', `/fdrs/${mf.data.id}/discrepancies`, { body: { reason: 'x' } })).status === 400);
  const raised = await req(scr, 'POST', `/fdrs/${mf.data.id}/discrepancies`, { body: { reason: 'Seal on the receipt looks altered (e2e)' } });
  ok('scrutiny raises a manual discrepancy', raised.status < 300, short(raised.data));
  const mfd = (await req(scr, 'GET', `/fdrs/${mf.data.id}`)).data;
  ok('it appears as Open and the FDR is Discrepancy raised', mfd.discrepancies.some((x) => x.type === 'MANUAL' && x.status === 'OPEN') && mfd.fdr.status === 'DISCREPANCY_RAISED', mfd.fdr.status);
  ok('an institution user cannot raise one (403)', (await req(inst, 'POST', `/fdrs/${mf.data.id}/discrepancies`, { body: { reason: 'Trying to flag my own FDR' } })).status === 403);

  const docId = (await req(scr, 'GET', `/fdrs/${idA}`)).data.documents?.[0]?.id;
  const dl = await req(scr, 'GET', `/documents/${docId}/download`, { raw: true });
  ok('an officer can download the stored document', dl.status === 200 && /image\/png/.test(dl.headers.get('content-type') || ''), `${dl.status}`);
  ok('a download without signing in is refused (401)', (await req(null, 'GET', `/documents/${docId}/download`, { raw: true })).status === 401);

  // release: reject path, and "not while a discrepancy is open"
  const s6b = anchors.s6b;
  const rb = (await req(scr, 'GET', `/fdrs/${s6b}`)).data.releaseRequests?.[0];
  ok('a release request is waiting for the checklist', rb?.status === 'REQUESTED', rb?.status);
  await req(scr, 'PUT', `/release-requests/${rb.id}/checklist`, { body: { items: rb.checklist.map((c) => ({ key: c.key, ticked: true, note: 'Checked (e2e)' })) } });
  ok('scrutiny recommends it', (await req(scr, 'POST', `/release-requests/${rb.id}/recommend`, { body: { note: 'Looks complete (e2e)' } })).status < 300);
  ok('the approving officer rejects it with a reason', (await req(app, 'POST', `/release-requests/${rb.id}/decision`, { body: { approve: false, reason: 'A pending dues letter is missing (e2e)' } })).status < 300);
  const rbd = (await req(app, 'GET', `/fdrs/${s6b}`)).data;
  ok('the request is Rejected and the FDR is not released', rbd.releaseRequests[0].status === 'REJECTED' && rbd.fdr.status !== 'RELEASED', `${rbd.releaseRequests[0].status} / ${rbd.fdr.status}`);

  const s6c = anchors.s6c;
  const rc = (await req(scr, 'GET', `/fdrs/${s6c}`)).data.releaseRequests?.[0];
  await req(scr, 'POST', `/fdrs/${s6c}/discrepancies`, { body: { reason: 'A new doubt was raised after the recommendation (e2e)' } });
  const blocked = await req(app, 'POST', `/release-requests/${rc.id}/decision`, { body: { approve: true, reason: 'Trying to approve with a flag open' } });
  ok('approval is refused while a discrepancy is Open', blocked.status >= 400 && blocked.status < 500, `${blocked.status} ${short(blocked.data)}`);
  const openFlag = (await req(scr, 'GET', `/fdrs/${s6c}`)).data.discrepancies.find((x) => x.status === 'OPEN');
  await req(scr, 'POST', `/discrepancies/${openFlag.id}/resolve`, { body: { note: 'Checked and cleared (e2e)' } });
  const later = await req(app, 'POST', `/release-requests/${rc.id}/decision`, { body: { approve: true, reason: 'All clear now (e2e)' } });
  ok('once the flag is resolved the approval goes through', later.status < 300, short(later.data));

  let limited = 0;
  for (let i = 0; i < 10; i++) { if ((await req(null, 'POST', '/auth/login', { body: { email: `nobody.${RUN}@rate.test`, password: 'wrong-password' } })).status === 429) limited++; }
  ok('repeated wrong sign-ins are rate-limited (429)', limited >= 1, `${limited} blocked`);

  // ------------------------------------------------------------------ O. bulk import of institutions
  section('O. Bulk import of institutions');
  const imp = (rows, token = adm) => req(token, 'POST', '/admin/institutions/import', { body: { rows } });
  const rows1 = [
    { name: `Bulk One ${RUN}`, city: 'Nagpur', state: 'Maharashtra', email: `bulk1.${RUN}@e2e.test` },
    { name: `Bulk Two ${RUN}`, city: 'Salem', state: 'Tamil Nadu', email: `bulk2.${RUN}@e2e.test` },
    { name: `Bulk Three ${RUN}`, city: 'Jaipur', state: 'Rajasthan', email: '' },
    { name: 'x', city: 'Pune', state: 'Maharashtra', email: '' },
    { name: `Bulk Four ${RUN}`, city: 'Kochi', state: 'Kerala', email: 'not-an-email' },
  ];
  const i1 = await imp(rows1);
  ok('a mixed file imports the good rows', i1.status < 300 && i1.data.created === 3, short(i1.data));
  ok('bad rows are skipped with a reason (short name, bad email)', i1.data.skipped?.length === 2 && i1.data.skipped.every((s) => s.reason), short(i1.data.skipped));
  ok('only rows with an email get a login, with a temporary password', i1.data.users?.length === 2 && i1.data.users.every((u) => u.password?.length >= 10), short(i1.data.users?.map((u) => u.email)));
  const i2 = await imp(rows1.slice(0, 3));
  ok('importing the same file again creates nothing (duplicates skipped)', i2.data.created === 0 && i2.data.skipped.length === 3, short(i2.data));
  const dupMail = await imp([{ name: `Bulk Five ${RUN}`, city: 'Pune', state: 'Maharashtra', email: `bulk1.${RUN}@e2e.test` }]);
  ok('an email that is already used is skipped', dupMail.data.created === 0 && /email/i.test(dupMail.data.skipped?.[0]?.reason || ''), short(dupMail.data));
  const newLogin = await login(rows1[0].email, i1.data.users[0].password);
  ok('a generated temporary password really signs in', !!newLogin);
  const own1 = (await req(newLogin, 'GET', '/fdrs')).data;
  ok('and that login is an institution login with an empty, scoped list', own1.total === 0);
  const found1 = (await req(adm, 'GET', `/institutions?q=${encodeURIComponent(RUN)}&pageSize=50`)).data;
  ok('the imported institutions appear in the institution list', found1.total >= 3, `${found1.total}`);
  ok('an institution user cannot import (403)', (await imp(rows1, inst)).status === 403);
  ok('an officer cannot import (403)', (await imp(rows1, scr)).status === 403);
  ok('an empty file is refused (400)', (await imp([])).status === 400);
  ok('more than 300 rows in one request is refused (400)', (await imp(Array.from({ length: 301 }, (_, k) => ({ name: `Too Many ${k}`, city: 'Pune', state: 'Maharashtra' })))).status === 400);
  const t0 = Date.now();
  const bulk250 = await imp(Array.from({ length: 250 }, (_, k) => ({ name: `Bulk Batch ${RUN} No. ${k + 1}`, city: 'Pune', state: 'Maharashtra' })));
  ok('250 institutions import in one batch, quickly', bulk250.data.created === 250 && Date.now() - t0 < 8000, `${bulk250.data.created} in ${Date.now() - t0} ms`);
  const audImp = (await req(adm, 'GET', '/audit?limit=20&q=INSTITUTIONS_IMPORTED')).data;
  ok('imports are audited without any password in the log', audImp.items?.length > 0 && !JSON.stringify(audImp.items).includes(i1.data.users[0].password));

  // ------------------------------------------------------------------ P. Continuous Coverage Guard
  section('P. Continuous Coverage Guard');
  const cov = (await req(scr, 'GET', '/coverage?pageSize=100')).data;
  const byName = (n) => cov.items.find((x) => x.name === n);
  ok('the officers\' overview lists institutions that have a requirement, most urgent first', cov.items?.length >= 4 && cov.items[0].status === 'SHORTFALL', short(cov.counts));
  ok('the demo shows a shortfall, an at-risk and a watch case', byName('Demo College of Engineering')?.status === 'SHORTFALL' && byName('Example Polytechnic')?.status === 'AT_RISK' && byName('Sample Institute of Technology')?.status === 'WATCH');
  ok('an at-risk row names the date and the FDR behind the gap', byName('Example Polytechnic')?.firstGap?.daysAway > 0 && byName('Example Polytechnic')?.firstGap?.causes?.length > 0);
  ok('an institution user cannot open the overview (403)', (await req(inst, 'GET', '/coverage')).status === 403);
  const tile = (await req(scr, 'GET', '/dashboard')).data.coverage;
  ok('the dashboard tile counts shortfall and at-risk institutions', tile && tile.shortfall >= 1 && tile.atRisk >= 1, short(tile));
  const myCov = (await req(inst, 'GET', '/dashboard')).data.myCoverage;
  ok('an institution sees its own cover on its dashboard', myCov && ['OK', 'WATCH', 'AT_RISK', 'SHORTFALL'].includes(myCov.status), short(myCov));

  const reqInst = await req(adm, 'POST', '/admin/institutions', { body: { name: `E2E Cover ${RUN}`, city: 'Pune', state: 'Maharashtra', requiredDeposit: 400000 } });
  ok('admin creates an institution with a required deposit', reqInst.status < 300, short(reqInst.data));
  const cvId = reqInst.data.id;
  const cvUserEmail = `cover.${RUN}@e2e.test`;
  await req(adm, 'POST', '/admin/users', { body: { email: cvUserEmail, name: 'Cover Registrar', password: 'cover-pass-1', roles: ['INSTITUTION'], institutionId: cvId } });
  const cvTok = await login(cvUserEmail, 'cover-pass-1');
  let c1 = (await req(adm, 'GET', `/coverage/institution/${cvId}`)).data;
  ok('with no FDR yet it is short by the whole requirement', c1.status === 'SHORTFALL' && c1.shortfallNow === 400000 && c1.heldNow === 0, short(c1.status));
  ok('another institution cannot read its cover (403)', (await req(multi[0].tok, 'GET', `/coverage/institution/${cvId}`)).status === 403);
  ok('it can read its own cover', (await req(cvTok, 'GET', `/coverage/institution/${cvId}`)).status === 200);

  const holdFor = async (maturityInDays, tag) => {
    const r = await req(cvTok, 'POST', '/fdrs', { form: await sampleForm(matching, { fdrNumber: `E2EC${tag}${RUN}`.toUpperCase(), issueDate: addDays(today, -30), maturityDate: addDays(today, maturityInDays) }) });
    await req(scr, 'POST', `/fdrs/${r.data.id}/start-scrutiny`, { body: {} });
    for (const [key, value] of [['fdrNumber', `E2EC${tag}${RUN}`.toUpperCase()], ['issueDate', addDays(today, -30)], ['maturityDate', addDays(today, maturityInDays)]]) {
      await req(scr, 'POST', `/fdrs/${r.data.id}/fields/${key}/review`, { body: { action: 'CORRECT', value, note: 'Corrected by the officer (e2e)' } });
    }
    return { id: r.data.id, accept: await readyAndAccept(scr, r.data.id), number: `E2EC${tag}${RUN}`.toUpperCase() };
  };
  const longFdr = await holdFor(500, 'L');
  ok('an accepted FDR (500,000 INR, matures in 500 days) is accepted', longFdr.accept.status < 300, short(longFdr.accept.data));
  c1 = (await req(adm, 'GET', `/coverage/institution/${cvId}`)).data;
  ok('cover is now OK for the whole year', c1.status === 'OK' && c1.heldNow === 500000 && c1.firstGap === null, `${c1.status} ${c1.heldNow}`);
  ok('the deposit appears in the list of instruments behind the cover', c1.instruments.some((i) => i.fdrNumber === longFdr.number));
  const raise = await req(adm, 'PATCH', `/admin/institutions/${cvId}`, { body: { requiredDeposit: 800000 } });
  ok('admin raises the requirement', raise.status < 300 && raise.data.requiredDeposit === 800000, short(raise.data));
  c1 = (await req(adm, 'GET', `/coverage/institution/${cvId}`)).data;
  ok('it becomes a shortfall of 300,000 immediately', c1.status === 'SHORTFALL' && c1.shortfallNow === 300000, `${c1.status} ${c1.shortfallNow}`);
  await req(adm, 'PATCH', `/admin/institutions/${cvId}`, { body: { requiredDeposit: 400000 } });
  const shortFdr = await holdFor(60, 'S');
  ok('a second FDR that matures in 60 days is accepted', shortFdr.accept.status < 300);
  // 500,000 (500 days) + 500,000 (60 days) held; requirement 1,000,000 -> covered now, gap in 60 days
  await req(adm, 'PATCH', `/admin/institutions/${cvId}`, { body: { requiredDeposit: 1000000 } });
  c1 = (await req(adm, 'GET', `/coverage/institution/${cvId}`)).data;
  ok('1,000,000 required: covered today, but AT_RISK with the gap 60 days away', c1.status === 'AT_RISK' && c1.heldNow === 1000000 && c1.firstGap?.daysAway === 60, `${c1.status} ${c1.firstGap?.daysAway}`);
  ok('the gap names the FDR that is about to mature', c1.firstGap?.causes?.some((x) => x.fdrNumber === shortFdr.number), short(c1.firstGap?.causes));
  ok('the timeline drops to 500,000 on the gap date', c1.timeline.some((p) => p.date === c1.firstGap.date && p.held === 500000 && p.short === 500000), short(c1.timeline));
  const repGap = (await req(scr, 'GET', `/reports/coverage-gaps?pageSize=100`)).data;
  ok('the Coverage gaps report lists it with its cause', repGap.rows.some((r) => r.institution === `E2E Cover ${RUN}` && String(r.cause).includes(shortFdr.number)), `${repGap.total}`);
  ok('the Coverage gaps report downloads as CSV', (await req(scr, 'GET', '/reports/coverage-gaps?format=csv', { raw: true })).status === 200);
  const ownRep = (await req(cvTok, 'GET', '/reports/coverage-gaps?pageSize=100')).data;
  ok('an institution\'s Coverage gaps report holds only its own row', ownRep.rows.length === 1 && ownRep.rows[0].institution === `E2E Cover ${RUN}`, short(ownRep.rows));
  await req(adm, 'PATCH', `/admin/institutions/${cvId}`, { body: { requiredDeposit: null } });
  ok('clearing the requirement makes it NOT_SET', (await req(adm, 'GET', `/coverage/institution/${cvId}`)).data.status === 'NOT_SET');
  ok('a negative requirement is refused (400)', (await req(adm, 'PATCH', `/admin/institutions/${cvId}`, { body: { requiredDeposit: -5 } })).status === 400);
  ok('an officer cannot change a requirement (403)', (await req(scr, 'PATCH', `/admin/institutions/${cvId}`, { body: { requiredDeposit: 1 } })).status === 403);
  const impReq = await imp([{ name: `Bulk Req ${RUN}`, city: 'Pune', state: 'Maharashtra', required: '12,00,000' }, { name: `Bulk BadReq ${RUN}`, city: 'Pune', state: 'Maharashtra', required: 'lots' }]);
  ok('the CSV import accepts a required deposit and rejects a bad one', impReq.data.created === 1 && impReq.data.skipped.length === 1, short(impReq.data));
  const impId = (await req(adm, 'GET', `/institutions?q=${encodeURIComponent('Bulk Req ' + RUN)}`)).data.items[0]?.id;
  ok('the imported requirement is stored', impId && (await req(adm, 'GET', `/coverage/institution/${impId}`)).data.required === 1200000);

  // ------------------------------------------------------------------ Q. pre-flight check
  section('Q. Pre-flight check before submitting');
  const totalBefore = (await req(scr, 'GET', '/fdrs?pageSize=1')).data.total;
  const pf = async (sample, overrides = {}, token = inst) => req(token, 'POST', '/fdrs/preflight', { form: await sampleForm(sample, overrides) });
  const good = await pf(matching, { fdrNumber: `E2EPF${RUN}`.toUpperCase() });
  ok('pre-flight reads the scan and compares it with the typed values', good.status === 200 && good.data.fields?.length === 9, short(good.data));
  ok('a matching scan: the typed values agree with it field by field', good.data.fields.filter((f) => f.state === 'MATCH').length >= 8 && good.data.summary.differences <= 1, short(good.data.summary));
  const bad = await pf(mismatching, { amount: '500000', ifsc: 'SBAB0002002' });
  const state = (r, k) => r.data.fields.find((f) => f.key === k)?.state;
  ok('a mismatching scan: the amount and the IFSC are shown as different', state(bad, 'amount') === 'DIFFERENT' && state(bad, 'ifsc') === 'DIFFERENT', short(bad.data.summary));
  ok('it shows both values so the institution can see the problem', bad.data.fields.find((f) => f.key === 'amount').extractedDisplay.includes('4,50,000') && bad.data.fields.find((f) => f.key === 'amount').typedDisplay.includes('5,00,000'));
  ok('and warns in plain words what would be flagged', bad.data.warnings.some((w) => w.type === 'AMOUNT_MISMATCH') && bad.data.warnings.some((w) => w.type === 'INVALID_IFSC'), short(bad.data.warnings.map((w) => w.type)));
  const fixed = await pf(mismatching, { amount: '450000', ifsc: 'SBAB0002002' });
  ok('correcting the typed amount clears that difference', state(fixed, 'amount') === 'MATCH' && !fixed.data.warnings.some((w) => w.type === 'AMOUNT_MISMATCH'));
  const blank = await req(inst, 'POST', '/fdrs/preflight', { form: (() => { const f = new FormData(); f.append('document', new Blob([png], { type: 'image/png' }), 'x.png'); return f; })() });
  ok('with nothing typed it still reads the scan (values offered, none compared)', blank.status === 200 && blank.data.fields.filter((f) => f.state === 'NOT_TYPED').length >= 8, short(blank.data.summary));
  ok('pre-flight saves nothing: the FDR count is unchanged', (await req(scr, 'GET', '/fdrs?pageSize=1')).data.total === totalBefore);
  const dupNo = await pf(matching, { fdrNumber: matching.typed.fdrNumber }, multi[2].tok);
  ok('an FDR number already on the portal is flagged without naming the other institution', dupNo.data.warnings.some((w) => w.type === 'DUPLICATE_FDR_NUMBER') && !JSON.stringify(dupNo.data.warnings).includes('Sample Institute'), short(dupNo.data.warnings.map((w) => w.type)));
  ok('officers cannot run a pre-flight check (403)', (await pf(matching, {}, scr)).status === 403);
  ok('no file is refused (400)', (await req(inst, 'POST', '/fdrs/preflight', { form: form(typedWith('PF')) })).status === 400);
  const pfTxt = form(typedWith('PT')); pfTxt.append('document', new Blob(['not an image'], { type: 'text/plain' }), 'n.txt');
  ok('a non-image file is refused (400)', (await req(inst, 'POST', '/fdrs/preflight', { form: pfTxt })).status === 400);
  ok('it needs a sign-in (401)', (await req(null, 'POST', '/fdrs/preflight', { form: await sampleForm(matching) })).status === 401);
  const pfAudit = (await req(adm, 'GET', '/audit?limit=10&q=PREFLIGHT_RUN')).data;
  ok('each check leaves one audit line (and no file)', pfAudit.items?.length > 0);
  const impactNow = (await req(scr, 'GET', '/dashboard/impact')).data;
  const accGroup = impactNow.groups.find((g) => g.key === 'accuracy').items;
  ok('Measured impact shows first-time-right and pre-flight usage', accGroup.some((i) => /right the first time/i.test(i.label)) && accGroup.find((i) => /Pre-flight/i.test(i.label))?.value >= 5, short(accGroup.map((i) => i.label)));

  // ------------------------------------------------------------------ R. verifiable release / refund order
  section('R. Verifiable release / refund order');
  const orderNo = (await req(scr, 'GET', `/fdrs/${relId}`)).data.releaseRequests[0].orderNo;
  ok('approving a release issued an order with a number', /^JSRO-\d{8}-[A-Z0-9]{6}$/.test(orderNo || ''), `${orderNo}`);
  const pub = await req(null, 'GET', `/public/orders/${orderNo}`);
  ok('anyone can check it without signing in, and it matches the audit trail', pub.status === 200 && pub.data.verdict === 'AUTHENTIC' && pub.data.chainIntact === true, short(pub.data));
  ok('the public page shows only minimal details (no amount, names or reasons)', !('amount' in pub.data) && !('checker' in pub.data) && !('maker' in pub.data) && !/Anita|Suresh|Asha/.test(JSON.stringify(pub.data)) && /\*+\d{4}$/.test(pub.data.fdrNumberMasked), short(Object.keys(pub.data)));
  ok('it says what it does and does not prove', /not an official/i.test(pub.data.notice || ''));
  ok('a made-up order number is not found (404)', (await req(null, 'GET', '/public/orders/JSRO-20000101-AAAAAA')).status === 404);
  ok('a malformed order number is refused (400)', (await req(null, 'GET', '/public/orders/not-an-order')).status === 400);
  const pdfRes = await req(scr, 'GET', `/release-orders/${orderNo}/pdf`, { raw: true });
  ok('an officer downloads the order as a PDF', pdfRes.status === 200 && /application\/pdf/.test(pdfRes.headers.get('content-type') || '') && pdfRes.data.startsWith('%PDF'), `${pdfRes.status}`);
  ok('the owning institution can download it too', (await req(inst, 'GET', `/release-orders/${orderNo}/pdf`, { raw: true })).status === 200);
  ok('another institution cannot (403)', (await req(multi[0].tok, 'GET', `/release-orders/${orderNo}/pdf`, { raw: true })).status === 403);
  ok('the PDF needs a sign-in (401)', (await req(null, 'GET', `/release-orders/${orderNo}/pdf`, { raw: true })).status === 401);
  const rejectedView = (await req(scr, 'GET', `/fdrs/${anchors.s6b}`)).data.releaseRequests[0];
  ok('a rejected release gets no order', rejectedView.status === 'REJECTED' && rejectedView.orderNo === null);
  const approvedView = (await req(scr, 'GET', `/fdrs/${anchors.s6c}`)).data.releaseRequests[0];
  ok('the second approved release got its own, different order', approvedView.status === 'APPROVED' && /^JSRO-/.test(approvedView.orderNo || '') && approvedView.orderNo !== orderNo);
  const seededOrders = (await req(scr, 'GET', '/fdrs?status=RELEASED&pageSize=100')).data.items;
  const seededNo = (await req(scr, 'GET', `/fdrs/${seededOrders.find((f) => f.id !== relId && f.id !== anchors.s6c).id}`)).data.releaseRequests[0].orderNo;
  ok('releases from the demo history have verifiable orders too', !!seededNo && (await req(null, 'GET', `/public/orders/${seededNo}`)).data.verdict === 'AUTHENTIC');
  const orderAudit = (await req(adm, 'GET', '/audit?limit=10&q=RELEASE_ORDER_ISSUED')).data;
  ok('each order is anchored by an entry in the audit trail', orderAudit.items?.length >= 2);

  // ------------------------------------------------------------------ M3. blocking, policy, monitor, risk
  section('M3. Resolution: blocking, policy, milestones, risk');
  const esc2 = anchors.esc2;
  const matE = (await req(scr, 'GET', `/fdrs/${esc2}/maturity`)).data;
  ok('an FDR matured 35+ days ago shows its age and a critical band', matE.daysPastMaturity >= 35 && matE.band === 'MATURED_CRITICAL' && matE.pendingResolution === true, short(matE));
  const race = await Promise.all([
    req(scr, 'POST', `/fdrs/${esc2}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'Simultaneous request A (e2e)' } }),
    req(scr, 'POST', `/fdrs/${esc2}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'Simultaneous request B (e2e)' } }),
  ]);
  ok('two simultaneous requests open exactly one case', race.filter((r) => r.status < 300).length === 1 && race.filter((r) => r.status === 409).length === 1, race.map((r) => r.status).join(','));
  const caseE = race.find((r) => r.status < 300).data.id;
  const otherInst = multi[0].tok;
  ok('another institution cannot see the case (404)', (await req(otherInst, 'GET', `/resolutions/${caseE}`)).status === 404);
  ok('another institution cannot open one on this FDR (404)', (await req(otherInst, 'POST', `/fdrs/${esc2}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'Not my FDR at all' } })).status === 404);
  const blockedE = await req(scr, 'POST', `/resolutions/${caseE}/submit`, { body: {} });
  ok('without bank confirmation the case is blocked and says why', blockedE.status < 300 && blockedE.data.state === 'BLOCKED' && blockedE.data.blockedReasons.some((r) => /0\/9/.test(r)), short(blockedE.data.blockedReasons));
  const blockedApprove = await req(app, 'POST', `/resolutions/${caseE}/approve`, { body: { comment: 'Trying to approve a blocked case' } });
  ok('a blocked case cannot be approved (400)', blockedApprove.status === 400);
  const pol = await req(adm, 'PATCH', '/resolution-policy', { body: { requireBank: false } });
  ok('admin can relax the bank requirement', pol.status < 300 && pol.data.requireBank === false, short(pol.data));
  ok('a scrutiny officer cannot change the policy (403)', (await req(scr, 'PATCH', '/resolution-policy', { body: { requireBank: true } })).status === 403);
  await req(scr, 'POST', `/resolutions/${caseE}/reopen`, { body: {} });
  const relaxed = await req(scr, 'POST', `/resolutions/${caseE}/submit`, { body: {} });
  ok('with the requirement relaxed the case reaches approval, still showing the bank check as not done', relaxed.status < 300 && relaxed.data.state === 'APPROVAL_PENDING' && relaxed.data.checks.some((c) => c.key === 'BANK_CONFIRMED' && !c.pass), short(relaxed.data.state));
  await req(adm, 'PATCH', '/resolution-policy', { body: { requireBank: true } });
  const strict = await req(app, 'POST', `/resolutions/${caseE}/approve`, { body: { comment: 'Approving after policy tightened' } });
  ok('if the policy is tightened again, approval re-checks the live record and is refused (400)', strict.status === 400 && /blocked/i.test(JSON.stringify(strict.data)), short(strict.data));
  const rej = await req(app, 'POST', `/resolutions/${caseE}/reject`, { body: { comment: 'Rejected: bank confirmation still missing' } });
  ok('the approver rejects it with a reason; the case is final', rej.status < 300 && rej.data.state === 'REJECTED' && rej.data.approvals.at(-1).decision === 'REJECTED', short(rej.data.state));
  ok('a rejected case cannot be reopened (400)', (await req(scr, 'POST', `/resolutions/${caseE}/reopen`, { body: {} })).status === 400);
  const fresh = await req(scr, 'POST', `/fdrs/${esc2}/resolutions`, { body: { type: 'RENEWAL', delayReason: 'New case after the rejection (e2e)', dueDate: '2020-01-01' } });
  ok('after a rejection a new case can be opened', fresh.status < 300, short(fresh.data));
  const esc = await req(scr, 'POST', `/resolutions/${fresh.data.id}/escalate`, { body: { reason: 'No response from the institution (e2e)' } });
  ok('an officer escalates the case', esc.status < 300 && esc.data.escalationLevel === 1, short(esc.data));
  ok('the institution cannot escalate (403)', (await req(otherInst, 'POST', `/resolutions/${fresh.data.id}/escalate`, { body: { reason: 'Not allowed to do this' } })).status === 403);
  const run1 = await req(adm, 'POST', '/admin/radar/run', { body: {} });
  const run2 = await req(adm, 'POST', '/admin/radar/run', { body: {} });
  const n1 = run1.data?.summary?.maturityNotices ?? run1.data?.maturityNotices;
  const n2 = run2.data?.summary?.maturityNotices ?? run2.data?.maturityNotices;
  ok('the monitor announces milestones (and the missed case deadline)', typeof n1 === 'number' && n1 >= 0, short(run1.data));
  ok('re-running the scheduler sends no duplicate notices', n2 === 0, `second run sent ${n2}`);
  const apprNotes = (await req(app, 'GET', '/notifications')).data;
  const pm = (apprNotes.items || apprNotes).filter((n) => n.kind === 'MATURITY' && n.fdrId === esc2);
  ok('each milestone notice appears once per recipient', pm.length === new Set(pm.map((n) => n.title)).size, `${pm.length} notices`);
  const risk = (await req(scr, 'GET', '/dashboard/maturity-risk')).data;
  ok('the maturity-risk figures come from the records', risk.unresolved >= 1 && risk.critical >= 1 && risk.worst.some((w) => w.id === esc2) && typeof risk.casesByState === 'object', short(risk));
  const dash = (await req(scr, 'GET', '/dashboard')).data;
  ok('the dashboard carries the same figures', dash.maturityRisk?.unresolved === risk.unresolved);
  const instRisk = (await req(otherInst, 'GET', '/dashboard/maturity-risk')).data;
  ok('an institution only sees its own at-risk deposits', !instRisk.worst.some((w) => w.id === esc2) || false);
  await req(scr, 'POST', `/resolutions/${fresh.data.id}/cancel`, { body: { reason: 'Test finished, cancelling (e2e)' } });

  // ------------------------------------------------------------------ L. audit chain
  section('L. Audit trail');
  const aud = (await req(adm, 'GET', '/audit?limit=200&q=BANK_CHECK')).data;
  ok('bank checks appear in the audit trail', aud.items?.some((a) => /BANK_CHECK/.test(a.action)));
  const ver = (await req(adm, 'GET', '/audit/verify')).data;
  ok('the hash chain is intact after all of this', ver.intact === true, short(ver));

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(' - ' + f); process.exit(1); }
})().catch((e) => { console.error('Test run crashed:', e); process.exit(2); });
