export const FIELD_KEYS = [
  'fdrNumber',
  'bank',
  'branch',
  'ifsc',
  'amount',
  'issueDate',
  'maturityDate',
  'depositorName',
  'inFavourOf',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  fdrNumber: 'FDR number',
  bank: 'Issuing bank',
  branch: 'Branch',
  ifsc: 'IFSC',
  amount: 'Deposit amount',
  issueDate: 'Issue date',
  maturityDate: 'Maturity date',
  depositorName: 'Depositor name',
  inFavourOf: 'In favour of / lien holder',
};

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Deposit must be held in favour of the Council. */
export const REQUIRED_AUTHORITY_PATTERN = /all\s+india\s+council\s+for\s+technical\s+education|\baicte\b/i;
export const REQUIRED_AUTHORITY_NAME = 'All India Council for Technical Education';

export function isFieldKey(k: string): k is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(k);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parses DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY or YYYY-MM-DD into ISO YYYY-MM-DD; null when not a real date. */
export function parseDateToIso(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (match) {
    d = +match[1];
    m = +match[2];
    y = +match[3];
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s))) {
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Digits-only rupee amount from strings such as "Rs. 5,00,000/-" or "₹4,50,000.00". */
export function parseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[₹,\s]|rs\.?|inr|\/-/gi, '');
  const m = /^(\d+)(?:\.\d{1,2})?$/.exec(cleaned);
  return m ? String(parseInt(m[1], 10)) : null;
}

/** Canonical form of a value so equal facts compare equal. Returns null when empty/unparseable. */
export function normalizeValue(key: FieldKey, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  switch (key) {
    case 'amount':
      return parseAmount(s);
    case 'issueDate':
    case 'maturityDate':
      return parseDateToIso(s);
    case 'fdrNumber':
      return s.replace(/\s+/g, '').toUpperCase();
    case 'ifsc':
      return s.replace(/\s+/g, '').toUpperCase();
    default:
      return s.replace(/\s+/g, ' ');
  }
}

/** True when two raw values describe the same thing. */
export function sameValue(key: FieldKey, a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeValue(key, a);
  const nb = normalizeValue(key, b);
  if (na === null || nb === null) return false;
  if (key === 'fdrNumber') return na.replace(/[-\/]/g, '') === nb.replace(/[-\/]/g, '');
  if (key === 'amount' || key === 'issueDate' || key === 'maturityDate' || key === 'ifsc') return na === nb;
  return na.toLowerCase() === nb.toLowerCase();
}

export function formatInr(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  return '₹' + Math.abs(v).toLocaleString('en-IN');
}

export function formatDisplay(key: FieldKey, v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'amount') return formatInr(v);
  if (key === 'issueDate' || key === 'maturityDate') {
    const dt = new Date(v + 'T00:00:00Z');
    if (isNaN(dt.getTime())) return v;
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return v;
}

/** Plain-language mismatch text for two differing values, or null when they agree / one is missing. */
export function mismatchMessage(
  key: FieldKey,
  a: string | null | undefined,
  aLabel: string,
  b: string | null | undefined,
  bLabel: string,
): string | null {
  const na = normalizeValue(key, a);
  const nb = normalizeValue(key, b);
  if (na === null || nb === null) return null;
  if (sameValue(key, a, b)) return null;
  const label = FIELD_LABELS[key].toLowerCase();
  const tail = `(${aLabel}: ${formatDisplay(key, na)}; ${bLabel}: ${formatDisplay(key, nb)})`;
  if (key === 'amount') {
    return `Mismatch: amount differs by ${formatInr(Math.abs(Number(na) - Number(nb)))} ${tail}`;
  }
  if (key === 'issueDate' || key === 'maturityDate') {
    const days = Math.round(
      Math.abs(new Date(na + 'T00:00:00Z').getTime() - new Date(nb + 'T00:00:00Z').getTime()) / 86400000,
    );
    return `Mismatch: ${label} differs by ${days} day${days === 1 ? '' : 's'} ${tail}`;
  }
  return `Mismatch: ${label} differs ${tail}`;
}
