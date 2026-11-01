import { t } from '../i18n';
import { useState } from 'react';
import SavedViews from '../components/SavedViews';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dmy, download, inr } from '../api';
import { Days, Empty, Err, Icon, PageHeader, Pager, Skeleton, StatusBadge, VerifyBadge, statusText, titleCase, toast, useBank, useLoad } from '../ui';

const BUCKETS: Record<string, string> = { active: 'Active', expiring90: 'Expiring in 90 days', matured: 'Matured', renewal: 'Renewal pending', release: 'Release / refund pending', discrepancy: 'Open discrepancies', overdue: 'Overdue (escalated)', scrutiny: 'Needs scrutiny', pending: 'Pending verification', bankconfirmed: 'Bank-confirmed' };
const SIZE = 15;

export default function FdrList() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const bank = useBank();
  // quick filters: [bucket, label, key in /dashboard cards]
  const QUICK: [string, string, string | null][] = [
    ['', 'All', null], ['pending', 'Pending verification', 'pendingVerification'], ['bankconfirmed', bank.simulated ? 'Bank-confirmed (sim.)' : 'Bank-confirmed', 'bankConfirmed'],
    ['active', 'Active', 'active'], ['expiring90', 'Expiring ≤ 90d', 'expiring90'], ['matured', 'Matured', 'matured'],
    ['renewal', 'Renewal', 'renewalPending'], ['release', 'Release / refund', 'releasePending'], ['discrepancy', 'Open flags', 'openDiscrepancies'], ['overdue', 'Overdue', 'overdue'],
  ];
  const meta = useLoad(() => api('/meta'), []);
  const counts = useLoad(() => api('/dashboard'), []);
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const filterQs = (() => { const n = new URLSearchParams(sp); n.delete('page'); return n.toString(); })();
  const { data, error } = useLoad(() => api(`/fdrs?${filterQs}&page=${page}&pageSize=${SIZE}`), [filterQs, page]);
  const [showFilters, setShowFilters] = useState(false);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); n.delete('page'); setSp(n); };
  const setPage = (p: number) => { const n = new URLSearchParams(sp); p > 1 ? n.set('page', String(p)) : n.delete('page'); setSp(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const sel = (k: string, label: string, opts: { v: string; t: string }[]) => (
    <div><label className="lbl" htmlFor={k}>{t(label)}</label>
      <select id={k} className="inp" value={sp.get(k) || ''} onChange={(e) => set(k, e.target.value)}><option value="">{t('All')}</option>{opts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select></div>
  );
  const active = [...sp.entries()].filter(([k, v]) => v && k !== 'bucket' && k !== 'page');
  const bucket = sp.get('bucket') || '';
  const rows: any[] = data?.items || [];
  return (
    <div>
      <PageHeader title={t('All FDRs')} subtitle={data ? t('{n} deposits · {amount} total', { n: data.total.toLocaleString('en-IN'), amount: inr(data.totalAmount) }) : t('Loading…')}
        actions={<>
          <button className="btn-alt" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><Icon name="search" size={16} />{showFilters ? 'Hide filters' : `More filters${active.length ? ` (${active.length})` : ''}`}</button>
          <button className="btn" onClick={() => download('/fdrs/export?' + filterQs, 'jaanchsetu-fdr-export.csv').then(() => toast(t('CSV exported with the current filters.'))).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={16} />{t('Export CSV')}</button>
        </>} />
      <Err msg={error} />
      <SavedViews query={filterQs} apply={(query)=>setSp(new URLSearchParams(query))}/>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('Quick filters')}>
        {QUICK.map(([b, label, key]) => {
          const on = bucket === b;
          const n = key && counts.data ? counts.data.cards[key] : null;
          return (
            <button key={label} onClick={() => set('bucket', b)} aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${on ? 'border-brand bg-brand text-white shadow-sm' : 'border-stone-300 bg-white text-stone-700 hover:border-brand hover:bg-brand-50'}`}>
              {t(label)}{n !== null && <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}>{n.toLocaleString('en-IN')}</span>}
            </button>);
        })}
        {bucket && !QUICK.some(([b]) => b === bucket) && <span className="chip border-brand/30 bg-brand-50 text-brand">{t(BUCKETS[bucket] || bucket)}</span>}
      </div>

      {showFilters && (
        <div className="card mb-4 grid gap-3 !p-4 md:grid-cols-4">
          <div><label className="lbl" htmlFor="q">{t('Search')}</label><input id="q" className="inp" placeholder={t('FDR number, bank, institution')} defaultValue={sp.get('q') || ''} key={sp.get('q') || ''} onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value)} onBlur={(e) => e.target.value !== (sp.get('q') || '') && set('q', e.target.value)} /></div>
          {sel('state', 'State', (meta.data?.states || []).map((s: string) => ({ v: s, t: s })))}
          {sel('bank', 'Bank', (meta.data?.banks || []).map((s: string) => ({ v: s, t: titleCase(s) })))}
          {sel('status', 'Status', (meta.data?.statuses || []).map((s: string) => ({ v: s, t: statusText(s) })))}
          {sel('verification', 'Verification', [{ v: 'PENDING', t: 'Pending' }, { v: 'BANK_CONFIRMED', t: bank.simulated ? 'Bank-confirmed (simulation)' : 'Bank-confirmed' }, { v: 'DISCREPANCY', t: 'Discrepancy / rejected' }])}
          {sel('discrepancyType', 'Open discrepancy type', (meta.data?.discrepancyTypes || []).map((s: string) => ({ v: s, t: s.replace(/_/g, ' ').toLowerCase() })))}
          <div><label className="lbl" htmlFor="mf">{t('Matures from')}</label><input id="mf" type="date" className="inp" value={sp.get('maturityFrom') || ''} onChange={(e) => set('maturityFrom', e.target.value)} /></div>
          <div><label className="lbl" htmlFor="mt">{t('Matures to')}</label><input id="mt" type="date" className="inp" value={sp.get('maturityTo') || ''} onChange={(e) => set('maturityTo', e.target.value)} /></div>
        </div>)}
      {(active.length > 0 || sp.get('q')) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-500">{t('Filters:')}</span>
          {active.map(([k, v]) => <button key={k} className="chip border-brand/30 bg-brand-50 text-brand hover:bg-brand-100" onClick={() => set(k, '')}>{k === 'institutionId' ? 'one institution' : `${k}: ${v.length > 18 ? v.slice(0, 18) + '…' : v}`}<Icon name="x" size={12} /></button>)}
          <button className="font-semibold text-stone-600 underline" onClick={() => setSp(new URLSearchParams())}>{t('Clear all')}</button>
        </div>)}

      {!data ? <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div> : data.total === 0 ? (
        <Empty icon="search">{t('No FDRs match these filters. Choose “All” above, or clear the filters.')}</Empty>
      ) : (
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>{t('FDR number')}</th><th>{t('Institution')}</th><th>{t('Bank')}</th><th className="text-right">{t('Amount')}</th><th>{t('Matures')}</th><th>{t('Time left')}</th><th>{t('Status')}</th><th>{t('Verification')}</th></tr></thead>
              <tbody>{rows.map((r: any) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/fdrs/${r.id}`)}>
                  <td><Link className="font-bold text-brand hover:underline" to={`/fdrs/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.fdrNumber || 'Draft'}</Link></td>
                  <td className="min-w-[190px]">{r.institutionName}<div className="text-xs text-stone-500">{r.state}</div></td>
                  <td className="whitespace-nowrap">{titleCase(r.bank)}</td><td className="text-right tabular-nums">{inr(r.amount)}</td><td className="whitespace-nowrap">{dmy(r.maturityDate)}</td><td className="whitespace-nowrap"><Days d={r.daysToMaturity} /></td>
                  <td><StatusBadge s={r.status} /></td>
                  <td><VerifyBadge v={r.verification} />{r.openDiscrepancies > 0 && <div className="mt-1 text-xs font-semibold text-red-700" title={r.discrepancyTypes.join(', ')}>{t('{n} open flag(s)', { n: r.openDiscrepancies })}</div>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <Pager page={page - 1} size={SIZE} total={data.total} onPage={(p) => setPage(p + 1)} />
        </div>)}
    </div>
  );
}
