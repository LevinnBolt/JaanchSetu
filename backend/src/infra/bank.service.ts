import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BankRecord, BankVerificationAdapter, HttpBankAdapter, SimulatedBankAdapter } from '../domain/bank-adapter';
import { isoDate } from '../domain/dates';
import { config } from '../config';

/**
 * Chooses how an FDR is checked with the bank.
 *
 *  - Default: the SIMULATED adapter over the seeded SimBankRecord table. No real bank is contacted
 *    and every value is labelled "Bank-confirmed (simulation)".
 *  - With BANK_API_URL set: an authorised bank API (see domain/bank-adapter.ts for the contract).
 *    Values are then labelled with BANK_API_NAME, never as a simulation.
 */
@Injectable()
export class BankService {
  readonly adapter: BankVerificationAdapter;
  readonly mode: 'simulation' | 'external';
  /** Short name used in messages: "the simulated bank" or e.g. "the bank API". */
  readonly name: string;
  /** Text shown on the bank column and in the audit trail. */
  readonly label: string;
  readonly sourceLabel: string;

  constructor(private prisma: PrismaService) {
    if (config.bank.url) {
      this.mode = 'external';
      this.name = `the bank API (${config.bank.name})`;
      this.label = `Bank-confirmed (${config.bank.name})`;
      this.sourceLabel = `${config.bank.name} (${new URL(config.bank.url).host})`;
      this.adapter = new HttpBankAdapter({ url: config.bank.url, apiKey: config.bank.apiKey, timeoutMs: config.bank.timeoutMs });
      return;
    }
    this.mode = 'simulation';
    this.name = 'the simulated bank';
    this.label = 'Bank-confirmed (simulation)';
    this.sourceLabel = 'SimulatedBankAdapter (seed data, no real bank)';
    this.adapter = new SimulatedBankAdapter(async (fdrNumber) => {
      const r = await this.prisma.simBankRecord.findUnique({ where: { fdrNumber } });
      if (!r) return null;
      const rec: BankRecord = {
        fdrNumber: r.fdrNumber,
        bankName: r.bankName,
        branch: r.branch,
        ifsc: r.ifsc,
        amount: r.amount,
        issueDate: isoDate(r.issueDate)!,
        maturityDate: isoDate(r.maturityDate)!,
        depositorName: r.depositorName,
        inFavourOf: r.inFavourOf,
        outage: r.outage,
      };
      return rec;
    });
  }
}
