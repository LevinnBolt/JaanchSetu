import { CoverageItem, computeCoverage, heldOn } from '../src/domain/coverage';

const TODAY = new Date('2026-10-31T00:00:00Z');
const day = (n: number) => new Date(TODAY.getTime() + n * 86400000);
const fdr = (id: string, amount: number, maturityInDays: number, issueInDays: number | null = -100): CoverageItem => ({
  id, fdrNumber: id, amount, maturity: day(maturityInDays), issue: issueInDays === null ? null : day(issueInDays),
});

describe('Continuous Coverage Guard', () => {
  it('NOT_SET when no requirement has been entered (still reports what is held)', () => {
    const r = computeCoverage(null, [fdr('A', 500000, 200)], TODAY);
    expect(r.status).toBe('NOT_SET');
    expect(r.heldNow).toBe(500000);
    expect(r.firstGap).toBeNull();
  });

  it('SHORTFALL when less than required is held today, with the gap dated today', () => {
    const r = computeCoverage(1000000, [fdr('A', 500000, 200)], TODAY);
    expect(r.status).toBe('SHORTFALL');
    expect(r.shortfallNow).toBe(500000);
    expect(r.firstGap?.daysAway).toBe(0);
  });

  it('AT_RISK when a maturity within 90 days drops cover below the requirement, naming the FDR', () => {
    const r = computeCoverage(800000, [fdr('A', 1000000, 40)], TODAY);
    expect(r.status).toBe('AT_RISK');
    expect(r.firstGap?.date).toBe('2026-12-10');
    expect(r.firstGap?.daysAway).toBe(40);
    expect(r.firstGap?.short).toBe(800000);
    expect(r.firstGap?.causes.map((c) => c.id)).toEqual(['A']);
  });

  it('WATCH when the gap is further away than 90 days but inside the year', () => {
    const r = computeCoverage(800000, [fdr('A', 1000000, 200)], TODAY);
    expect(r.status).toBe('WATCH');
    expect(r.firstGap?.daysAway).toBe(200);
  });

  it('OK when cover holds for the whole year', () => {
    const r = computeCoverage(800000, [fdr('A', 1000000, 500)], TODAY);
    expect(r.status).toBe('OK');
    expect(r.firstGap).toBeNull();
  });

  it('a renewed FDR that overlaps the old one closes the gap', () => {
    const old = fdr('OLD', 1000000, 30);
    const renewed = fdr('NEW', 1000000, 400, -5);
    expect(computeCoverage(900000, [old], TODAY).status).toBe('AT_RISK');
    expect(computeCoverage(900000, [old, renewed], TODAY).status).toBe('OK');
  });

  it('a renewed FDR that only starts after the old one matures leaves a gap in between', () => {
    const old = fdr('OLD', 1000000, 30);
    const later = fdr('NEW', 1000000, 400, 45);
    const r = computeCoverage(900000, [old, later], TODAY);
    expect(r.status).toBe('AT_RISK');
    expect(r.firstGap?.date).toBe(day(30).toISOString().slice(0, 10));
  });

  it('finds the first date when several deposits stack up', () => {
    const r = computeCoverage(1000000, [fdr('A', 600000, 50), fdr('B', 600000, 200)], TODAY);
    expect(r.heldNow).toBe(1200000);
    expect(r.status).toBe('AT_RISK');
    expect(r.firstGap?.daysAway).toBe(50);
    expect(r.firstGap?.held).toBe(600000);
    expect(r.firstGap?.causes.map((c) => c.id)).toEqual(['A']);
  });

  it('a deposit stops covering ON its maturity date', () => {
    expect(heldOn([fdr('A', 100, 0)], TODAY)).toBe(0);
    expect(heldOn([fdr('A', 100, 1)], TODAY)).toBe(100);
  });

  it('a deposit with a future issue date only counts from that date', () => {
    const r = computeCoverage(500000, [fdr('A', 500000, 300, 20)], TODAY);
    expect(r.status).toBe('SHORTFALL');
    expect(r.timeline.find((p) => p.date === day(20).toISOString().slice(0, 10))?.held).toBe(500000);
  });

  it('the timeline starts today, is in date order and only changes on issue or maturity days', () => {
    const r = computeCoverage(100, [fdr('A', 500, 40), fdr('B', 500, 200)], TODAY);
    const dates = r.timeline.map((p) => p.date);
    expect(dates[0]).toBe('2026-10-31');
    expect([...dates].sort()).toEqual(dates);
    expect(dates).toHaveLength(3);
  });

  it('flags when the deposit that causes the gap already has a renewal requested', () => {
    const a = { ...fdr('A', 1000000, 40), renewalRequested: true };
    expect(computeCoverage(800000, [a], TODAY).firstGap?.causes[0].renewalRequested).toBe(true);
  });
});
