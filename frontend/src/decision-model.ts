export interface AttentionItem { fdrId: string; fdrNumber: string | null; institutionName: string; status: string; daysToMaturity: number | null; note: string; blocked?: string | null; lane: 'review' | 'release' | 'overdue' | 'maturity'; }
export function attentionRank(i: AttentionItem): number {
  if (i.blocked) return 0;
  if (i.lane === 'overdue') return 50;
  if (i.daysToMaturity !== null && i.daysToMaturity <= 7) return 40;
  if (i.status === 'DISCREPANCY_RAISED') return 35;
  if (i.lane === 'release') return 30;
  if (i.daysToMaturity !== null && i.daysToMaturity <= 30) return 25;
  return 10;
}
export function buildAttention(queues: any, upcoming: any[]): AttentionItem[] {
  const all: AttentionItem[] = [
    ...(queues.overdue || []).map((i: any) => ({ ...i, lane: 'overdue' })),
    ...(queues.approval || []).map((i: any) => ({ ...i, lane: 'release' })),
    ...(queues.scrutiny || []).map((i: any) => ({ ...i, lane: i.status === 'RELEASE_REQUESTED' ? 'release' : 'review' })),
    ...(upcoming || []).map((i: any) => ({ ...i, lane: 'maturity', note: i.daysToMaturity < 0 ? 'Matured instrument. Review the renewal or authorised release path.' : 'Review renewal requirements before this instrument matures.' })),
  ];
  const unique = new Map<string, AttentionItem>();
  for (const item of all) {
    const previous = unique.get(item.fdrId);
    if (!previous || item.blocked || (!previous.blocked && attentionRank(item) > attentionRank(previous))) unique.set(item.fdrId, item);
  }
  return [...unique.values()].sort((a,b) => attentionRank(b)-attentionRank(a) || (a.daysToMaturity ?? Infinity)-(b.daysToMaturity ?? Infinity) || a.fdrId.localeCompare(b.fdrId));
}
export function monthBounds(key: string) {
  const [year, month] = key.split('-').map(Number);
  return { from: `${key}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0,10) };
}
export interface DecisionCheck { key: string; label: string; passed: boolean; detail: string; tab: string; }
export function decisionChecks(d: any): DecisionCheck[] {
  const rows = d.truthTable || [];
  const unreviewed = rows.filter((r: any) => r.extracted && !r.review).length;
  const flags = (d.discrepancies || []).filter((r: any) => r.status === 'OPEN').length;
  const bank = rows.filter((r: any) => r.bank).length;
  const request = (d.releaseRequests || []).find((r: any) => ['REQUESTED','RECOMMENDED'].includes(r.status));
  const checklist = request?.checklist || [];
  const done = checklist.filter((c: any) => c.ticked && c.note?.trim().length >= 3).length;
  return [
    { key:'document', label:'Supporting document', passed:!!d.documents?.length, detail:d.documents?.length ? `${d.documents.length} document version(s) on file` : 'Upload a supporting document', tab:'docs' },
    { key:'review', label:'Extracted-field review', passed:rows.some((r: any)=>r.extracted) && unreviewed === 0, detail:unreviewed ? `${unreviewed} extracted field(s) need officer review` : rows.some((r: any)=>r.extracted) ? 'All extracted fields have an officer review' : 'No extracted fields available to review', tab:'truth' },
    { key:'flags', label:'Discrepancy resolution', passed:flags === 0, detail:flags ? `${flags} open flag(s) need resolution or a reasoned waiver` : 'No open discrepancy flags', tab:'disc' },
    { key:'bank', label:'Financial-source evidence', passed:bank === rows.length && rows.length > 0, detail:`${bank} of ${rows.length} fields have financial-source values. Source labels still apply.`, tab:'truth' },
    { key:'release', label:'Release checklist', passed:checklist.length > 0 && done === checklist.length, detail:request ? `${done} of ${checklist.length} items completed with notes` : 'No pending release request; not yet applicable.', tab:'release' },
  ];
}
