import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../infra/prisma.service';
import { AuditService, Actor } from '../infra/audit.service';
import { ClockService } from '../infra/clock.service';
import { StorageService } from '../infra/storage.service';
import { OcrService } from '../infra/ocr.service';
import { LifecycleService } from '../infra/lifecycle.service';
import { BankService } from '../infra/bank.service';
import { RadarService } from '../radar/radar.service';
import { AuthUser, hasRole, isInstitution, toActor } from '../auth/auth.types';
import { FIELD_KEYS, FieldKey, FIELD_LABELS, normalizeValue, isFieldKey, REQUIRED_AUTHORITY_NAME, formatDisplay, sameValue } from '../domain/fields';
import { evaluateDiscrepancies, RaisedDiscrepancy } from '../domain/discrepancy-rules';
import { buildTruthTable, workingValue } from '../domain/truth-table';
import { daysBetween, isoDate } from '../domain/dates';
import { FdrStatusName, allowedNext } from '../domain/state-machine';
import { CreateFdrDto, FieldReviewDto, ListQuery, PreflightDto } from './dto';
import { buildWhere, scopeWhere } from './filters';

export const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];
const UPLOAD_STATUSES: FdrStatusName[] = ['DRAFT', 'SUBMITTED', 'DISCREPANCY_RAISED'];
const REVIEW_STATUSES: FdrStatusName[] = ['UNDER_SCRUTINY', 'DISCREPANCY_RAISED'];
const DISCREPANCY_EDIT_STATUSES: FdrStatusName[] = ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED'];

/** Decide the real file type from its first bytes, never from the name the client sent. */
export function sniffMime(b: Buffer): string | null {
  if (b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

@Injectable()
export class FdrsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private clock: ClockService,
    private storage: StorageService,
    private ocr: OcrService,
    private lifecycle: LifecycleService,
    private bank: BankService,
    private radar: RadarService,
  ) {}

  // ---------------------------------------------------------------- access

  async getAccessible(user: AuthUser, id: string) {
    const fdr = await this.prisma.fdr.findFirst({ where: { id, ...scopeWhere(user) } });
    if (!fdr) throw new NotFoundException('FDR not found');
    return fdr;
  }

  private requireStaff(user: AuthUser, ...roles: Parameters<typeof hasRole>[1][]) {
    if (!hasRole(user, ...roles)) throw new ForbiddenException(`This action needs one of these roles: ${roles.join(', ')}.`);
  }

  // ---------------------------------------------------------------- list / export

  /** What can honestly be said about verification: a bank answer (simulation unless a bank API is set), an open problem, or nothing yet. */
  private verificationOf(status: string, openDiscrepancies: number, bankChecked: boolean): 'NOT_SUBMITTED' | 'PENDING' | 'BANK_CONFIRMED' | 'DISCREPANCY' {
    if (status === 'DRAFT') return 'NOT_SUBMITTED';
    if (openDiscrepancies > 0 || status === 'REJECTED' || status === 'DISCREPANCY_RAISED') return 'DISCREPANCY';
    return bankChecked ? 'BANK_CONFIRMED' : 'PENDING';
  }

  /** One page of FDRs, filtered and sorted in the database. `all` (CSV export) is capped at 20,000 rows. */
  async list(user: AuthUser, q: ListQuery, opts: { all?: boolean } = {}) {
    const today = await this.clock.today();
    const where = buildWhere(user, q, today);
    const pageSize = opts.all ? 20000 : Math.min(100, Math.max(1, q.pageSize ?? 15));
    const page = opts.all ? 1 : Math.max(1, q.page ?? 1);
    const [total, sum, rows] = await Promise.all([
      this.prisma.fdr.count({ where }),
      this.prisma.fdr.aggregate({ where, _sum: { amount: true } }),
      this.prisma.fdr.findMany({
        where,
        include: {
          institution: true,
          discrepancies: { where: { status: 'OPEN' }, select: { type: true } },
          fields: { where: { key: 'fdrNumber' }, select: { bankValue: true } },
        },
        orderBy: [{ maturityDate: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const items = rows.map((f) => ({
      id: f.id,
      fdrNumber: f.fdrNumber,
      institutionId: f.institutionId,
      institutionName: f.institution.name,
      state: f.institution.state,
      bank: f.bankName,
      ifsc: f.ifsc,
      amount: f.amount,
      issueDate: isoDate(f.issueDate),
      maturityDate: isoDate(f.maturityDate),
      status: f.status,
      verification: this.verificationOf(f.status, f.discrepancies.length, f.fields.some((x) => x.bankValue !== null)),
      daysToMaturity: f.maturityDate ? daysBetween(today, f.maturityDate) : null,
      openDiscrepancies: f.discrepancies.length,
      discrepancyTypes: [...new Set(f.discrepancies.map((d) => d.type))],
    }));
    return { items, total, page, pageSize, totalAmount: sum._sum.amount ?? 0 };
  }

  async exportCsv(user: AuthUser, q: ListQuery): Promise<string> {
    const { items: rows } = await this.list(user, q, { all: true });
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['FDR number', 'Institution', 'State', 'Bank', 'IFSC', 'Amount (INR)', 'Issue date', 'Maturity date', 'Days to maturity', 'Status', 'Verification', 'Open discrepancies', 'Discrepancy types'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([r.fdrNumber, r.institutionName, r.state, r.bank, r.ifsc, r.amount, r.issueDate, r.maturityDate, r.daysToMaturity, r.status, r.verification, r.openDiscrepancies, r.discrepancyTypes.join('; ')].map(esc).join(','));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- create / submit

  private normaliseDto(dto: CreateFdrDto): Record<FieldKey, string> {
    const amount = normalizeValue('amount', dto.amount);
    if (!amount || Number(amount) <= 0) throw new BadRequestException('The deposit amount must be a positive number of rupees.');
    const out: Record<FieldKey, string> = {
      fdrNumber: normalizeValue('fdrNumber', dto.fdrNumber)!,
      bank: normalizeValue('bank', dto.bank)!,
      branch: normalizeValue('branch', dto.branch)!,
      ifsc: normalizeValue('ifsc', dto.ifsc)!,
      amount,
      issueDate: normalizeValue('issueDate', dto.issueDate)!,
      maturityDate: normalizeValue('maturityDate', dto.maturityDate)!,
      depositorName: normalizeValue('depositorName', dto.depositorName)!,
      inFavourOf: normalizeValue('inFavourOf', dto.inFavourOf)!,
    };
    for (const k of FIELD_KEYS) if (!out[k]) throw new BadRequestException(`${FIELD_LABELS[k]} is missing or not readable.`);
    return out;
  }

  async create(user: AuthUser, dto: CreateFdrDto, file?: Express.Multer.File) {
    if (!hasRole(user, 'INSTITUTION') || !user.institutionId) throw new ForbiddenException('Only institution users can submit FDRs.');
    const v = this.normaliseDto(dto);
    if (dto.renewsFdrId) {
      const old = await this.getAccessible(user, dto.renewsFdrId);
      if (old.status !== 'RENEWAL_PENDING') throw new BadRequestException('Request renewal on the old FDR first; only an FDR in RENEWAL_PENDING can be linked to a renewed one.');
    }
    const actor = toActor(user);
    const now = new Date();
    const fdr = await this.prisma.$transaction(async (tx) => {
      const f = await tx.fdr.create({
        data: { institutionId: user.institutionId!, createdById: user.id, createdByName: user.name, status: 'DRAFT', previousFdrId: dto.renewsFdrId ?? null },
      });
      await tx.fdrField.createMany({
        data: FIELD_KEYS.map((key) => ({ fdrId: f.id, key, submittedValue: v[key], submittedById: user.id, submittedByName: user.name, submittedAt: now })),
      });
      await this.audit.log({ actor, action: 'FDR_CREATED', entityType: 'Fdr', entityId: f.id, detail: { fdrNumber: v.fdrNumber, values: v, renewsFdrId: dto.renewsFdrId ?? null } }, tx);
      return f;
    });
    await this.syncSummary(fdr.id);
    if (file) await this.attachDocument(user, fdr.id, file, { reevaluate: false });
    if (!dto.asDraft) await this.submit(user, fdr.id);
    return { id: fdr.id };
  }

  async submit(user: AuthUser, id: string) {
    const fdr = await this.getAccessible(user, id);
    if (!hasRole(user, 'INSTITUTION')) throw new ForbiddenException('Only the institution can submit.');
    await this.lifecycle.transition(fdr.id, 'SUBMITTED', toActor(user), 'Submitted by institution');
    await this.reevaluate(id, toActor(user));
    return { id };
  }

  // ---------------------------------------------------------------- documents + OCR

  async attachDocument(user: AuthUser, fdrId: string, file: Express.Multer.File, opts: { reevaluate?: boolean } = {}) {
    const fdr = await this.getAccessible(user, fdrId);
    if (!hasRole(user, 'INSTITUTION')) throw new ForbiddenException('Only the institution uploads FDR documents.');
    if (!UPLOAD_STATUSES.includes(fdr.status as FdrStatusName)) {
      throw new BadRequestException(`Documents cannot be added while the FDR is ${fdr.status}.`);
    }
    const buf = file.buffer;
    if (!buf || !buf.length) throw new BadRequestException('The uploaded file is empty.');
    if (buf.length > 10 * 1024 * 1024) throw new BadRequestException('The file is larger than 10 MB.');
    const mime = sniffMime(buf);
    if (!mime || !ALLOWED_MIME.includes(mime)) throw new BadRequestException('Only PDF, JPG or PNG files are accepted (the file content does not look like one of these).');

    const actor = toActor(user);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const storageKey = `fdr/${fdrId}/${randomUUID()}`;
    await this.storage.put(storageKey, buf);
    const doc = await this.prisma.document.create({
      data: { fdrId, fileName: (file.originalname || 'upload').slice(0, 200), mimeType: mime, sizeBytes: buf.length, sha256, storageKey, uploadedById: user.id, uploadedByName: user.name },
    });
    await this.audit.log({ actor, action: 'DOCUMENT_UPLOADED', entityType: 'Document', entityId: doc.id, detail: { fdrId, fileName: doc.fileName, sha256, sizeBytes: buf.length, mimeType: mime } });

    const ocr = await this.ocr.extract(buf, mime);
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { ocrStatus: ocr.status, ocrNote: ocr.note, ocrText: ocr.text.slice(0, 20000), ocrMeanConfidence: ocr.meanConfidence },
    });
    // A new document replaces the old reading, so earlier officer reviews no longer apply.
    const now = new Date();
    for (const key of FIELD_KEYS) {
      const p = ocr.fields[key];
      await this.prisma.fdrField.update({
        where: { fdrId_key: { fdrId, key } },
        data: {
          extractedValue: p?.value ?? null,
          extractedConfidence: p?.confidence ?? null,
          extractedAt: p ? now : null,
          extractedDocId: p ? doc.id : null,
          extractedBy: p ? 'tesseract.js + regex parser' : null,
          reviewAction: null,
          reviewedValue: null,
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          reviewNote: null,
        },
      });
    }
    await this.audit.log({
      actor,
      action: 'OCR_RUN',
      entityType: 'Document',
      entityId: doc.id,
      detail: { fdrId, status: ocr.status, note: ocr.note, fieldsFound: Object.keys(ocr.fields), meanConfidence: ocr.meanConfidence },
    });
    await this.syncSummary(fdrId);
    if (opts.reevaluate !== false && fdr.status !== 'DRAFT') await this.reevaluate(fdrId, actor);
    return { documentId: doc.id, sha256, ocrStatus: ocr.status, ocrNote: ocr.note, fieldsFound: Object.keys(ocr.fields) };
  }

  /**
   * Pre-flight check: read the scan and compare it with what has been typed, before anything is submitted.
   * Nothing is stored except one audit line. It only SUGGESTS: the officer still confirms every value.
   */
  async preflight(user: AuthUser, dto: PreflightDto, file?: Express.Multer.File) {
    if (!hasRole(user, 'INSTITUTION')) throw new ForbiddenException('Only institution users can run a pre-flight check.');
    if (!file || !file.buffer || !file.buffer.length) throw new BadRequestException('Attach the scan or photo of the receipt first.');
    const buf = file.buffer;
    if (buf.length > 10 * 1024 * 1024) throw new BadRequestException('The file is larger than 10 MB.');
    const mime = sniffMime(buf);
    if (!mime || !ALLOWED_MIME.includes(mime)) throw new BadRequestException('Only PDF, JPG or PNG files are accepted (the file content does not look like one of these).');

    const ocr = await this.ocr.extract(buf, mime);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const typedRaw = dto as unknown as Record<string, string | undefined>;
    const typed: Partial<Record<FieldKey, string | null>> = {};
    const extracted: Partial<Record<FieldKey, string | null>> = {};
    let anyExtracted = false;
    const fields = FIELD_KEYS.map((key) => {
      const t = normalizeValue(key, typedRaw[key]);
      const e = ocr.fields[key];
      typed[key] = t;
      if (e?.value) { extracted[key] = e.value; anyExtracted = true; }
      const state = !e?.value ? 'NOT_READ' : t === null ? 'NOT_TYPED' : sameValue(key, t, e.value) ? 'MATCH' : 'DIFFERENT';
      return {
        key, label: FIELD_LABELS[key], state,
        typed: t, typedDisplay: t === null ? null : formatDisplay(key, t),
        extracted: e?.value ?? null, extractedDisplay: e?.value ? formatDisplay(key, e.value) : null, confidence: e?.confidence ?? null,
      };
    });

    // duplicates, without naming anyone else's institution
    const sameFile = await this.prisma.document.count({ where: { sha256 } });
    const num = normalizeValue('fdrNumber', typed.fdrNumber);
    const sameNumber = num ? await this.prisma.fdr.count({ where: { fdrNumber: num, institutionId: { not: user.institutionId ?? '' } } }) : 0;
    const warnings = evaluateDiscrepancies({
      submitted: typed,
      extracted: anyExtracted ? extracted : null,
      hasDocument: true,
      duplicateDocumentOf: sameFile ? ['an earlier submission'] : [],
      duplicateFdrNumberAt: sameNumber ? ['another institution'] : [],
    }).map((w) => ({ type: w.type, fieldKey: w.fieldKey ?? null, reason: w.reason }));

    const differences = fields.filter((f) => f.state === 'DIFFERENT').length;
    await this.audit.log({
      actor: toActor(user),
      action: 'PREFLIGHT_RUN',
      entityType: 'Preflight',
      detail: { sha256, ocrStatus: ocr.status, differences, warnings: warnings.length, note: 'Nothing was saved. This only compared the scan with the typed values.' },
    });
    return {
      ocrStatus: ocr.status,
      note: ocr.note,
      meanConfidence: ocr.meanConfidence,
      fields,
      warnings,
      summary: { differences, warnings: warnings.length, notRead: fields.filter((f) => f.state === 'NOT_READ').length },
      disclaimer: 'This only compares the scan with what you typed. OCR can misread, and an officer still confirms every value. Nothing has been submitted.',
    };
  }

  async downloadDocument(user: AuthUser, docId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.getAccessible(user, doc.fdrId);
    const data = await this.storage.get(doc.storageKey);
    await this.audit.log({ actor: toActor(user), action: 'DOCUMENT_DOWNLOADED', entityType: 'Document', entityId: doc.id, detail: { fdrId: doc.fdrId, fileName: doc.fileName } });
    return { doc, data };
  }

  // ---------------------------------------------------------------- summary + rules

  /** Keep the denormalised summary in step with the field table (officer-reviewed value wins over typed). */
  async syncSummary(fdrId: string) {
    const rows = await this.prisma.fdrField.findMany({ where: { fdrId } });
    const val = (k: FieldKey) => workingValue(rows.find((r) => r.key === k), k);
    const amount = val('amount');
    const issue = val('issueDate');
    const mat = val('maturityDate');
    await this.prisma.fdr.update({
      where: { id: fdrId },
      data: {
        fdrNumber: val('fdrNumber'),
        bankName: val('bank'),
        ifsc: val('ifsc'),
        amount: amount ? Number(amount) : null,
        issueDate: issue ? new Date(issue + 'T00:00:00Z') : null,
        maturityDate: mat ? new Date(mat + 'T00:00:00Z') : null,
      },
    });
  }

  /** Run the discrepancy rules and raise any flag that is not already on record. */
  async reevaluate(fdrId: string, actor: Actor, opts: { changeStatus?: boolean } = {}) {
    const fdr = await this.prisma.fdr.findUniqueOrThrow({
      where: { id: fdrId },
      include: { fields: true, documents: { orderBy: { uploadedAt: 'desc' } }, discrepancies: true, institution: true },
    });
    const submitted: Partial<Record<FieldKey, string | null>> = {};
    const extracted: Partial<Record<FieldKey, string | null>> = {};
    let anyExtracted = false;
    for (const r of fdr.fields) {
      if (!isFieldKey(r.key)) continue;
      submitted[r.key] = r.submittedValue;
      if (r.extractedValue) {
        extracted[r.key] = r.reviewedValue ?? r.extractedValue;
        anyExtracted = true;
      }
    }
    const latest = fdr.documents[0];
    let duplicateDocumentOf: string[] = [];
    if (latest) {
      const same = await this.prisma.document.findMany({ where: { sha256: latest.sha256, fdrId: { not: fdrId } }, include: { fdr: { include: { institution: true } } } });
      duplicateDocumentOf = [...new Set(same.map((d) => `${d.fdr.fdrNumber ?? d.fdr.id} (${d.fdr.institution.name})`))];
    }
    let duplicateFdrNumberAt: string[] = [];
    const num = normalizeValue('fdrNumber', submitted.fdrNumber);
    if (num) {
      const others = await this.prisma.fdr.findMany({ where: { fdrNumber: num, institutionId: { not: fdr.institutionId } }, include: { institution: true } });
      duplicateFdrNumberAt = [...new Set(others.map((o) => o.institution.name))];
    }
    const raised = evaluateDiscrepancies({
      submitted,
      extracted: anyExtracted ? extracted : null,
      hasDocument: fdr.documents.length > 0,
      duplicateDocumentOf,
      duplicateFdrNumberAt,
    });
    const have = new Set(fdr.discrepancies.map((d) => `${d.type}:${d.fieldKey ?? ''}`));
    const fresh = raised.filter((d) => !have.has(`${d.type}:${d.fieldKey ?? ''}`));
    for (const d of fresh) await this.createDiscrepancy(fdrId, d, 'Automatic check', actor);

    // A document now exists, so an open "missing document" flag has answered itself.
    if (fdr.documents.length > 0) {
      const missing = fdr.discrepancies.filter((d) => d.type === 'MISSING_DOCUMENT' && d.status === 'OPEN');
      for (const m of missing) {
        await this.prisma.discrepancy.update({ where: { id: m.id }, data: { status: 'RESOLVED', resolutionNote: 'A document was uploaded.', resolvedByName: 'Automatic check', resolvedAt: new Date() } });
        await this.audit.log({ actor, action: 'DISCREPANCY_RESOLVED', entityType: 'Discrepancy', entityId: m.id, detail: { fdrId, type: m.type, note: 'A document was uploaded.', automatic: true } });
      }
    }
    if (opts.changeStatus !== false) {
      if (fresh.length) await this.lifecycle.tryTransition(fdrId, 'DISCREPANCY_RAISED', actor, `${fresh.length} discrepancy flag(s) raised`);
      await this.settleStatus(fdrId, actor);
    }
    return fresh.length;
  }

  private async createDiscrepancy(fdrId: string, d: RaisedDiscrepancy, raisedBy: string, actor: Actor) {
    const rec = await this.prisma.discrepancy.create({
      data: { fdrId, type: d.type, fieldKey: d.fieldKey ?? null, reason: d.reason, raisedByLabel: raisedBy },
    });
    await this.audit.log({ actor, action: 'DISCREPANCY_RAISED', entityType: 'Discrepancy', entityId: rec.id, detail: { fdrId, type: d.type, fieldKey: d.fieldKey ?? null, reason: d.reason, raisedBy } });
    return rec;
  }

  /** When the last open discrepancy closes, the FDR goes back to normal scrutiny. */
  async settleStatus(fdrId: string, actor: Actor) {
    const f = await this.prisma.fdr.findUnique({ where: { id: fdrId }, select: { status: true } });
    if (f?.status !== 'DISCREPANCY_RAISED') return;
    const open = await this.prisma.discrepancy.count({ where: { fdrId, status: 'OPEN' } });
    if (open === 0) await this.lifecycle.tryTransition(fdrId, 'UNDER_SCRUTINY', actor, 'All discrepancies resolved or waived');
  }

  // ---------------------------------------------------------------- scrutiny

  async startScrutiny(user: AuthUser, id: string) {
    this.requireStaff(user, 'SCRUTINY');
    const actor = toActor(user);
    await this.lifecycle.transition(id, 'UNDER_SCRUTINY', actor, 'Scrutiny started');
    const open = await this.prisma.discrepancy.count({ where: { fdrId: id, status: 'OPEN' } });
    if (open > 0) await this.lifecycle.transition(id, 'DISCREPANCY_RAISED', actor, `${open} open discrepancy flag(s) from the automatic checks`);
    return { id };
  }

  async reviewField(user: AuthUser, id: string, keyRaw: string, dto: FieldReviewDto) {
    this.requireStaff(user, 'SCRUTINY');
    if (!isFieldKey(keyRaw)) throw new BadRequestException('Unknown field.');
    const key: FieldKey = keyRaw;
    const fdr = await this.prisma.fdr.findUniqueOrThrow({ where: { id } });
    if (!REVIEW_STATUSES.includes(fdr.status as FdrStatusName)) throw new BadRequestException('Start scrutiny before reviewing fields.');
    const row = await this.prisma.fdrField.findUniqueOrThrow({ where: { fdrId_key: { fdrId: id, key } } });
    const before = workingValue(row, key);
    let value: string | null;
    let action: 'CONFIRMED' | 'CORRECTED';
    if (dto.action === 'CONFIRM') {
      if (!row.extractedValue) throw new BadRequestException('There is no extracted value to confirm. Use Correct to enter the value from the document.');
      value = row.extractedValue;
      action = 'CONFIRMED';
    } else {
      value = normalizeValue(key, dto.value ?? '');
      if (!value) throw new BadRequestException(`Enter a valid ${FIELD_LABELS[key].toLowerCase()}.`);
      action = 'CORRECTED';
    }
    await this.prisma.fdrField.update({
      where: { id: row.id },
      data: { reviewAction: action, reviewedValue: value, reviewedById: user.id, reviewedByName: user.name, reviewedAt: new Date(), reviewNote: dto.note ?? null },
    });
    await this.audit.log({
      actor: toActor(user),
      action: 'FIELD_REVIEWED',
      entityType: 'Fdr',
      entityId: id,
      detail: { fdrId: id, field: key, review: action, old: before, new: value, note: dto.note ?? null, note2: 'Manual review does not make a field bank-confirmed' },
    });
    await this.syncSummary(id);
    return { key, action, value };
  }

  async bankCheck(user: AuthUser, id: string) {
    this.requireStaff(user, 'SCRUTINY');
    const actor = toActor(user);
    const fdr = await this.prisma.fdr.findUniqueOrThrow({ where: { id }, include: { fields: true } });
    if (fdr.status === 'DRAFT') throw new BadRequestException('Submit the FDR before checking with the bank.');
    const val = (k: FieldKey) => workingValue(fdr.fields.find((f) => f.key === k), k);
    const num = val('fdrNumber');
    const res = await this.bank.adapter.verify(num ?? '', val('ifsc') ?? '', Number(val('amount') ?? 0), val('maturityDate') ?? '');
    await this.audit.log({
      actor,
      action: this.bank.mode === 'simulation' ? 'BANK_CHECK_SIMULATED' : 'BANK_CHECK_EXTERNAL',
      entityType: 'Fdr',
      entityId: id,
      detail: { fdrId: id, result: res.status, differingFields: res.differingFields, source: this.bank.sourceLabel, note: this.bank.mode === 'simulation' ? 'Simulation only. No real bank was contacted.' : `Answer from ${this.bank.sourceLabel}.` },
    });
    if (res.status === 'SERVICE_UNAVAILABLE') {
      return { status: res.status, message: `${cap(this.bank.name)} is unavailable right now. Nothing was changed; try again later.` };
    }
    if (res.status === 'NOT_FOUND') {
      const exists = await this.prisma.discrepancy.findFirst({ where: { fdrId: id, type: 'BANK_NOT_FOUND' } });
      if (!exists) {
        await this.createDiscrepancy(id, { type: 'BANK_NOT_FOUND', fieldKey: 'fdrNumber', reason: `${cap(this.bank.name)} has no record of FDR number ${num}. The FDR may not exist or the number may be wrong.` }, `${user.name} (bank check)`, actor);
        await this.lifecycle.tryTransition(id, 'DISCREPANCY_RAISED', actor, `${this.bank.mode === 'simulation' ? 'Bank simulation' : 'Bank check'}: FDR not found`);
      }
      return { status: res.status, message: `${cap(this.bank.name)} has no record of FDR number ${num}.` };
    }
    const rec = res.record!;
    const bankValues: Record<FieldKey, string> = {
      fdrNumber: rec.fdrNumber,
      bank: rec.bankName,
      branch: rec.branch,
      ifsc: rec.ifsc,
      amount: String(rec.amount),
      issueDate: rec.issueDate,
      maturityDate: rec.maturityDate,
      depositorName: rec.depositorName,
      inFavourOf: rec.inFavourOf,
    };
    const now = new Date();
    for (const key of FIELD_KEYS) {
      await this.prisma.fdrField.update({ where: { fdrId_key: { fdrId: id, key } }, data: { bankValue: bankValues[key], bankAt: now, bankSource: this.bank.sourceLabel } });
    }
    if (res.status === 'MISMATCH') {
      const names = res.differingFields.map((k) => FIELD_LABELS[k].toLowerCase()).join(', ');
      const exists = await this.prisma.discrepancy.findFirst({ where: { fdrId: id, type: 'BANK_MISMATCH' } });
      if (!exists) {
        await this.createDiscrepancy(id, { type: 'BANK_MISMATCH', reason: `${cap(this.bank.name)} record differs from the values held for: ${names}. Compare the bank column in the truth table.` }, `${user.name} (bank check)`, actor);
        await this.lifecycle.tryTransition(id, 'DISCREPANCY_RAISED', actor, `${this.bank.mode === 'simulation' ? 'Bank simulation' : 'Bank check'}: values differ`);
      }
    }
    await this.audit.log({ actor, action: 'BANK_VALUES_RECORDED', entityType: 'Fdr', entityId: id, detail: { fdrId: id, values: bankValues, label: this.bank.label } });
    return { status: res.status, differingFields: res.differingFields, message: res.status === 'MATCH' ? `${cap(this.bank.name)} record matches the held values.` : `${cap(this.bank.name)} record differs. See the truth table.` };
  }

  async accept(user: AuthUser, id: string) {
    this.requireStaff(user, 'SCRUTINY');
    const actor = toActor(user);
    const fdr = await this.prisma.fdr.findUniqueOrThrow({ where: { id }, include: { fields: true } });
    if (fdr.status !== 'UNDER_SCRUTINY') throw new BadRequestException(`An FDR can be accepted only while it is UNDER_SCRUTINY (it is ${fdr.status}).`);
    const open = await this.prisma.discrepancy.count({ where: { fdrId: id, status: 'OPEN' } });
    if (open) throw new BadRequestException(`${open} discrepancy flag(s) are still Open. Resolve or waive each one (with a reason) before accepting.`);
    const unreviewed = fdr.fields.filter((f) => f.extractedValue && !f.reviewAction).map((f) => FIELD_LABELS[f.key as FieldKey]);
    if (unreviewed.length) throw new BadRequestException(`OCR only suggests values. Confirm or correct each extracted value first: ${unreviewed.join(', ')}.`);
    await this.lifecycle.transition(id, 'ACCEPTED', actor, 'Accepted after scrutiny (not bank-confirmed unless the truth table says so)');
    if (fdr.previousFdrId) {
      await this.lifecycle.tryTransition(fdr.previousFdrId, 'RENEWED', actor, `Replaced by renewed FDR ${fdr.fdrNumber}`);
      await this.audit.log({ actor, action: 'RENEWAL_LINKED', entityType: 'Fdr', entityId: id, detail: { fdrId: id, previousFdrId: fdr.previousFdrId } });
    }
    await this.radar.syncOne(id);
    return { id };
  }

  async reject(user: AuthUser, id: string, reason: string) {
    this.requireStaff(user, 'SCRUTINY');
    await this.lifecycle.transition(id, 'REJECTED', toActor(user), reason);
    await this.prisma.fdr.update({ where: { id }, data: { rejectionReason: reason } });
    return { id };
  }

  // ---------------------------------------------------------------- discrepancies

  async raiseManual(user: AuthUser, id: string, reason: string, fieldKey?: FieldKey) {
    this.requireStaff(user, 'SCRUTINY');
    const fdr = await this.prisma.fdr.findUniqueOrThrow({ where: { id } });
    if (!DISCREPANCY_EDIT_STATUSES.includes(fdr.status as FdrStatusName)) throw new BadRequestException(`Discrepancies cannot be raised while the FDR is ${fdr.status}.`);
    const actor = toActor(user);
    const d = await this.createDiscrepancy(id, { type: 'MANUAL', fieldKey, reason }, user.name, actor);
    await this.lifecycle.tryTransition(id, 'DISCREPANCY_RAISED', actor, 'Discrepancy raised by officer');
    return d;
  }

  async closeDiscrepancy(user: AuthUser, discId: string, status: 'RESOLVED' | 'WAIVED', note: string) {
    this.requireStaff(user, 'SCRUTINY');
    const d = await this.prisma.discrepancy.findUnique({ where: { id: discId } });
    if (!d) throw new NotFoundException('Discrepancy not found');
    if (d.status !== 'OPEN') throw new BadRequestException(`This discrepancy is already ${d.status}.`);
    const actor = toActor(user);
    await this.prisma.discrepancy.update({
      where: { id: discId },
      data: { status, resolutionNote: note, resolvedById: user.id, resolvedByName: user.name, resolvedAt: new Date() },
    });
    await this.audit.log({
      actor,
      action: status === 'RESOLVED' ? 'DISCREPANCY_RESOLVED' : 'DISCREPANCY_WAIVED',
      entityType: 'Discrepancy',
      entityId: discId,
      detail: { fdrId: d.fdrId, type: d.type, reason: d.reason, note },
    });
    await this.settleStatus(d.fdrId, actor);
    return { id: discId, status };
  }

  // ---------------------------------------------------------------- renewal

  async requestRenewal(user: AuthUser, id: string) {
    const fdr = await this.getAccessible(user, id);
    if (!hasRole(user, 'INSTITUTION')) throw new ForbiddenException('Only the institution requests renewal.');
    const actor = toActor(user);
    await this.lifecycle.transition(fdr.id, 'RENEWAL_PENDING', actor, 'Renewal requested by institution');
    await this.radar.acknowledgeAllForFdr(fdr.id, actor);
    return { id };
  }

  // ---------------------------------------------------------------- detail

  actionsFor(user: AuthUser, fdr: { status: string; institutionId: string }, hasDoc: boolean): string[] {
    const s = fdr.status as FdrStatusName;
    const a: string[] = [];
    const owner = hasRole(user, 'INSTITUTION') && user.institutionId === fdr.institutionId;
    if (owner) {
      if (UPLOAD_STATUSES.includes(s)) a.push('UPLOAD_DOCUMENT');
      if (s === 'DRAFT') a.push('SUBMIT');
      if (['ACCEPTED', 'EXPIRING_SOON', 'MATURED'].includes(s)) a.push('REQUEST_RENEWAL', 'REQUEST_RELEASE');
      if (s === 'RENEWAL_PENDING') a.push('UPLOAD_RENEWAL');
      if (['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'].includes(s)) a.push('ACK_REMINDERS');
    }
    if (hasRole(user, 'SCRUTINY')) {
      if (s === 'SUBMITTED') a.push('START_SCRUTINY');
      if (REVIEW_STATUSES.includes(s)) a.push('REVIEW_FIELDS');
      if (s === 'UNDER_SCRUTINY') a.push('ACCEPT');
      if (['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED'].includes(s)) a.push('REJECT');
      if (s !== 'DRAFT' && !['REJECTED', 'RELEASED', 'RENEWED'].includes(s)) a.push('BANK_CHECK');
      if (DISCREPANCY_EDIT_STATUSES.includes(s)) a.push('MANAGE_DISCREPANCIES');
      if (['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'].includes(s)) a.push('ACK_REMINDERS');
    }
    if (hasRole(user, 'APPROVER') && ['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING'].includes(s)) a.push('ACK_REMINDERS');
    void hasDoc;
    return a;
  }

  async detail(user: AuthUser, id: string) {
    await this.getAccessible(user, id);
    const today = await this.clock.today();
    const fdr = await this.prisma.fdr.findUniqueOrThrow({
      where: { id },
      include: {
        institution: true,
        fields: true,
        documents: { orderBy: { uploadedAt: 'desc' } },
        discrepancies: { orderBy: { createdAt: 'asc' } },
        reminders: { orderBy: { thresholdDays: 'desc' }, include: { events: { orderBy: [{ at: 'asc' }, { level: 'asc' }] } } },
        transitions: { orderBy: { at: 'asc' } },
      },
    });
    const staffView = !isInstitution(user);
    const chain = await this.chainFor(fdr.id);

    const discrepancies = fdr.discrepancies.map((d) => ({
      id: d.id,
      type: d.type,
      fieldKey: d.fieldKey,
      fieldLabel: d.fieldKey && isFieldKey(d.fieldKey) ? FIELD_LABELS[d.fieldKey] : null,
      // Cross-institution details are for officers only.
      reason: !staffView && (d.type === 'DUPLICATE_DOCUMENT' || d.type === 'DUPLICATE_FDR_NUMBER')
        ? d.type === 'DUPLICATE_DOCUMENT'
          ? 'This exact file is already attached to another deposit on record. A scrutiny officer will contact you.'
          : 'This FDR number is already on record for another deposit. A scrutiny officer will contact you.'
        : d.reason,
      status: d.status,
      raisedBy: d.raisedByLabel,
      createdAt: d.createdAt,
      resolutionNote: d.resolutionNote,
      resolvedBy: d.resolvedByName,
      resolvedAt: d.resolvedAt,
    }));

    return {
      fdr: {
        id: fdr.id,
        status: fdr.status,
        fdrNumber: fdr.fdrNumber,
        bank: fdr.bankName,
        ifsc: fdr.ifsc,
        amount: fdr.amount,
        issueDate: isoDate(fdr.issueDate),
        maturityDate: isoDate(fdr.maturityDate),
        daysToMaturity: fdr.maturityDate ? daysBetween(today, fdr.maturityDate) : null,
        institution: { id: fdr.institution.id, name: fdr.institution.name, city: fdr.institution.city, state: fdr.institution.state },
        createdByName: fdr.createdByName,
        createdAt: fdr.createdAt,
        rejectionReason: fdr.rejectionReason,
        previousFdrId: fdr.previousFdrId,
        nextStatuses: allowedNext(fdr.status as FdrStatusName),
      },
      requiredAuthority: REQUIRED_AUTHORITY_NAME,
      truthTable: buildTruthTable(fdr.fields),
      documents: fdr.documents.map((d, i) => ({
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        uploadedByName: d.uploadedByName,
        uploadedAt: d.uploadedAt,
        ocrStatus: d.ocrStatus,
        ocrNote: d.ocrNote,
        ocrMeanConfidence: d.ocrMeanConfidence,
        current: i === 0,
      })),
      discrepancies,
      reminders: fdr.reminders.map((r) => ({
        id: r.id,
        thresholdDays: r.thresholdDays,
        level: r.level,
        suppressed: r.suppressed,
        createdAt: r.createdAt,
        ackedAt: r.ackedAt,
        ackedByName: r.ackedByName,
        events: r.events.map((e) => ({ level: e.level, toRole: e.toRole, at: e.at, note: e.note })),
      })),
      chain: chain.items,
      timeline: chain.timeline,
      actions: this.actionsFor(user, fdr, fdr.documents.length > 0),
    };
  }

  /** The renewal chain (old -> new) and one merged timeline for every FDR in it. */
  private async chainFor(fdrId: string) {
    const ids: string[] = [fdrId];
    let cur = await this.prisma.fdr.findUnique({ where: { id: fdrId }, select: { previousFdrId: true } });
    while (cur?.previousFdrId) {
      ids.unshift(cur.previousFdrId);
      cur = await this.prisma.fdr.findUnique({ where: { id: cur.previousFdrId }, select: { previousFdrId: true } });
    }
    let last = fdrId;
    for (;;) {
      const next = await this.prisma.fdr.findFirst({ where: { previousFdrId: last }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!next) break;
      ids.push(next.id);
      last = next.id;
    }
    const fdrs = await this.prisma.fdr.findMany({ where: { id: { in: ids } }, include: { transitions: true } });
    const ordered = ids.map((i) => fdrs.find((f) => f.id === i)!).filter(Boolean);
    const items = ordered.map((f) => ({
      id: f.id,
      fdrNumber: f.fdrNumber,
      status: f.status,
      amount: f.amount,
      issueDate: isoDate(f.issueDate),
      maturityDate: isoDate(f.maturityDate),
      isCurrent: f.id === fdrId,
    }));
    const timeline = ordered
      .flatMap((f) => f.transitions.map((t) => ({ at: t.at, fdrId: f.id, fdrNumber: f.fdrNumber, from: t.fromStatus, to: t.toStatus, actor: t.actorLabel, note: t.note })))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return { items, timeline };
  }

  async auditFor(user: AuthUser, id: string) {
    await this.getAccessible(user, id);
    const rows = await this.prisma.auditLog.findMany({
      where: { OR: [{ entityType: 'Fdr', entityId: id }, { detail: { path: ['fdrId'], equals: id } }] },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    return rows.map((r) => ({ seq: r.seq, at: r.at, clockDate: r.clockDate, actor: r.actorEmail, role: r.actorRole, action: r.action, detail: r.detail }));
  }

}

