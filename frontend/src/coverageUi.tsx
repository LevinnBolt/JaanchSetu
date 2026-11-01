import { dmy, inr } from './api';
import { Icon } from './ui';
import { t } from './i18n';

export type CoverageStatus = 'NOT_SET' | 'OK' | 'WATCH' | 'AT_RISK' | 'SHORTFALL';

const LOOK: Record<CoverageStatus, { label: string; cls: string; icon: string }> = {
  SHORTFALL: { label: 'Short now', cls: 'border-red-300 bg-red-50 text-red-800', icon: 'alert' },
  AT_RISK: { label: 'At risk (within 90 days)', cls: 'border-orange-300 bg-orange-50 text-orange-900', icon: 'clock' },
  WATCH: { label: 'Watch (within a year)', cls: 'border-sky-300 bg-sky-50 text-sky-800', icon: 'clock' },
  OK: { label: 'Covered for the year', cls: 'border-stone-300 bg-stone-100 text-stone-800', icon: 'shield' },
  NOT_SET: { label: 'No requirement set', cls: 'border-stone-300 bg-white text-stone-600', icon: 'info' },
};
export const CoverageChip = ({ s }: { s: CoverageStatus }) => {
  const x = LOOK[s] || LOOK.NOT_SET;
  return <span className={`chip whitespace-nowrap ${x.cls}`}><Icon name={x.icon} size={12} />{t(x.label)}</span>;
};

/** The sentence that matters: when cover drops, by how much, and which FDR causes it. */
export function coverageMessage(c: any): string {
  if (c.status === 'NOT_SET') return t('No required deposit has been entered for this institution yet.');
  if (c.status === 'SHORTFALL') return t('The deposit held is {held}, which is {short} below the requirement of {req}.', { held: inr(c.heldNow), short: inr(c.shortfallNow), req: inr(c.required) });
  if (c.status === 'OK' || !c.firstGap) return t('Cover holds for the whole next year.');
  const causes = (c.firstGap.causes || []).map((x: any) => x.fdrNumber).filter(Boolean).join(', ');
  return t('On {date} ({n} days away) the deposit held drops to {held}, which is {short} below the requirement, because {cause} matures. Renew or replace it before then.',
    { date: dmy(c.firstGap.date), n: c.firstGap.daysAway, held: inr(c.firstGap.held), short: inr(c.firstGap.short), cause: causes ? `FDR ${causes}` : t('a deposit') });
}

/** Deposit held over the next year, as a step line. The dashed line is the requirement. Below it is shown in red. */
export function CoverageChart({ c }: { c: any }) {
  const pts: { date: string; held: number }[] = c.timeline || [];
  if (!pts.length) return null;
  const W = 640, H = 190, L = 58, R = 12, T = 14, B = 28;
  const start = new Date(pts[0].date + 'T00:00:00Z').getTime();
  const end = start + (c.horizonDays || 365) * 86400000;
  const maxV = Math.max(c.required || 0, ...pts.map((p) => p.held), 1) * 1.12;
  const x = (iso: string) => L + ((new Date(iso + 'T00:00:00Z').getTime() - start) / (end - start)) * (W - L - R);
  const xEnd = W - R;
  const y = (v: number) => T + (1 - v / maxV) * (H - T - B);
  const segs = pts.map((p, i) => ({ x0: x(p.date), x1: i + 1 < pts.length ? x(pts[i + 1].date) : xEnd, held: p.held }));
  const below = (h: number) => c.required != null && h < c.required;
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxV * f / 1.12));
  const months = [0, 3, 6, 9, 12].map((m) => { const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + m); return { m, label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }), x: L + ((d.getTime() - start) / (end - start)) * (W - L - R) }; });
  return (
    <figure className="my-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('Deposit held over the next year compared with the requirement')}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={xEnd} y1={y(v)} y2={y(v)} stroke="#e7e5e4" strokeWidth="1" /><text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#78716c">{v >= 100000 ? `${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : v}</text></g>)}
        {segs.map((s, i) => <rect key={i} x={s.x0} y={y(s.held)} width={Math.max(1, s.x1 - s.x0)} height={Math.max(0, y(0) - y(s.held))} fill={below(s.held) ? '#fca5a5' : 'rgb(var(--brand-100))'} opacity={0.9} />)}
        {segs.map((s, i) => <line key={'l' + i} x1={s.x0} x2={s.x1} y1={y(s.held)} y2={y(s.held)} stroke={below(s.held) ? '#dc2626' : 'rgb(var(--brand))'} strokeWidth="2.4" />)}
        {c.required != null && <><line x1={L} x2={xEnd} y1={y(c.required)} y2={y(c.required)} stroke="rgb(var(--gold-600))" strokeWidth="1.8" strokeDasharray="6 4" /><text x={xEnd} y={y(c.required) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="rgb(var(--gold-600))">{t('Required')} {inr(c.required)}</text></>}
        {c.firstGap && c.firstGap.daysAway > 0 && <g><line x1={x(c.firstGap.date)} x2={x(c.firstGap.date)} y1={T} y2={H - B} stroke="#dc2626" strokeWidth="1.4" strokeDasharray="2 3" /><text x={x(c.firstGap.date) + 4} y={T + 9} fontSize="9.5" fontWeight="700" fill="#b91c1c">{t('gap')} {dmy(c.firstGap.date)}</text></g>}
        {months.map((m) => <text key={m.m} x={m.x} y={H - 10} textAnchor={m.m === 0 ? 'start' : m.m === 12 ? 'end' : 'middle'} fontSize="9" fill="#78716c">{m.label}</text>)}
      </svg>
    </figure>
  );
}

export function CoveragePanel({ c, onEdit }: { c: any; onEdit?: () => void }) {
  const bad = c.status === 'SHORTFALL' || c.status === 'AT_RISK';
  return (
    <section className={`card ${bad ? '!border-red-300' : ''}`} aria-labelledby="cov-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cov-h" className="h-sec flex items-center gap-2"><Icon name="shield" size={18} />{t('Deposit cover')}</h2>
          <p className="text-xs text-stone-500">{t('Accepted, unmatured deposits only. A deposit stops counting on its maturity date.')}</p>
        </div>
        <div className="flex items-center gap-2"><CoverageChip s={c.status} />{onEdit && <button className="btn-alt btn-sm" onClick={onEdit}>{t('Set required deposit')}</button>}</div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-stone-500">{t('Required')}</dt><dd className="text-lg font-extrabold tabular-nums text-brand">{c.required ? inr(c.required) : '—'}</dd></div>
        <div><dt className="text-xs text-stone-500">{t('Held today')}</dt><dd className="text-lg font-extrabold tabular-nums text-brand">{inr(c.heldNow)}</dd></div>
        <div><dt className="text-xs text-stone-500">{t('Short today')}</dt><dd className={`text-lg font-extrabold tabular-nums ${c.shortfallNow ? 'text-red-700' : 'text-brand'}`}>{c.shortfallNow ? inr(c.shortfallNow) : '—'}</dd></div>
      </dl>
      <p className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${bad ? 'border-red-200 bg-red-50 text-red-900' : 'border-stone-200 bg-stone-50 text-stone-700'}`}><Icon name={bad ? 'alert' : 'info'} size={16} className="mt-0.5 shrink-0" />{coverageMessage(c)}</p>
      {c.required ? <CoverageChart c={c} /> : null}
      {c.instruments && c.instruments.length > 0 && (
        <div className="mt-2 overflow-x-auto"><table className="tbl"><thead><tr><th>{t('FDR number')}</th><th className="text-right">{t('Amount')}</th><th>{t('Covers from')}</th><th>{t('Stops covering on')}</th></tr></thead>
          <tbody>{c.instruments.map((i: any) => <tr key={i.id}><td className="font-semibold text-brand">{i.fdrNumber}</td><td className="text-right tabular-nums">{inr(i.amount)}</td><td>{dmy(i.issueDate)}</td><td>{dmy(i.maturityDate)}{i.status === 'RENEWAL_PENDING' && <span className="ml-2 text-xs font-semibold text-sky-700">{t('renewal requested')}</span>}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}
