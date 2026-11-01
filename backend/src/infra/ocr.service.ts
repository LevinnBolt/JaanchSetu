import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createWorker, Worker } from 'tesseract.js';
import { config } from '../config';
import { FieldKey } from '../domain/fields';
import { OcrLine, ParsedFields, parseFdrLines, parseFdrText } from '../domain/ocr-parser';

export type OcrStatus = 'DONE' | 'NO_TEXT_LAYER' | 'FAILED';

export interface OcrResult {
  status: OcrStatus;
  note: string;
  text: string;
  meanConfidence: number | null;
  fields: ParsedFields;
}

/**
 * OCR via tesseract.js plus our own regex field parsers. OCR only SUGGESTS values: it never
 * establishes that an FDR is genuine, and an officer must confirm or correct every value.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private log = new Logger('OCR');
  private worker?: Promise<Worker>;
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      const opts: Record<string, unknown> = {};
      if (config.tessdataPath) {
        opts.langPath = config.tessdataPath;
        opts.gzip = false;
      }
      this.worker = createWorker('eng', 1, opts).catch((e) => {
        this.worker = undefined;
        throw e;
      });
    }
    return this.worker;
  }

  async onModuleDestroy() {
    if (this.worker) await (await this.worker).terminate().catch(() => undefined);
  }

  /** Serialised: one tesseract worker handles one image at a time. */
  extract(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    const run = this.queue.then(() => this.doExtract(buffer, mimeType));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doExtract(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    if (mimeType === 'application/pdf') return this.fromPdf(buffer);
    try {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true } as any);
      const lines: OcrLine[] = [];
      const anyData = data as any;
      for (const block of anyData.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const l of para.lines ?? []) lines.push({ text: l.text, confidence: l.confidence });
        }
      }
      if (!lines.length && anyData.lines) for (const l of anyData.lines) lines.push({ text: l.text, confidence: l.confidence });
      if (!lines.length) for (const t of String(data.text || '').split(/\r?\n/)) lines.push({ text: t, confidence: data.confidence });
      const fields = parseFdrLines(lines);
      return {
        status: 'DONE',
        note: `Read ${Object.keys(fields).length} of 9 fields with tesseract.js`,
        text: data.text || '',
        meanConfidence: typeof data.confidence === 'number' ? data.confidence : null,
        fields,
      };
    } catch (e) {
      this.log.warn(`OCR failed: ${(e as Error).message}`);
      return { status: 'FAILED', note: `OCR could not run: ${(e as Error).message}`, text: '', meanConfidence: null, fields: {} };
    }
  }

  private async fromPdf(buffer: Buffer): Promise<OcrResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const parsed = await pdfParse(buffer);
      const text: string = parsed.text || '';
      if (text.trim().length < 20) {
        return {
          status: 'NO_TEXT_LAYER',
          note: 'This PDF has no readable text layer (likely a scan). The prototype OCRs images only; upload a JPG/PNG of the receipt, or the officer can key the values in.',
          text: '',
          meanConfidence: null,
          fields: {},
        };
      }
      const fields = parseFdrText(text);
      return { status: 'DONE', note: `Read ${Object.keys(fields).length} of 9 fields from the PDF text layer (no OCR confidence available)`, text, meanConfidence: null, fields };
    } catch (e) {
      return { status: 'FAILED', note: `PDF could not be read: ${(e as Error).message}`, text: '', meanConfidence: null, fields: {} };
    }
  }
}

export type { FieldKey };
