/**
 * Continuous Coverage Guard.
 *
 * An institution must keep a required security deposit in place CONTINUOUSLY. This works out, from the accepted
 * FDRs it holds, how much is covered today and on every date a deposit matures, and finds the first date the cover
 * drops below the requirement, with the FDR(s) that cause it.
 *
 * Only accepted, unmatured deposits count (status ACCEPTED, EXPIRING_SOON or RENEWAL_PENDING). A deposit covers
 * from its issue date up to, but not including, its maturity date. Anything still under review or already
 * matured, renewed or released does not count. These figures come from the submitted/reviewed records; a deposit
 * only counts as confirmed by a bank where the bank check says so. This is a monitoring aid, not a legal finding.
 */
export type CoverageStatus = 'NOT_SET' | 'OK' | 'WATCH' | 'AT_RISK' | 'SHORTFALL';

export interface CoverageItem {
  id: string;
  fdrNumber: string | null;
  amount: number;
  issue: Date | null;
  maturity: Date;
  renewalRequested?: boolean;
}
export interface CoveragePoint { date: string; held: number; short: number }
export interface CoverageCause { id: string; fdrNumber: string | null; amount: number; maturity: string; renewalRequested: boolean }
export interface CoverageResult {
  status: CoverageStatus;
  required: number | null;
  heldNow: number;
  shortfallNow: number;
  /** The first date the held amount is below the requirement (today if it already is). */
  firstGap: { date: string; daysAway: number; held: number; short: number; causes: CoverageCause[] } | null;
  timeline: CoveragePoint[];
  horizonDays: number;
}

/** Counted as "at risk" when the gap is this close. Beyond it, up to the horizon, the status is WATCH. */
export const AT_RISK_DAYS = 90;
export const HORIZON_DAYS = 365;
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (d: Date) => new Date(iso(d) + 'T00:00:00Z');

export function heldOn(items: CoverageItem[], on: Date): number {
  const t = midnight(on).getTime();
  let sum = 0;
  for (const i of items) {
    const issued = !i.issue || midnight(i.issue).getTime() <= t;
    if (issued && t < midnight(i.maturity).getTime()) sum += i.amount;
  }
  return sum;
}

export function computeCoverage(required: number | null, items: CoverageItem[], today: Date, horizonDays = HORIZON_DAYS): CoverageResult {
  const t0 = midnight(today);
  const end = t0.getTime() + horizonDays * DAY;
  const heldNow = heldOn(items, t0);
  if (required === null || required === undefined || required <= 0) {
    return { status: 'NOT_SET', required: null, heldNow, shortfallNow: 0, firstGap: null, timeline: [{ date: iso(t0), held: heldNow, short: 0 }], horizonDays };
  }

  // The held amount only changes on an issue or maturity date, so those are the only dates to look at.
  const days = new Set<number>([t0.getTime()]);
  for (const i of items) {
    for (const d of [i.issue, i.maturity]) {
      if (!d) continue;
      const m = midnight(d).getTime();
      if (m > t0.getTime() && m <= end) days.add(m);
    }
  }
  const timeline: CoveragePoint[] = [...days].sort((a, b) => a - b).map((m) => {
    const held = heldOn(items, new Date(m));
    return { date: iso(new Date(m)), held, short: Math.max(0, required - held) };
  });

  const gapPoint = timeline.find((p) => p.held < required);
  let firstGap: CoverageResult['firstGap'] = null;
  if (gapPoint) {
    const gapMs = midnight(new Date(gapPoint.date + 'T00:00:00Z')).getTime();
    // causes: the deposits that stop covering exactly on that date
    const causes = items
      .filter((i) => midnight(i.maturity).getTime() === gapMs)
      .map((i) => ({ id: i.id, fdrNumber: i.fdrNumber, amount: i.amount, maturity: iso(i.maturity), renewalRequested: !!i.renewalRequested }));
    firstGap = { date: gapPoint.date, daysAway: Math.round((gapMs - t0.getTime()) / DAY), held: gapPoint.held, short: gapPoint.short, causes };
  }
  const shortfallNow = Math.max(0, required - heldNow);
  const status: CoverageStatus = shortfallNow > 0 ? 'SHORTFALL' : !firstGap ? 'OK' : firstGap.daysAway <= AT_RISK_DAYS ? 'AT_RISK' : 'WATCH';
  return { status, required, heldNow, shortfallNow, firstGap, timeline, horizonDays };
}

/** Most urgent first. */
export const COVERAGE_ORDER: Record<CoverageStatus, number> = { SHORTFALL: 0, AT_RISK: 1, WATCH: 2, OK: 3, NOT_SET: 4 };
