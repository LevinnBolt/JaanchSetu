import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { Public } from '../auth/auth.types';
import { config, DEMO_PASSWORD } from '../config';
import { DD_MM_YYYY, SampleDoc, renderFdrImage } from './sample-image';

export const DEMO_ACCOUNTS = [
  { email: 'institution@demo.test', label: 'Institution user', role: 'INSTITUTION' },
  { email: 'scrutiny@demo.test', label: 'Scrutiny Officer (maker)', role: 'SCRUTINY' },
  { email: 'approver@demo.test', label: 'Approving Officer (checker)', role: 'APPROVER' },
  { email: 'admin@demo.test', label: 'Admin', role: 'ADMIN' },
];

const AUTHORITY = 'All India Council for Technical Education';

/** Two specimen receipts for scenario 1 (and the "Fill demo values" button). */
export const SAMPLES: Record<string, { file: string; typed: Record<string, string>; doc: SampleDoc; note: string }> = {
  matching: {
    file: 'sample-fdr-matching.png',
    note: 'Document agrees with the typed values: no discrepancies expected.',
    typed: {
      fdrNumber: 'FDRSMP260001',
      bank: 'Sample Bank A',
      branch: 'Salem Main',
      ifsc: 'SBAA0001001',
      amount: '500000',
      issueDate: '2026-06-15',
      maturityDate: '2027-06-15',
      depositorName: 'Sample Institute of Technology, Salem',
      inFavourOf: AUTHORITY,
    },
    doc: {
      bank: 'Sample Bank A',
      fdrNumber: 'FDRSMP260001',
      branch: 'Salem Main',
      ifsc: 'SBAA0001001',
      depositor: 'Sample Institute of Technology, Salem',
      amount: 500000,
      issueDate: '15/06/2026',
      maturityDate: '15/06/2027',
      inFavourOf: AUTHORITY,
    },
  },
  mismatch: {
    file: 'sample-fdr-mismatch.png',
    note: 'Document shows ₹4,50,000 and a malformed IFSC while the typed values say ₹5,00,000: expect an amount mismatch and an invalid IFSC flag.',
    typed: {
      fdrNumber: 'FDRSMP260002',
      bank: 'Sample Bank B',
      branch: 'Coimbatore Central',
      ifsc: 'SBAB0002002',
      amount: '500000',
      issueDate: '2026-05-10',
      maturityDate: '2027-05-10',
      depositorName: 'Sample Institute of Technology, Salem',
      inFavourOf: AUTHORITY,
    },
    doc: {
      bank: 'Sample Bank B',
      fdrNumber: 'FDRSMP260002',
      branch: 'Coimbatore Central',
      ifsc: 'SBAB1002002',
      depositor: 'Sample Institute of Technology, Salem',
      amount: 450000,
      issueDate: '10/05/2026',
      maturityDate: '10/05/2027',
      inFavourOf: AUTHORITY,
    },
  },
};

@Controller('demo')
export class DemoController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get('accounts')
  accounts() {
    if (!config.demoMode) return { demoMode: false, accounts: [], password: null };
    return { demoMode: true, password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS };
  }

  /** Typed values + file link for the two specimen receipts. */
  @Public()
  @Get('samples')
  samples() {
    return Object.entries(SAMPLES).map(([name, s]) => ({ name, file: s.file, note: s.note, typed: s.typed }));
  }

  @Public()
  @Get('samples/:file')
  async sample(@Param('file') file: string, @Res() res: Response) {
    const s = Object.values(SAMPLES).find((x) => x.file === file);
    if (!s) throw new NotFoundException();
    const png = await renderFdrImage(s.doc);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${s.file}"`);
    res.send(png);
  }

  @Get('guide')
  async guide() {
    const row = await this.prisma.setting.findUnique({ where: { key: 'demoAnchors' } });
    return { anchors: row ? JSON.parse(row.value) : {} };
  }
}

export { DD_MM_YYYY };
