import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../infra/prisma.service';
import { AuditService, Actor } from '../infra/audit.service';
import { AuthUser, isInstitution } from '../auth/auth.types';
import { CHECKLIST_LABELS, ChecklistItem } from '../domain/maker-checker';
import { OrderSnapshot, checkOrder, hashSnapshot, maskFdrNumber, newOrderNo } from '../domain/release-order';
import { StoredAuditEntry } from '../domain/audit-chain';
import { isoDate } from '../domain/dates';
import { config } from '../config';

const inr = (n: number | null | undefined) => (n === null || n === undefined ? '-' : 'INR ' + new Intl.NumberFormat('en-IN').format(n));
const dmy = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-');

@Injectable()
export class OrdersService {
  private chainCache: { at: number; intact: boolean } | null = null;

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Issue the order for an approved release request (once). The hash is anchored in the audit trail. */
  async issue(releaseRequestId: string, actor: Actor): Promise<{ orderNo: string }> {
    const existing = await this.prisma.releaseOrder.findUnique({ where: { releaseRequestId } });
    if (existing) return { orderNo: existing.orderNo };
    const rr = await this.prisma.releaseRequest.findUnique({ where: { id: releaseRequestId }, include: { fdr: { include: { institution: true } } } });
    if (!rr) throw new NotFoundException('Release request not found.');
    if (rr.status !== 'APPROVED') throw new BadRequestException('An order is only issued for an approved release.');

    const now = new Date();
    const checklist = (rr.checklist as unknown as ChecklistItem[]).map((c) => ({ label: CHECKLIST_LABELS[c.key] ?? c.key, ticked: !!c.ticked, note: c.note ?? '' }));
    const base = {
      issuedAt: now.toISOString(),
      institution: { name: rr.fdr.institution.name, city: rr.fdr.institution.city, state: rr.fdr.institution.state },
      fdr: { fdrNumber: rr.fdr.fdrNumber, bank: rr.fdr.bankName, amount: rr.fdr.amount, issueDate: isoDate(rr.fdr.issueDate), maturityDate: isoDate(rr.fdr.maturityDate) },
      request: { reason: rr.reason, requestedBy: rr.requestedByName, requestedAt: rr.requestedAt.toISOString() },
      maker: { name: rr.makerName, note: rr.makerNote, at: rr.recommendedAt ? rr.recommendedAt.toISOString() : null },
      checker: { name: rr.checkerName, reason: rr.decisionReason, at: rr.decidedAt ? rr.decidedAt.toISOString() : null },
      checklist,
      decision: 'APPROVED' as const,
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = newOrderNo(now);
      const snapshot: OrderSnapshot = { orderNo, ...base };
      if (await this.prisma.releaseOrder.findUnique({ where: { orderNo } })) continue;
      const orderHash = hashSnapshot(snapshot);
      const anchor = await this.audit.log({
        actor,
        action: 'RELEASE_ORDER_ISSUED',
        entityType: 'ReleaseOrder',
        entityId: rr.id,
        detail: { orderNo, orderHash, fdrId: rr.fdrId, fdrNumber: rr.fdr.fdrNumber },
      });
      await this.prisma.releaseOrder.create({
        data: { orderNo, releaseRequestId: rr.id, fdrId: rr.fdrId, snapshot: snapshot as unknown as object, orderHash, auditSeq: anchor.seq, auditHash: anchor.hash },
      });
      return { orderNo };
    }
    throw new BadRequestException('Could not allocate an order number. Please try again.');
  }

  private async chainIntact(): Promise<boolean> {
    if (this.chainCache && Date.now() - this.chainCache.at < 30000) return this.chainCache.intact;
    const intact = (await this.audit.verify()).intact;
    this.chainCache = { at: Date.now(), intact };
    return intact;
  }

  /** Public check: only minimal, non-sensitive details are returned. */
  async verifyPublic(orderNo: string) {
    const order = await this.prisma.releaseOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('No order with this number exists in this system.');
    const toEntry = (r: { seq: number; at: Date; clockDate: string | null; actorId: string | null; actorEmail: string; actorRole: string; action: string; entityType: string; entityId: string | null; detail: unknown; prevHash: string; hash: string }): StoredAuditEntry => ({
      seq: r.seq, at: r.at.toISOString(), clockDate: r.clockDate, actorId: r.actorId, actorEmail: r.actorEmail, actorRole: r.actorRole, action: r.action,
      entityType: r.entityType, entityId: r.entityId, detail: r.detail, prevHash: r.prevHash, hash: r.hash,
    });
    const row = await this.prisma.auditLog.findUnique({ where: { seq: order.auditSeq } });
    const prev = row ? await this.prisma.auditLog.findFirst({ where: { seq: { lt: row.seq } }, orderBy: { seq: 'desc' }, select: { hash: true } }) : null;
    const check = checkOrder(order, row ? toEntry(row) : null, prev);
    const snap = order.snapshot as unknown as OrderSnapshot;
    return {
      orderNo: order.orderNo,
      verdict: check.verdict,
      reasons: check.reasons,
      issuedAt: order.createdAt.toISOString(),
      institution: snap.institution?.name ?? null,
      fdrNumberMasked: maskFdrNumber(snap.fdr?.fdrNumber),
      decision: snap.decision,
      approvedOn: snap.checker?.at ? snap.checker.at.slice(0, 10) : null,
      auditEntry: order.auditSeq,
      chainIntact: await this.chainIntact(),
      notice: 'Checks this order against this prototype\'s own tamper-evident audit trail. It is not an official AICTE document and does not show that any bank paid out money.',
    };
  }

  /** Staff, or the institution that owns the FDR. */
  async get(user: AuthUser, orderNo: string) {
    const order = await this.prisma.releaseOrder.findUnique({ where: { orderNo } });
    if (!order) throw new NotFoundException('Order not found.');
    if (isInstitution(user)) {
      const fdr = await this.prisma.fdr.findUnique({ where: { id: order.fdrId }, select: { institutionId: true } });
      if (!fdr || fdr.institutionId !== user.institutionId) throw new ForbiddenException('You can only open orders for your own institution.');
    }
    return order;
  }

  async pdf(user: AuthUser, orderNo: string): Promise<Buffer> {
    const order = await this.get(user, orderNo);
    const s = order.snapshot as unknown as OrderSnapshot;
    const url = `${config.publicUrl.replace(/\/$/, '')}/verify/${order.orderNo}`;
    const qr = await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 220, errorCorrectionLevel: 'M' });

    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Release / Refund Order ${order.orderNo}`, Author: 'JaanchSetu (prototype)' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const W = doc.page.width - 96;
    doc.rect(0, 0, doc.page.width, 78).fill('#14284B');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('JaanchSetu', 48, 24);
    doc.font('Helvetica').fontSize(10).fillColor('#D2DCF0').text('Security deposit / FDR portal', 48, 50);
    doc.fillColor('#FF9933').font('Helvetica-Bold').fontSize(10).text('PROTOTYPE FOR SIH 2026', 0, 30, { align: 'right', width: doc.page.width - 48 });
    doc.fillColor('#14284B').font('Helvetica-Bold').fontSize(18).text('Release / Refund Order', 48, 100);
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(`Order no. ${order.orderNo}   |   Issued ${dmy(s.issuedAt)}`, 48, 126);

    let y = 152;
    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text(label.toUpperCase(), 48, y, { width: 130 });
      doc.font('Helvetica').fontSize(10.5).fillColor('#111').text(value || '-', 184, y - 1, { width: W - 136 });
      y = Math.max(y + 18, doc.y + 6);
    };
    const heading = (t: string) => {
      y += 6;
      doc.moveTo(48, y).lineTo(48 + W, y).lineWidth(0.6).strokeColor('#C9D3E6').stroke();
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#14284B').text(t, 48, y + 6);
      y += 26;
    };
    heading('Deposit');
    row('Institution', `${s.institution.name}, ${s.institution.city}, ${s.institution.state}`);
    row('FDR number', s.fdr.fdrNumber || '-');
    row('Issuing bank', s.fdr.bank || '-');
    row('Amount', inr(s.fdr.amount));
    row('Issue / maturity', `${dmy(s.fdr.issueDate)}  to  ${dmy(s.fdr.maturityDate)}`);
    heading('Request');
    row('Requested by', `${s.request.requestedBy} on ${dmy(s.request.requestedAt)}`);
    row('Reason', s.request.reason);
    heading('Checks by the scrutiny officer (maker)');
    for (const c of s.checklist) row(c.ticked ? 'Done' : 'Not done', `${c.label}${c.note ? ' - ' + c.note : ''}`);
    row('Recommended by', `${s.maker.name ?? '-'} on ${dmy(s.maker.at)}`);
    row('Maker\'s note', s.maker.note ?? '-');
    heading('Decision by the approving officer (checker)');
    row('Decision', 'APPROVED');
    row('Approved by', `${s.checker.name ?? '-'} on ${dmy(s.checker.at)}`);
    row('Reason', s.checker.reason ?? '-');

    y += 10;
    if (y > doc.page.height - 190) { doc.addPage(); y = 60; }
    doc.rect(48, y, W, 118).lineWidth(0.8).strokeColor('#C9D3E6').stroke();
    doc.image(qr, 58, y + 8, { width: 100 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#14284B').text('Check this order', 172, y + 12);
    doc.font('Helvetica').fontSize(8.5).fillColor('#333').text(`Scan the code or open:\n${url}`, 172, y + 28, { width: W - 140 });
    doc.font('Courier').fontSize(7.5).fillColor('#555').text(`order hash  ${order.orderHash}\naudit entry #${order.auditSeq}`, 172, y + 62, { width: W - 140 });
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666').text('The page checks this order against the tamper-evident audit trail of this prototype.', 172, y + 96, { width: W - 140 });

    doc.font('Helvetica').fontSize(8).fillColor('#777').text(
      'Prototype for SIH 2026. Not an official AICTE system or document. No real bank integration. All data is fictional. This order records a decision in this system only and does not show that any bank paid out money.',
      48, doc.page.height - 100, { width: W, align: 'center' },
    );
    doc.end();
    return done;
  }
}
