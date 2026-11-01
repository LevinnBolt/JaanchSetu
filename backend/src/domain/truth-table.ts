import { FIELD_KEYS, FIELD_LABELS, FieldKey, formatDisplay, mismatchMessage, normalizeValue } from './fields';

/** Provenance labels. There is deliberately no plain "Verified" state anywhere. */
export const PROVENANCE = {
  SUBMITTED: 'Submitted by institution',
  EXTRACTED: 'Extracted by OCR',
  BANK_CONFIRMED_SIMULATION: 'Bank-confirmed (simulation)',
} as const;

export interface FieldRowInput {
  key: string;
  submittedValue: string | null;
  submittedByName: string | null;
  submittedAt: Date | null;
  extractedValue: string | null;
  extractedConfidence: number | null;
  extractedAt: Date | null;
  extractedDocId: string | null;
  extractedBy: string | null;
  bankValue: string | null;
  bankAt: Date | null;
  bankSource: string | null;
  reviewAction: string | null;
  reviewedValue: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

export interface TruthRow {
  key: FieldKey;
  label: string;
  submitted: { value: string; display: string; by: string | null; at: Date | null } | null;
  extracted: { value: string; display: string; confidence: number | null; at: Date | null; docId: string | null; by: string | null } | null;
  bank: { value: string; display: string; at: Date | null; source: string | null; badge: string } | null;
  review: { action: string; value: string | null; display: string; by: string | null; at: Date | null; note: string | null } | null;
  mismatches: string[];
}

export function buildTruthTable(rows: FieldRowInput[]): TruthRow[] {
  return FIELD_KEYS.map((key) => {
    const r = rows.find((x) => x.key === key);
    const row: TruthRow = { key, label: FIELD_LABELS[key], submitted: null, extracted: null, bank: null, review: null, mismatches: [] };
    if (!r) return row;
    if (r.submittedValue) {
      row.submitted = { value: r.submittedValue, display: formatDisplay(key, r.submittedValue), by: r.submittedByName, at: r.submittedAt };
    }
    if (r.extractedValue) {
      row.extracted = {
        value: r.extractedValue,
        display: formatDisplay(key, r.extractedValue),
        confidence: r.extractedConfidence,
        at: r.extractedAt,
        docId: r.extractedDocId,
        by: r.extractedBy,
      };
    }
    if (r.bankValue) {
      row.bank = { value: r.bankValue, display: formatDisplay(key, r.bankValue), at: r.bankAt, source: r.bankSource, badge: PROVENANCE.BANK_CONFIRMED_SIMULATION };
    }
    if (r.reviewAction) {
      row.review = {
        action: r.reviewAction,
        value: r.reviewedValue,
        display: formatDisplay(key, r.reviewedValue),
        by: r.reviewedByName,
        at: r.reviewedAt,
        note: r.reviewNote,
      };
    }
    const pairs: [string, string | null, string, string | null][] = [
      ['Submitted', r.submittedValue, 'Extracted', r.extractedValue],
      ['Submitted', r.submittedValue, 'Bank (simulation)', r.bankValue],
      ['Extracted', r.extractedValue, 'Bank (simulation)', r.bankValue],
    ];
    for (const [al, a, bl, b] of pairs) {
      const m = mismatchMessage(key, a, al, b, bl);
      if (m) row.mismatches.push(m);
    }
    return row;
  });
}

/** The value the system works with: officer-reviewed if present, else what the institution typed. Not proof of anything. */
export function workingValue(r: Pick<FieldRowInput, 'reviewedValue' | 'submittedValue'> | undefined, key: FieldKey): string | null {
  return normalizeValue(key, r?.reviewedValue ?? r?.submittedValue ?? null);
}
