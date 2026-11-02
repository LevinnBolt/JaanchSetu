import {
  FieldKey,
  FIELD_LABELS,
  IFSC_PATTERN,
  REQUIRED_AUTHORITY_NAME,
  REQUIRED_AUTHORITY_PATTERN,
  formatDisplay,
  formatInr,
  normalizeValue,
  sameValue,
} from './fields';

export const DISCREPANCY_TYPES = [
  'AMOUNT_MISMATCH',
  'DATE_MISMATCH',
  'FDR_NUMBER_MISMATCH',
  'INVALID_IFSC',
  'MATURITY_BEFORE_ISSUE',
  'NOT_IN_FAVOUR_OF_AUTHORITY',
  'MISSING_DOCUMENT',
  'DUPLICATE_DOCUMENT',
  'DUPLICATE_FDR_NUMBER',
  'BANK_MISMATCH',
  'BANK_NOT_FOUND',
  'MANUAL',
] as const;
export type DiscrepancyTypeName = (typeof DISCREPANCY_TYPES)[number];

export type ValueMap = Partial<Record<FieldKey, string | null | undefined>>;

export interface RuleInput {
  /** Values submitted by the institution: read from its document, or entered by hand where the document could not be read or the institution corrected it. */
  submitted: ValueMap;
  /** Values read by OCR (or the officer-corrected reading). null when no document has been read. */
  extracted: ValueMap | null;
  hasDocument: boolean;
  /** FDR numbers (or ids) of OTHER deposits that carry the same document hash. */
  duplicateDocumentOf?: string[];
  /** Names of institutions that already hold an FDR with the same number. */
  duplicateFdrNumberAt?: string[];
}

export interface RaisedDiscrepancy {
  type: DiscrepancyTypeName;
  fieldKey?: FieldKey;
  reason: string;
}

export function isValidIfsc(v: string | null | undefined): boolean {
  const n = normalizeValue('ifsc', v);
  return n !== null && IFSC_PATTERN.test(n);
}

/**
 * Pure rule engine. OCR output only ever *suggests*; these flags ask a human to look.
 * Deduplicated by (type, fieldKey).
 */
export function evaluateDiscrepancies(input: RuleInput): RaisedDiscrepancy[] {
  const out: RaisedDiscrepancy[] = [];
  const seen = new Set<string>();
  const add = (d: RaisedDiscrepancy) => {
    const k = `${d.type}:${d.fieldKey ?? ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  };
  const { submitted, extracted } = input;

  if (!input.hasDocument) {
    add({
      type: 'MISSING_DOCUMENT',
      reason: 'No FDR document has been uploaded. Upload a scan or photo of the receipt so the values can be read and compared.',
    });
  }

  // Extracted vs submitted comparisons
  if (extracted) {
    const amtS = normalizeValue('amount', submitted.amount);
    const amtE = normalizeValue('amount', extracted.amount);
    if (amtS !== null && amtE !== null && amtS !== amtE) {
      add({
        type: 'AMOUNT_MISMATCH',
        fieldKey: 'amount',
        reason: `The amount differs by ${formatInr(Math.abs(Number(amtS) - Number(amtE)))}: the institution entered ${formatInr(amtS)} but the document reads ${formatInr(amtE)}.`,
      });
    }
    for (const key of ['issueDate', 'maturityDate'] as const) {
      const s = normalizeValue(key, submitted[key]);
      const e = normalizeValue(key, extracted[key]);
      if (s !== null && e !== null && s !== e) {
        add({
          type: 'DATE_MISMATCH',
          fieldKey: key,
          reason: `The ${FIELD_LABELS[key].toLowerCase()} differs: the institution entered ${formatDisplay(key, s)} but the document reads ${formatDisplay(key, e)}.`,
        });
      }
    }
    const nS = submitted.fdrNumber;
    const nE = extracted.fdrNumber;
    if (normalizeValue('fdrNumber', nS) !== null && normalizeValue('fdrNumber', nE) !== null && !sameValue('fdrNumber', nS, nE)) {
      add({
        type: 'FDR_NUMBER_MISMATCH',
        fieldKey: 'fdrNumber',
        reason: `The FDR number differs: the institution entered ${normalizeValue('fdrNumber', nS)} but the document reads ${normalizeValue('fdrNumber', nE)}.`,
      });
    }
  }

  // IFSC format: check what was typed first, then what the document shows.
  const ifscS = normalizeValue('ifsc', submitted.ifsc);
  const ifscE = extracted ? normalizeValue('ifsc', extracted.ifsc) : null;
  if (ifscS !== null && !IFSC_PATTERN.test(ifscS)) {
    add({
      type: 'INVALID_IFSC',
      fieldKey: 'ifsc',
      reason: `The IFSC "${ifscS}" is not in a valid format. An IFSC has 4 letters, then the digit 0, then 6 letters or digits (for example SBAA0001234).`,
    });
  } else if (ifscE !== null && !IFSC_PATTERN.test(ifscE)) {
    add({
      type: 'INVALID_IFSC',
      fieldKey: 'ifsc',
      reason: `The IFSC read from the document ("${ifscE}") is not in a valid format. It may be a misread or a wrong code on the receipt.`,
    });
  }

  // Date order: submitted first, then extracted.
  const orderCheck = (issue: string | null, mat: string | null, who: string) => {
    if (issue && mat && mat < issue) {
      add({
        type: 'MATURITY_BEFORE_ISSUE',
        fieldKey: 'maturityDate',
        reason: `The maturity date (${formatDisplay('maturityDate', mat)}) is earlier than the issue date (${formatDisplay('issueDate', issue)}) in the ${who} values, which cannot be right.`,
      });
      return true;
    }
    return false;
  };
  const sIssue = normalizeValue('issueDate', submitted.issueDate);
  const sMat = normalizeValue('maturityDate', submitted.maturityDate);
  if (!orderCheck(sIssue, sMat, 'submitted') && extracted) {
    orderCheck(normalizeValue('issueDate', extracted.issueDate), normalizeValue('maturityDate', extracted.maturityDate), 'extracted');
  }

  // In favour of the required authority
  const favE = extracted ? normalizeValue('inFavourOf', extracted.inFavourOf) : null;
  const favS = normalizeValue('inFavourOf', submitted.inFavourOf);
  if (favE !== null) {
    if (!REQUIRED_AUTHORITY_PATTERN.test(favE)) {
      add({
        type: 'NOT_IN_FAVOUR_OF_AUTHORITY',
        fieldKey: 'inFavourOf',
        reason: `The document shows the deposit in favour of "${favE}", not ${REQUIRED_AUTHORITY_NAME}.`,
      });
    }
  } else if (favS !== null && !REQUIRED_AUTHORITY_PATTERN.test(favS)) {
    add({
      type: 'NOT_IN_FAVOUR_OF_AUTHORITY',
      fieldKey: 'inFavourOf',
      reason: `The institution entered "${favS}" as the lien holder, not ${REQUIRED_AUTHORITY_NAME}.`,
    });
  }

  if (input.duplicateDocumentOf && input.duplicateDocumentOf.length) {
    add({
      type: 'DUPLICATE_DOCUMENT',
      reason: `This exact file (same SHA-256 hash) is already attached to another deposit: ${input.duplicateDocumentOf.join(', ')}. One document cannot evidence two different FDRs.`,
    });
  }
  if (input.duplicateFdrNumberAt && input.duplicateFdrNumberAt.length) {
    add({
      type: 'DUPLICATE_FDR_NUMBER',
      fieldKey: 'fdrNumber',
      reason: `The same FDR number is already recorded by: ${input.duplicateFdrNumberAt.join(', ')}. The same FDR cannot back deposits at two institutions.`,
    });
  }
  return out;
}
