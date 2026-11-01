import { evaluateDiscrepancies, isValidIfsc } from '../src/domain/discrepancy-rules';
import { parseFdrText } from '../src/domain/ocr-parser';

const good = {
  fdrNumber: 'FD2026000123',
  bank: 'Sample Bank A',
  branch: 'Salem Main',
  ifsc: 'SBAA0001234',
  amount: '500000',
  issueDate: '2026-03-12',
  maturityDate: '2027-03-12',
  depositorName: 'Sample Institute of Technology, Salem',
  inFavourOf: 'All India Council for Technical Education',
};

const types = (r: ReturnType<typeof evaluateDiscrepancies>) => r.map((d) => d.type);

describe('discrepancy rules', () => {
  it('raises nothing for consistent data', () => {
    expect(evaluateDiscrepancies({ submitted: good, extracted: { ...good }, hasDocument: true })).toEqual([]);
  });

  it('flags a missing document', () => {
    expect(types(evaluateDiscrepancies({ submitted: good, extracted: null, hasDocument: false }))).toEqual(['MISSING_DOCUMENT']);
  });

  it('flags an amount mismatch with a plain-English reason', () => {
    const r = evaluateDiscrepancies({ submitted: good, extracted: { ...good, amount: '450000' }, hasDocument: true });
    expect(types(r)).toEqual(['AMOUNT_MISMATCH']);
    expect(r[0].reason).toContain('₹50,000');
    expect(r[0].reason).toContain('₹5,00,000');
  });

  it('flags date and FDR number mismatches', () => {
    const r = evaluateDiscrepancies({
      submitted: good,
      extracted: { ...good, maturityDate: '2027-04-12', fdrNumber: 'FD2026000999' },
      hasDocument: true,
    });
    expect(types(r).sort()).toEqual(['DATE_MISMATCH', 'FDR_NUMBER_MISMATCH']);
  });

  it('validates IFSC format', () => {
    expect(isValidIfsc('SBAA0001234')).toBe(true);
    expect(isValidIfsc('SBAA1001234')).toBe(false);
    expect(isValidIfsc('SBA0001234')).toBe(false);
    expect(types(evaluateDiscrepancies({ submitted: { ...good, ifsc: 'SBAA1001234' }, extracted: null, hasDocument: true }))).toEqual(['INVALID_IFSC']);
  });

  it('flags maturity earlier than issue', () => {
    const r = evaluateDiscrepancies({ submitted: { ...good, maturityDate: '2026-01-01' }, extracted: null, hasDocument: true });
    expect(types(r)).toEqual(['MATURITY_BEFORE_ISSUE']);
  });

  it('flags a deposit not in favour of the authority', () => {
    const r = evaluateDiscrepancies({ submitted: good, extracted: { ...good, inFavourOf: 'Some Other Trust' }, hasDocument: true });
    expect(types(r)).toEqual(['NOT_IN_FAVOUR_OF_AUTHORITY']);
  });

  it('flags duplicate hash and duplicate FDR number', () => {
    const r = evaluateDiscrepancies({
      submitted: good,
      extracted: null,
      hasDocument: true,
      duplicateDocumentOf: ['FD1'],
      duplicateFdrNumberAt: ['Other Institute'],
    });
    expect(types(r).sort()).toEqual(['DUPLICATE_DOCUMENT', 'DUPLICATE_FDR_NUMBER']);
  });
});

describe('OCR field parser', () => {
  const text = [
    'SAMPLE BANK A - FIXED DEPOSIT RECEIPT',
    'FDR No: FD2026000123',
    'Branch: Salem Main',
    'IFSC: SBAA0001234',
    'Depositor: Sample Institute of Technology, Salem',
    'Deposit Amount: Rs. 5,00,000/-',
    'Date of Deposit: 12/03/2026',
    'Maturity Date: 12-03-2027',
    'In favour of: All India Council for Technical Education',
  ].join('\n');

  it('extracts every key field and normalises values', () => {
    const f = parseFdrText(text);
    expect(f.fdrNumber?.value).toBe('FD2026000123');
    expect(f.bank?.value).toBe('SAMPLE BANK A');
    expect(f.branch?.value).toBe('Salem Main');
    expect(f.ifsc?.value).toBe('SBAA0001234');
    expect(f.amount?.value).toBe('500000');
    expect(f.issueDate?.value).toBe('2026-03-12');
    expect(f.maturityDate?.value).toBe('2027-03-12');
    expect(f.depositorName?.value).toContain('Sample Institute');
    expect(f.inFavourOf?.value).toContain('All India Council');
  });

  it('does not invent dates that do not exist', () => {
    expect(parseFdrText('Maturity Date: 31/02/2027').maturityDate).toBeUndefined();
  });
});
