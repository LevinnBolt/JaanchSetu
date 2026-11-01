import { FieldKey, normalizeValue, parseAmount, parseDateToIso } from './fields';

export interface OcrLine {
  text: string;
  /** 0-100 as reported by tesseract; null for text that came from a PDF text layer. */
  confidence: number | null;
}

export interface ParsedField {
  value: string;
  confidence: number | null;
  /** The raw line the value was read from, shown to the officer for context. */
  sourceLine: string;
}

export type ParsedFields = Partial<Record<FieldKey, ParsedField>>;

const DATE = String.raw`(\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{4})`;

interface Rule {
  key: FieldKey;
  re: RegExp;
  take: (m: RegExpExecArray) => string | null;
}

// Regex rules for the specimen layout and common variants. OCR only suggests; an officer confirms.
const RULES: Rule[] = [
  {
    key: 'fdrNumber',
    re: /(?:FDR|FD|RECEIPT|DEPOSIT)\s*(?:NO|NUMBER|NUM|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,24})/i,
    take: (m) => m[1],
  },
  {
    key: 'bank',
    re: /^\s*(?:BANK\s*[:\-]\s*)?(.*?)\s*[-–—:]*\s*FIXED\s+DEPOSIT\s+RECEIPT/i,
    take: (m) => (m[1] && m[1].trim().length > 2 ? m[1].trim() : null),
  },
  { key: 'branch', re: /BRANCH(?:\s+NAME)?\s*[:\-]\s*(.+)/i, take: (m) => m[1] },
  { key: 'ifsc', re: /IFS\s*C?(?:\s*CODE)?\s*[:\-]?\s*([A-Z0-9 ]{8,14})/i, take: (m) => m[1] },
  {
    key: 'amount',
    re: /(?:DEPOSIT\s+|PRINCIPAL\s+)?AMOUNT\s*[:\-]?\s*((?:₹|RS\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?)/i,
    take: (m) => m[1],
  },
  {
    key: 'issueDate',
    re: new RegExp(String.raw`(?:DATE\s+OF\s+(?:DEPOSIT|ISSUE)|ISSUE\s+DATE|DEPOSIT\s+DATE)\s*[:\-]?\s*` + DATE, 'i'),
    take: (m) => m[1],
  },
  {
    key: 'maturityDate',
    re: new RegExp(String.raw`(?:MATURITY\s+DATE|DATE\s+OF\s+MATURITY)\s*[:\-]?\s*` + DATE, 'i'),
    take: (m) => m[1],
  },
  {
    key: 'depositorName',
    re: /(?:NAME\s+OF\s+(?:THE\s+)?DEPOSITOR|DEPOSITOR(?:\s+NAME)?|CUSTOMER\s+NAME)\s*[:\-]\s*(.+)/i,
    take: (m) => m[1],
  },
  {
    key: 'inFavourOf',
    re: /(?:IN\s+FAVOU?R\s+OF|LIEN\s+(?:MARKED\s+)?(?:TO|IN\s+FAVOU?R\s+OF))\s*[:\-]?\s*(.+)/i,
    take: (m) => m[1],
  },
];

function clean(key: FieldKey, raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  switch (key) {
    case 'amount':
      return parseAmount(s);
    case 'issueDate':
    case 'maturityDate':
      return parseDateToIso(s.replace(/\s+/g, ''));
    case 'ifsc': {
      // tesseract may insert spaces; keep only the first run that looks like a code
      const compact = s.replace(/\s+/g, '').toUpperCase();
      return compact.slice(0, 11);
    }
    default:
      return normalizeValue(key, s.replace(/[|_]+$/g, ''));
  }
}

/** Parse labelled lines into candidate field values. The first confident match per field wins. */
export function parseFdrLines(lines: OcrLine[]): ParsedFields {
  const out: ParsedFields = {};
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    for (const rule of RULES) {
      if (out[rule.key]) continue;
      const m = rule.re.exec(text);
      if (!m) continue;
      const taken = rule.take(m);
      if (!taken) continue;
      const value = clean(rule.key, taken);
      if (!value) continue;
      out[rule.key] = {
        value,
        confidence: line.confidence === null ? null : Math.round(line.confidence * 10) / 10,
        sourceLine: text,
      };
      break;
    }
  }
  return out;
}

/** Parse free text (PDF text layer). */
export function parseFdrText(text: string): ParsedFields {
  return parseFdrLines(text.split(/\r?\n/).map((t) => ({ text: t, confidence: null })));
}
