/**
 * Scale test data: adds ~5,000 institutions, ~5,000 institution users and ~8,000 FDRs (with their field rows and
 * a couple of transitions each) so the portal can be tried at the size of the real problem.
 *
 *   npm run seed:scale          (adds; skipped if the data is already there)
 *   npm run seed                (resets everything back to the small demo data set)
 *
 * It writes straight to the database and does NOT run OCR or write audit entries, so the scale FDRs have no
 * uploaded document and are not part of the audit chain. Everything here is fictional.
 */
import { PrismaClient, FdrStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DEMO_PASSWORD } from '../config';
import { FIELD_KEYS, REQUIRED_AUTHORITY_NAME } from '../domain/fields';

const INSTITUTIONS = Number(process.env.SCALE_INSTITUTIONS || 5000);
const FDRS = Number(process.env.SCALE_FDRS || 8000);
const prisma = new PrismaClient();

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Gujarat', 'Haryana', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const CITIES = ['Pune', 'Nagpur', 'Salem', 'Jaipur', 'Lucknow', 'Bhopal', 'Patna', 'Kochi', 'Mysuru', 'Indore', 'Surat', 'Vellore', 'Ranchi', 'Raipur', 'Guwahati', 'Dehradun', 'Warangal', 'Cuttack', 'Ludhiana', 'Kolkata'];
const KINDS = ['College of Engineering', 'Institute of Technology', 'Polytechnic', 'School of Management', 'College of Pharmacy', 'Institute of Architecture'];
const PREFIX = ['Sample', 'Example', 'Demo', 'Specimen', 'Fictional', 'Model', 'Test'];
const BANKS = ['Sample Bank A', 'Sample Bank B', 'Sample Bank C', 'Sample Bank D'];
// [status, share of FDRs, earliest maturity offset in days, latest]
const MIX: [FdrStatus, number, number, number][] = [
  ['ACCEPTED', 0.4, 100, 700], ['EXPIRING_SOON', 0.1, 1, 90], ['MATURED', 0.08, -120, -1], ['UNDER_SCRUTINY', 0.1, 100, 600], ['SUBMITTED', 0.08, 100, 600],
  ['DISCREPANCY_RAISED', 0.05, 100, 600], ['RENEWAL_PENDING', 0.03, -10, 60], ['RELEASE_REQUESTED', 0.03, -90, -5], ['RELEASED', 0.06, -300, -30],
  ['RENEWED', 0.03, -300, -30], ['REJECTED', 0.02, 100, 600], ['DRAFT', 0.02, 100, 600],
];
const pick = <T>(a: T[], i: number) => a[i % a.length];
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
async function batched<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

async function main() {
  const existing = await prisma.institution.count();
  if (existing > 1000) {
    console.log(`Already holds ${existing} institutions; nothing to add. Run "npm run seed" to reset.`);
    return;
  }
  const t0 = Date.now();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10); // one hash reused for every account (password demo123)
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

  const insts = Array.from({ length: INSTITUTIONS }, (_, i) => ({
    id: randomUUID(), name: `${pick(PREFIX, i)} ${pick(KINDS, i * 7)} No. ${i + 1}`, city: pick(CITIES, i * 3), state: pick(STATES, i),
  }));
  await batched(insts, 2000, (c) => prisma.institution.createMany({ data: c }));
  await batched(insts, 2000, (c) => prisma.user.createMany({
    data: c.map((x, i) => ({ id: randomUUID(), email: `scale${insts.indexOf(x) + 1}@scale.test`, name: `Registrar, ${x.name}`, passwordHash: hash, roles: ['INSTITUTION' as const], institutionId: x.id })),
  }));
  console.log(`  ${INSTITUTIONS} institutions and users`);

  const fdrs: any[] = [], fields: any[] = [], trans: any[] = [], discs: any[] = [];
  let n = 0;
  for (const [status, share, lo, hi] of MIX) {
    const count = Math.round(FDRS * share);
    for (let k = 0; k < count; k++, n++) {
      const inst = insts[rnd(0, insts.length - 1)];
      const id = randomUUID();
      const amount = rnd(2, 40) * 50000;
      const maturity = addDays(today, rnd(lo, hi));
      const issue = addDays(maturity, -365);
      const number = `FDR2026S${String(n + 1).padStart(6, '0')}`;
      const bank = pick(BANKS, n);
      const ifsc = `SBS${'ABCD'[n % 4]}000${String(1000 + (n % 9000))}`.slice(0, 11);
      const by = `Registrar, ${inst.name}`;
      fdrs.push({ id, institutionId: inst.id, status, fdrNumber: number, bankName: bank, ifsc, amount, issueDate: issue, maturityDate: maturity, createdById: 'scale-seed', createdByName: by, createdAt: addDays(today, -rnd(5, 200)) });
      const typed: Record<string, string> = { fdrNumber: number, bank, branch: `${pick(CITIES, n)} Main`, ifsc, amount: String(amount), issueDate: iso(issue), maturityDate: iso(maturity), depositorName: inst.name, inFavourOf: REQUIRED_AUTHORITY_NAME };
      for (const key of FIELD_KEYS) fields.push({ id: randomUUID(), fdrId: id, key, submittedValue: typed[key], submittedByName: by, submittedAt: addDays(today, -30) });
      if (status !== 'DRAFT') trans.push({ id: randomUUID(), fdrId: id, toStatus: 'SUBMITTED', actorLabel: by, at: addDays(today, -rnd(20, 120)) });
      if (['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'RELEASED', 'RENEWED', 'REJECTED'].includes(status)) {
        trans.push({ id: randomUUID(), fdrId: id, fromStatus: 'UNDER_SCRUTINY', toStatus: status === 'REJECTED' ? 'REJECTED' : 'ACCEPTED', actorLabel: 'Scale seed', at: addDays(today, -rnd(1, 19)) });
      }
      if (status === 'DISCREPANCY_RAISED') discs.push({ id: randomUUID(), fdrId: id, type: 'AMOUNT_MISMATCH' as const, fieldKey: 'amount', reason: 'Scale test flag: typed amount differs from the document.', raisedByLabel: 'Automatic check', createdAt: addDays(today, -rnd(1, 30)) });
    }
  }
  await batched(fdrs, 2000, (c) => prisma.fdr.createMany({ data: c }));
  await batched(fields, 5000, (c) => prisma.fdrField.createMany({ data: c }));
  await batched(trans, 5000, (c) => prisma.fdrTransition.createMany({ data: c }));
  await batched(discs, 2000, (c) => prisma.discrepancy.createMany({ data: c }));
  console.log(`  ${fdrs.length} FDRs, ${fields.length} field rows, ${trans.length} transitions, ${discs.length} open discrepancies`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Scale institution logins: scale1@scale.test ... (password ${DEMO_PASSWORD}).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
