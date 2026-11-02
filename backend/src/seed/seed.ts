/**
 * Seed: all data is fictional. No real banks, logos or institutions.
 * Run with `npm run seed` (resets the database to the demo state).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { Role, FdrStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService, ensureAuditImmutability } from '../infra/prisma.service';
import { AuditService, Actor, SYSTEM_ACTOR } from '../infra/audit.service';
import { StorageService } from '../infra/storage.service';
import { OcrService } from '../infra/ocr.service';
import { FdrsService, sniffMime } from '../fdrs/fdrs.service';
import { RadarService } from '../radar/radar.service';
import { LifecycleService } from '../infra/lifecycle.service';
import { ClockService } from '../infra/clock.service';
import { DEMO_PASSWORD } from '../config';
import { addDays, isoDate } from '../domain/dates';
import { FIELD_KEYS, FieldKey, REQUIRED_AUTHORITY_NAME } from '../domain/fields';
import { emptyChecklist, CHECKLIST_KEYS } from '../domain/maker-checker';
import { DD_MM_YYYY, renderFdrImage, SampleDoc } from '../demo/sample-image';
import { SAMPLES } from '../demo/demo.controller';
import { OrdersService } from '../orders/orders.service';
import { createHash, randomUUID } from 'crypto';

// Five institutions in three states: enough to show several institutions side by side. "Add an institution" in Admin does the rest.
const INSTITUTIONS = [
  ['Sample Institute of Technology', 'Salem', 'Tamil Nadu'],
  ['Demo College of Engineering', 'Coimbatore', 'Tamil Nadu'],
  ['Example Polytechnic', 'Madurai', 'Tamil Nadu'],
  ['Fictional School of Management', 'Pune', 'Maharashtra'],
  ['Sample Engineering College', 'Nagpur', 'Maharashtra'],
] as const;

const BANKS = [
  { name: 'Sample Bank A', code: 'SBAA' },
  { name: 'Sample Bank B', code: 'SBAB' },
  { name: 'Sample Bank C', code: 'SBAC' },
  { name: 'Sample Bank D', code: 'SBAD' },
];

type DocVariant = 'none' | 'match' | 'badIfsc' | 'badIfscNotFavour' | 'notFavour' | 'dupDoc';
type BankSim = 'none' | 'match' | 'mismatch' | 'notfound' | 'outage';

interface Spec {
  key?: string; // demo anchor name
  inst: number;
  bank: number;
  amount: number;
  status: FdrStatus;
  /** days from today to maturity */
  mat: number;
  /** length of deposit in days (issue = maturity - term) */
  term?: number;
  doc?: DocVariant;
  sim?: BankSim;
  bankChecked?: boolean;
  /** IFSC printed on the document (to create a document with an invalid IFSC) */
  typedIfsc?: string;
  number?: string;
  note?: string;
}

// ---------------------------------------------------------------- a small demo set (about 24 FDRs)
// Every status, every bank-simulator outcome, escalations, a cross-institution duplicate and the six scenarios.
// For thousands of records use "npm run seed:scale" instead of adding more here.
const SPECS: Spec[] = [
  // ---- scenario anchors
  { key: 's2', inst: 0, bank: 0, amount: 1000000, status: 'ACCEPTED', mat: 214, doc: 'match', sim: 'match', bankChecked: true, note: 'Scenario 2: validity tracking (Active, with days to maturity)' },
  { key: 's3', inst: 0, bank: 1, amount: 750000, status: 'ACCEPTED', mat: 95, doc: 'match', sim: 'match', bankChecked: true, note: 'Scenario 3: approaching maturity (jump the demo clock)' },
  { key: 's4', inst: 0, bank: 2, amount: 600000, status: 'MATURED', mat: -3, doc: 'match', sim: 'match', bankChecked: true, note: 'Scenario 4: renewal (request, then upload the renewed FDR)' },
  { key: 's5', inst: 1, bank: 0, amount: 500000, status: 'UNDER_SCRUTINY', mat: 330, doc: 'badIfscNotFavour', sim: 'match', note: 'Scenario 5: the document shows an invalid IFSC and a lien holder that is not AICTE, awaiting the scrutiny officer' },
  { key: 's6a', inst: 0, bank: 1, amount: 1200000, status: 'MATURED', mat: -12, doc: 'match', sim: 'match', bankChecked: true, note: 'Scenario 6: institution requests release' },
  { key: 's6b', inst: 1, bank: 2, amount: 900000, status: 'RELEASE_REQUESTED', mat: -20, doc: 'match', sim: 'match', bankChecked: true, note: 'Scenario 6: maker ticks checklist and recommends' },
  { key: 's6c', inst: 2, bank: 3, amount: 850000, status: 'RELEASE_RECOMMENDED', mat: -25, doc: 'match', sim: 'match', bankChecked: true, note: 'Scenario 6: checker approves' },
  { key: 's6d', inst: 2, bank: 0, amount: 700000, status: 'RELEASE_RECOMMENDED', mat: -30, doc: 'match', sim: 'match', bankChecked: true, note: 'Release recommended by scrutiny; awaiting the approving officer' },
  { key: 'renewedOld', inst: 3, bank: 0, amount: 800000, status: 'RENEWED', mat: -40, term: 365, doc: 'match', sim: 'match', bankChecked: true, note: 'Renewal chain (old FDR)' },
  { key: 'renewedNew', inst: 3, bank: 0, amount: 800000, status: 'ACCEPTED', mat: 325, term: 365, doc: 'match', sim: 'match', bankChecked: true, note: 'Renewal chain (new FDR)' },

  // ---- bank simulator variety
  { key: 'bankMismatch', inst: 4, bank: 1, amount: 650000, status: 'DISCREPANCY_RAISED', mat: 280, doc: 'match', sim: 'mismatch', bankChecked: true, note: 'Bank simulator: MISMATCH' },
  { key: 'bankNotFound', inst: 4, bank: 2, amount: 400000, status: 'DISCREPANCY_RAISED', mat: 260, doc: 'match', sim: 'notfound', bankChecked: true, note: 'Bank simulator: NOT_FOUND' },
  { key: 'bankOutage', inst: 3, bank: 3, amount: 550000, status: 'UNDER_SCRUTINY', mat: 300, doc: 'match', sim: 'outage', note: 'Bank simulator: SERVICE_UNAVAILABLE' },
  { key: 'bankMatch', inst: 3, bank: 0, amount: 450000, status: 'UNDER_SCRUTINY', mat: 310, doc: 'match', sim: 'match', note: 'Bank simulator: MATCH (run the bank check)' },

  // ---- approaching and past maturity (the second one has an escalated reminder)
  { inst: 1, bank: 1, amount: 500000, status: 'EXPIRING_SOON', mat: 6, doc: 'match', sim: 'match', bankChecked: true },
  { inst: 2, bank: 2, amount: 350000, status: 'EXPIRING_SOON', mat: 74, doc: 'match', sim: 'match' },
  { key: 'esc2', inst: 1, bank: 0, amount: 700000, status: 'MATURED', mat: -35, doc: 'match', sim: 'match', note: 'Reminder unacknowledged for a long time: escalated to the approving officer' },
  { inst: 1, bank: 3, amount: 640000, status: 'RENEWAL_PENDING', mat: -6, doc: 'match', sim: 'match', bankChecked: true },
  { inst: 3, bank: 2, amount: 720000, status: 'RELEASED', mat: -80, doc: 'match', sim: 'match', bankChecked: true },

  // ---- fresh submissions, problem documents and rejection
  { inst: 0, bank: 3, amount: 275000, status: 'DRAFT', mat: 365, doc: 'none' },
  { inst: 3, bank: 1, amount: 360000, status: 'SUBMITTED', mat: 320, doc: 'none', sim: 'match', note: 'No document: Missing document flag' },
  { inst: 1, bank: 1, amount: 505000, status: 'DISCREPANCY_RAISED', mat: 270, doc: 'notFavour', sim: 'match', note: 'Not in favour of the required authority' },
  { inst: 2, bank: 2, amount: 390000, status: 'DISCREPANCY_RAISED', mat: 285, doc: 'badIfsc', sim: 'match', typedIfsc: 'SBAC1009009', note: 'Invalid IFSC on the document' },
  { inst: 2, bank: 0, amount: 200000, status: 'REJECTED', mat: 200, doc: 'match', sim: 'notfound' },

  // ---- the same FDR number used by two different institutions
  { key: 'dupNumA', inst: 4, bank: 3, amount: 480000, status: 'UNDER_SCRUTINY', mat: 250, doc: 'match', sim: 'match', number: 'FDDUP2026001', note: 'Duplicate FDR number (1 of 2)' },
  { key: 'dupNumB', inst: 1, bank: 3, amount: 480000, status: 'SUBMITTED', mat: 250, doc: 'match', number: 'FDDUP2026001', note: 'Duplicate FDR number (2 of 2, different institution)' },
];

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const storage = app.get(StorageService);
  const ocr = app.get(OcrService);
  const fdrsSvc = app.get(FdrsService);
  const radar = app.get(RadarService);
  const lifecycle = app.get(LifecycleService);
  const clock = app.get(ClockService);
  const orders = app.get(OrdersService);

  console.log('Resetting database...');
  await ensureAuditImmutability(prisma);
  await prisma.$executeRawUnsafe(
    `TRUNCATE "MilestoneNotice","ResolutionCase","ReleaseOrder","EmailLog","AuditLog","EscalationEvent","Reminder","Notification","ReleaseRequest","Discrepancy","Document","FdrField","FdrTransition","Fdr","SimBankRecord","ReminderRule","Setting","User","Institution" RESTART IDENTITY CASCADE`,
  );
  await clock.setDemoDate(null);
  const today = await clock.today();

  // ---- reminder rules
  for (const d of [90, 60, 30, 7]) await prisma.reminderRule.create({ data: { days: d } });
  await prisma.setting.create({ data: { key: 'escalationDays', value: '7' } });

  // ---- institutions
  const insts = [];
  for (const [name, city, state] of INSTITUTIONS) insts.push(await prisma.institution.create({ data: { name, city, state } }));

  // ---- users (password demo123 for all; fictional)
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const mk = (email: string, name: string, roles: Role[], institutionId?: string) =>
    prisma.user.create({ data: { email, name, roles, passwordHash: hash, institutionId: institutionId ?? null } });
  const uInst = await mk('institution@demo.test', 'Anita Raman (Institution)', ['INSTITUTION'], insts[0].id);
  const uScr = await mk('scrutiny@demo.test', 'Suresh Kumar (Scrutiny Officer)', ['SCRUTINY']);
  const uApp = await mk('approver@demo.test', 'Asha Verma (Approving Officer)', ['APPROVER']);
  const uAdmin = await mk('admin@demo.test', 'Divya Nair (Admin)', ['ADMIN']);
  // one user for every other institution so reminders have recipients
  const instUsers: Record<number, { id: string; name: string; email: string }> = { 0: uInst };
  for (let i = 1; i < insts.length; i++) instUsers[i] = await mk(`inst${i + 1}@demo.test`, `Registrar, ${insts[i].name}`, ['INSTITUTION'], insts[i].id);

  const act = (u: { id: string; email: string; name: string }, role: string): Actor => ({ id: u.id, email: u.email, name: u.name, role });
  await audit.log({ actor: act(uAdmin, 'ADMIN'), action: 'DEMO_DATA_SEEDED', entityType: 'System', detail: { institutions: insts.length, users: 4 + insts.length - 1, note: 'All data is fictional.' } });

  // ---- FDRs
  const anchors: Record<string, string> = {};
  const sharedDupDoc: { buf?: Buffer } = {};
  let seq = 1;
  const created: { id: string; spec: Spec; doc?: SampleDoc }[] = [];

  for (const spec of SPECS) {
    const inst = insts[spec.inst];
    const owner = instUsers[spec.inst];
    const bank = BANKS[spec.bank];
    const term = spec.term ?? 365;
    const maturity = addDays(today, spec.mat);
    const issue = addDays(maturity, -term);
    const number = spec.number ?? `FD${issue.getUTCFullYear()}${bank.code.slice(-1)}${pad(seq)}`;
    const ifsc = spec.typedIfsc ?? `${bank.code}0${pad(spec.inst * 7 + spec.bank + 100, 6)}`;
    const branch = `${inst.city} Main`;
    const typed: Record<FieldKey, string> = {
      fdrNumber: number,
      bank: bank.name,
      branch,
      ifsc,
      amount: String(spec.amount),
      issueDate: isoDate(issue)!,
      maturityDate: isoDate(maturity)!,
      depositorName: `${inst.name}, ${inst.city}`,
      inFavourOf: REQUIRED_AUTHORITY_NAME,
    };
    seq++;

    const createdAt = addDays(issue, 1);
    const fdr = await prisma.fdr.create({
      data: {
        institutionId: inst.id,
        status: 'DRAFT',
        createdById: owner.id,
        createdByName: owner.name,
        createdAt,
      },
    });
    await prisma.fdrField.createMany({
      data: FIELD_KEYS.map((key) => ({ fdrId: fdr.id, key, submittedValue: typed[key], submittedById: owner.id, submittedByName: owner.name, submittedAt: createdAt })),
    });
    await fdrsSvc.syncSummary(fdr.id);
    await audit.log({ actor: act(owner, 'INSTITUTION'), action: 'FDR_CREATED', entityType: 'Fdr', entityId: fdr.id, detail: { fdrNumber: number, values: typed, seeded: true } });
    if (spec.key) anchors[spec.key] = fdr.id;

    // --- document + OCR
    let docSpec: SampleDoc | undefined;
    const variant = spec.doc ?? 'none';
    if (variant !== 'none') {
      docSpec = {
        bank: bank.name,
        fdrNumber: number,
        branch,
        ifsc,
        depositor: typed.depositorName,
        amount: spec.amount,
        issueDate: DD_MM_YYYY(typed.issueDate),
        maturityDate: DD_MM_YYYY(typed.maturityDate),
        inFavourOf: REQUIRED_AUTHORITY_NAME,
      };
      if (variant === 'badIfsc' || variant === 'badIfscNotFavour') docSpec.ifsc = ifsc.slice(0, 4) + '1' + ifsc.slice(5);
      if (variant === 'notFavour' || variant === 'badIfscNotFavour') docSpec.inFavourOf = 'Sample Education Trust';
      // The institution only uploads the document, so what it submits is what the document shows.
      const fromDoc: Partial<Record<FieldKey, string>> = {};
      if (docSpec.ifsc !== ifsc) fromDoc.ifsc = docSpec.ifsc;
      if (docSpec.inFavourOf !== REQUIRED_AUTHORITY_NAME) fromDoc.inFavourOf = docSpec.inFavourOf;
      for (const [k, val] of Object.entries(fromDoc)) await prisma.fdrField.update({ where: { fdrId_key: { fdrId: fdr.id, key: k } }, data: { submittedValue: val } });
      if (Object.keys(fromDoc).length) await fdrsSvc.syncSummary(fdr.id);
      let buf: Buffer;
      if (variant === 'dupDoc') buf = sharedDupDoc.buf!;
      else {
        buf = await renderFdrImage(docSpec);
        if (spec.key === 'dupDocA') sharedDupDoc.buf = buf;
      }
      if (variant === 'dupDoc') docSpec = undefined;
      const mime = sniffMime(buf)!;
      const storageKey = `fdr/${fdr.id}/${randomUUID()}`;
      await storage.put(storageKey, buf);
      const doc = await prisma.document.create({
        data: {
          fdrId: fdr.id,
          fileName: `fdr-scan-${number}.png`,
          mimeType: mime,
          sizeBytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          storageKey,
          uploadedById: owner.id,
          uploadedByName: owner.name,
          uploadedAt: createdAt,
        },
      });
      await audit.log({ actor: act(owner, 'INSTITUTION'), action: 'DOCUMENT_UPLOADED', entityType: 'Document', entityId: doc.id, detail: { fdrId: fdr.id, fileName: doc.fileName, sha256: doc.sha256, seeded: true } });
      const res = await ocr.extract(buf, mime);
      await prisma.document.update({ where: { id: doc.id }, data: { ocrStatus: res.status, ocrNote: res.note, ocrText: res.text.slice(0, 20000), ocrMeanConfidence: res.meanConfidence } });
      for (const key of FIELD_KEYS) {
        const p = res.fields[key];
        if (!p) continue;
        await prisma.fdrField.update({
          where: { fdrId_key: { fdrId: fdr.id, key } },
          data: { extractedValue: p.value, extractedConfidence: p.confidence, extractedAt: createdAt, extractedDocId: doc.id, extractedBy: 'tesseract.js + regex parser' },
        });
      }
      await audit.log({ actor: act(owner, 'INSTITUTION'), action: 'OCR_RUN', entityType: 'Document', entityId: doc.id, detail: { fdrId: fdr.id, status: res.status, fieldsFound: Object.keys(res.fields), seeded: true } });
      process.stdout.write(`  ${number}: OCR ${res.status} (${Object.keys(res.fields).length}/9 fields)\n`);
    }

    // --- simulator record (what the "bank" holds)
    const sim = spec.sim ?? 'none';
    if (sim !== 'none' && sim !== 'notfound') {
      await prisma.simBankRecord.upsert({
        where: { fdrNumber: number },
        update: {},
        create: {
          fdrNumber: number,
          bankName: bank.name,
          branch,
          ifsc,
          amount: sim === 'mismatch' ? spec.amount - 50000 : spec.amount,
          issueDate: issue,
          maturityDate: sim === 'mismatch' ? addDays(maturity, 15) : maturity,
          depositorName: typed.depositorName,
          inFavourOf: REQUIRED_AUTHORITY_NAME,
          outage: sim === 'outage',
        },
      });
    }

    // --- lifecycle: walk the real state machine to the target status
    created.push({ id: fdr.id, spec, doc: docSpec });
    await walk(fdr.id, spec, owner, uScr, uApp);
    if (spec.bankChecked && sim !== 'none') await recordBankCheck(fdr.id, spec, uScr);
  }

  // ---- required security deposit per institution (Coverage Guard). Chosen so the demo shows each case:
  //  0 Salem: held 17.5 lakh, a 7.5 lakh FDR matures in 95 days -> a gap appears later (watch / at risk once close)
  //  1 Coimbatore: holds only 5 lakh against 10 lakh -> shortfall now
  //  2 Madurai: holds 3.5 lakh against 3 lakh, but it matures in 74 days -> at risk
  //  3 Pune: 8 lakh held, renewed FDR matures in 325 days -> watch
  //  4 Nagpur: no requirement entered yet -> not set
  const REQUIRED = [1500000, 1000000, 300000, 800000, null];
  for (let i = 0; i < REQUIRED.length; i++) if (REQUIRED[i] !== null) await prisma.institution.update({ where: { id: insts[i].id }, data: { requiredDeposit: REQUIRED[i] } });

  // ---- renewal chain link
  await prisma.fdr.update({ where: { id: anchors.renewedNew }, data: { previousFdrId: anchors.renewedOld } });

  // ---- release requests for release-stage FDRs
  for (const key of ['s6b', 's6c', 's6d']) {
    const id = anchors[key];
    const fdr = await prisma.fdr.findUniqueOrThrow({ where: { id } });
    const owner = (await prisma.user.findUniqueOrThrow({ where: { id: fdr.createdById } }));
    const base = { fdrId: id, reason: 'Deposit has matured and the security requirement is complete.', requestedById: owner.id, requestedByName: owner.name, requestedAt: addDays(today, -4) };
    if (key === 's6b') {
      await prisma.releaseRequest.create({ data: { ...base, checklist: emptyChecklist() as any } });
    } else {
      const maker = uScr;
      const checklist = CHECKLIST_KEYS.map((k) => ({ key: k, ticked: true, note: 'Verified from records (demo data)' }));
      await prisma.releaseRequest.create({
        data: { ...base, status: 'RECOMMENDED', checklist: checklist as any, makerId: maker.id, makerName: maker.name, makerNote: 'All conditions met (demo)', recommendedAt: addDays(today, -2) },
      });
    }
    await audit.log({ actor: act(owner, 'INSTITUTION'), action: 'RELEASE_REQUESTED', entityType: 'ReleaseRequest', entityId: id, detail: { fdrId: id, fdrNumber: fdr.fdrNumber, seeded: true } });
  }
  // the already-RELEASED ones get a closed request for history
  for (const f of await prisma.fdr.findMany({ where: { status: 'RELEASED' } })) {
    const approved = await prisma.releaseRequest.create({
      data: {
        fdrId: f.id, reason: 'Deposit matured; released (demo history).', requestedById: f.createdById, requestedByName: f.createdByName, requestedAt: addDays(today, -60),
        status: 'APPROVED', checklist: CHECKLIST_KEYS.map((k) => ({ key: k, ticked: true, note: 'Verified (demo)' })) as any,
        makerId: uScr.id, makerName: uScr.name, makerNote: 'OK', recommendedAt: addDays(today, -58),
        checkerId: uApp.id, checkerName: uApp.name, decisionReason: 'Approved (demo history).', decidedAt: addDays(today, -55),
      },
    });
    // a real, verifiable order for the seeded approval (its hash is anchored in the audit trail)
    await orders.issue(approved.id, act(uApp, 'APPROVER'));
  }

  // Scenario 5 starts with two Open discrepancies and the other pipeline items keep theirs open.
  // The bank-flagged anchors: make sure they have an Open flag matching the bank result.
  for (const key of ['bankMismatch', 'bankNotFound']) {
    const id = anchors[key];
    const type = key === 'bankMismatch' ? 'BANK_MISMATCH' : 'BANK_NOT_FOUND';
    if (!(await prisma.discrepancy.findFirst({ where: { fdrId: id, type } }))) {
      await prisma.discrepancy.create({
        data: { fdrId: id, type, reason: key === 'bankMismatch' ? 'The simulated bank record differs from the values held for: deposit amount, maturity date. Compare the Bank (simulation) column in the truth table.' : 'The simulated bank has no record of this FDR number.', raisedByLabel: 'Suresh Kumar (bank check)' },
      });
    }
  }

  // ---- discrepancies: run the real rules on every non-draft FDR
  for (const c of created) {
    const f = await prisma.fdr.findUniqueOrThrow({ where: { id: c.id } });
    if (f.status === 'DRAFT') continue;
    await fdrsSvc.reevaluate(c.id, SYSTEM_ACTOR, { changeStatus: false });
  }

  // Seeded officer reviews + closed discrepancies on accepted/past-scrutiny FDRs
  for (const c of created) {
    const f = await prisma.fdr.findUniqueOrThrow({ where: { id: c.id } });
    const past = !['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'].includes(f.status);
    if (!past) continue;
    await prisma.discrepancy.updateMany({
      where: { fdrId: c.id, status: 'OPEN' },
      data: { status: f.status === 'REJECTED' ? 'WAIVED' : 'RESOLVED', resolutionNote: 'Checked against the document during scrutiny (demo data).', resolvedByName: uScr.name, resolvedById: uScr.id, resolvedAt: addDays(today, -30) },
    });
    for (const fld of await prisma.fdrField.findMany({ where: { fdrId: c.id, extractedValue: { not: null } } })) {
      await prisma.fdrField.update({ where: { id: fld.id }, data: { reviewAction: 'CONFIRMED', reviewedValue: fld.extractedValue, reviewedById: uScr.id, reviewedByName: uScr.name, reviewedAt: addDays(today, -30) } });
    }
  }
  for (const f of await prisma.fdr.findMany({ select: { id: true } })) await fdrsSvc.syncSummary(f.id);

  // ---- first Maturity Radar pass at "today", then age a few reminders to demonstrate escalation
  await radar.run(SYSTEM_ACTOR);
  const age = async (key: string, days: number) => {
    await prisma.reminder.updateMany({
      where: { fdrId: anchors[key], suppressed: false },
      data: { createdAt: addDays(today, -days), levelSince: addDays(today, -days) },
    });
    await prisma.escalationEvent.updateMany({ where: { fdrId: anchors[key], level: 0 }, data: { at: addDays(today, -days) } });
  };
  await age('esc2', 17);
  await radar.run(SYSTEM_ACTOR);

  await prisma.setting.upsert({ where: { key: 'demoAnchors' }, update: { value: JSON.stringify(anchors) }, create: { key: 'demoAnchors', value: JSON.stringify(anchors) } });

  // The two demo receipts on the Submit page also need a record in the simulated bank, otherwise "Check with bank"
  // would wrongly say the FDR does not exist. Matching sample: the bank agrees. Mismatching sample: the bank holds
  // the true amount (₹4,50,000), so the check reports MISMATCH on the amount typed.
  for (const [name, smp] of Object.entries(SAMPLES)) {
    const t = smp.typed;
    await prisma.simBankRecord.upsert({
      where: { fdrNumber: t.fdrNumber },
      update: {},
      create: {
        fdrNumber: t.fdrNumber, bankName: t.bank, branch: t.branch, ifsc: t.ifsc,
        amount: name === 'matching' ? Number(t.amount) : smp.doc.amount,
        issueDate: new Date(t.issueDate + 'T00:00:00Z'), maturityDate: new Date(t.maturityDate + 'T00:00:00Z'),
        depositorName: t.depositorName, inFavourOf: t.inFavourOf, outage: false,
      },
    });
  }

  const chain = await audit.verify();
  console.log(`\nSeeded ${await prisma.fdr.count()} FDRs, ${await prisma.discrepancy.count()} discrepancy flags, ${await prisma.auditLog.count()} audit entries. Chain: ${chain.intact ? 'intact' : 'BROKEN'}.`);
  console.log('Demo logins (password demo123): institution@, scrutiny@, approver@, admin@ demo.test');
  await app.close();

  // ------------------------------------------------------------ helpers
  async function walk(id: string, spec: Spec, owner: { id: string; email: string; name: string }, scr: typeof uScr, app_: typeof uApp) {
    const inst = act(owner, 'INSTITUTION');
    const maker = act(scr, 'SCRUTINY');
    const checker = act(app_, 'APPROVER');
    const path: Record<string, [FdrStatus, Actor][]> = {
      DRAFT: [],
      SUBMITTED: [['SUBMITTED', inst]],
      UNDER_SCRUTINY: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker]],
      DISCREPANCY_RAISED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['DISCREPANCY_RAISED', maker]],
      REJECTED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['REJECTED', maker]],
      ACCEPTED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker]],
      EXPIRING_SOON: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['EXPIRING_SOON', SYSTEM_ACTOR]],
      MATURED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['MATURED', SYSTEM_ACTOR]],
      RENEWAL_PENDING: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['RENEWAL_PENDING', inst]],
      RENEWED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['MATURED', SYSTEM_ACTOR], ['RENEWAL_PENDING', inst], ['RENEWED', maker]],
      RELEASE_REQUESTED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['MATURED', SYSTEM_ACTOR], ['RELEASE_REQUESTED', inst]],
      RELEASE_RECOMMENDED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['MATURED', SYSTEM_ACTOR], ['RELEASE_REQUESTED', inst], ['RELEASE_RECOMMENDED', maker]],
      RELEASED: [['SUBMITTED', inst], ['UNDER_SCRUTINY', maker], ['ACCEPTED', maker], ['MATURED', SYSTEM_ACTOR], ['RELEASE_REQUESTED', inst], ['RELEASE_RECOMMENDED', maker], ['RELEASED', checker]],
    };
    for (const [to, who] of path[spec.status]) await lifecycle.transition(id, to as any, who, 'Seeded history');
    // spread the transitions over the past so timelines look natural
    const trs = await prisma.fdrTransition.findMany({ where: { fdrId: id }, orderBy: { at: 'asc' } });
    const f = await prisma.fdr.findUniqueOrThrow({ where: { id } });
    const start = f.createdAt;
    for (let i = 0; i < trs.length; i++) {
      await prisma.fdrTransition.update({ where: { id: trs[i].id }, data: { at: addDays(start, Math.min(i * 2 + 1, 40)), clockDate: null } });
    }
  }

  async function recordBankCheck(id: string, spec: Spec, officer: typeof uScr) {
    const f = await prisma.fdr.findUniqueOrThrow({ where: { id } });
    const rec = await prisma.simBankRecord.findUnique({ where: { fdrNumber: f.fdrNumber! } });
    if (!rec) {
      await audit.log({ actor: act(officer, 'SCRUTINY'), action: 'BANK_CHECK_SIMULATED', entityType: 'Fdr', entityId: id, detail: { fdrId: id, result: 'NOT_FOUND', seeded: true } });
      return;
    }
    const vals: Record<FieldKey, string> = {
      fdrNumber: rec.fdrNumber, bank: rec.bankName, branch: rec.branch, ifsc: rec.ifsc, amount: String(rec.amount),
      issueDate: isoDate(rec.issueDate)!, maturityDate: isoDate(rec.maturityDate)!, depositorName: rec.depositorName, inFavourOf: rec.inFavourOf,
    };
    for (const key of FIELD_KEYS) {
      await prisma.fdrField.update({ where: { fdrId_key: { fdrId: id, key } }, data: { bankValue: vals[key], bankAt: addDays(today, -30), bankSource: 'SimulatedBankAdapter (seed data, no real bank)' } });
    }
    await audit.log({ actor: act(officer, 'SCRUTINY'), action: 'BANK_CHECK_SIMULATED', entityType: 'Fdr', entityId: id, detail: { fdrId: id, result: spec.sim === 'mismatch' ? 'MISMATCH' : 'MATCH', seeded: true, note: 'Simulation only. No real bank was contacted.' } });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
