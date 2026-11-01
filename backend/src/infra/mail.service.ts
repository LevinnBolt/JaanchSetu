import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { config } from '../config';
import { PrismaService } from './prisma.service';

/**
 * Sends reminder emails and ALWAYS records them in the EmailLog table (Admin > Email outbox).
 *
 *  - RECORDED: stored only (MAIL_DISABLED=true, the default for the no-Docker demo).
 *  - SENT: accepted by the SMTP server. Point SMTP_HOST / SMTP_PORT (and SMTP_USER / SMTP_PASS / SMTP_SECURE for a real
 *    provider) at any server. For the Docker demo that is the local MailHog catcher on http://localhost:8025.
 *  - FAILED: the server did not accept it; the error is kept.
 */
@Injectable()
export class MailService {
  private log = new Logger('Mail');
  private transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ignoreTLS: !config.smtp.secure && !config.smtp.user,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 5000,
  });

  constructor(private prisma: PrismaService) {}

  get enabled() {
    return process.env.MAIL_DISABLED !== 'true';
  }

  async send(to: string, subject: string, text: string, meta: { userId?: string; fdrId?: string } = {}): Promise<'SENT' | 'RECORDED' | 'FAILED'> {
    const fullSubject = `[JaanchSetu demo] ${subject}`;
    const body = `${text}\n\n--\nPrototype for SIH 2026. Not an official AICTE system.`;
    let status: 'SENT' | 'RECORDED' | 'FAILED' = 'RECORDED';
    let error: string | null = null;
    if (this.enabled) {
      try {
        await this.transport.sendMail({ from: config.mailFrom, to, subject: fullSubject, text: body });
        status = 'SENT';
      } catch (e) {
        status = 'FAILED';
        error = (e as Error).message;
        this.log.warn(`Email to ${to} not delivered: ${error}`);
      }
    }
    try {
      await this.prisma.emailLog.create({ data: { toEmail: to, toUserId: meta.userId ?? null, subject: fullSubject, body, status, error, fdrId: meta.fdrId ?? null } });
    } catch (e) {
      this.log.warn(`Could not record email to ${to}: ${(e as Error).message}`);
    }
    return status;
  }
}
