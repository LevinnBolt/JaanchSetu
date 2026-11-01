import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dmy, download, inr } from '../api';
import { Days, Empty, Err, Icon, PageHeader, Pager, Skeleton, StatusBadge, toast, useLoad } from '../ui';

const SIZE = 15;
const ICON: Record<string, string> = { 'pending-verifications': 'clock', 'upcoming-maturities': 'bell', 'missing-documents': 'folder', 'needs-intervention': 'alert', 'institution-summary': 'building', 'coverage-gaps': 'shield' };

export default function Reports() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const defs = useLoad(() => api('/reports'), []);
  const key = sp.get('report') || 'pending-verifications';
  const def = defs.data?.find((d: any) => d.key === key);
  const [days, setDays] = useState<number>(90);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); if (def?.param) setDays(def.param.default); }, [key, def?.param?.default]);
  const qs = `pageSize=${SIZE}&page=${page}${def?.param ? `&${def.param.key}=${days}` : ''}`;
  const { data, error } = useLoad(() => (defs.data ? api(`/reports/${key}?${qs}`) : Promise.resolve(null)), [key, page, days, !!defs.data]);

  const cell = (col: any, row: any) => {
    const v = row[col.key];
    if (v === null || v === undefined || v === '') return <span className="text-stone-400">—</span>;
    switch (col.kind) {
      case 'amount': return <span className="tabular-nums">{inr(v)}</span>;
      case 'date': return dmy(v);
      case 'status': return <StatusBadge s={v} />;
      case 'link': return <Link className="font-bold text-brand hover:underline" to={key === 'institution-summary' || key === 'coverage-gaps' ? `/institutions/${row.id}` : `/fdrs/${row.id}`} onClick={(e) => e.stopPropagation()}>{v}</Link>;
      case 'days': return col.key === 'daysLeft' ? <Days d={v} /> : <span className="tabular-nums">{v} d</span>;
      default: return v;
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle={t('Ready-made lists for officials. Every report can be downloaded as CSV.')} />
      <Err msg={defs.error} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" role="tablist" aria-label="Reports">
        {(defs.data || []).map((d: any) => {
          const on = d.key === key;
          return (
            <button key={d.key} role="tab" aria-selected={on} onClick={() => setSp({ report: d.key })}
              className={`card flex items-start gap-3 !p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-pop ${on ? '!border-gold-600 ring-2 ring-gold' : ''}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-gold text-brand' : 'bg-brand-50 text-brand'}`}><Icon name={ICON[d.key] || 'file'} size={18} /></span>
              <span><b className="block text-sm leading-tight text-brand">{t(d.title)}</b></span>
            </button>);
        })}
        {!defs.data && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
      </div>

      {def && (
        <section className="card !p-0 overflow-hidden" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 p-5">
            <div className="max-w-2xl">
              <h2 className="h-sec">{t(def.title)}</h2>
              <p className="text-sm text-stone-600">{t(def.description)}</p>
              {data && <p className="mt-1 text-xs text-stone-500">{data.total.toLocaleString('en-IN')} row{data.total === 1 ? '' : 's'} {t('· as of')} {dmy(data.today)}</p>}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {def.param && (
                <div><label className="lbl" htmlFor="rp">{t(def.param.label)}</label>
                  <select id="rp" className="inp !w-auto" value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}>{def.param.options.map((o: number) => <option key={o} value={o}>{o} days</option>)}</select></div>)}
              <button className="btn" onClick={() => download(`/reports/${key}?format=csv${def.param ? `&${def.param.key}=${days}` : ''}`, `jaanchsetu-${key}.csv`).then(() => toast(t('CSV downloaded.'))).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={16} />{t('Download CSV')}</button>
            </div>
          </div>
          <Err msg={error} />
          {!data ? <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : data.total === 0 ? (
            <div className="p-5"><Empty icon="check">{t('Nothing to report. No records match this list right now.')}</Empty></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr>{data.columns.map((c: any) => <th key={c.key} className={c.kind === 'amount' ? 'text-right' : ''}>{t(c.label)}</th>)}</tr></thead>
                  <tbody>{data.rows.map((r: any, i: number) => (
                    <tr key={(r.id || '') + i} className="cursor-pointer" onClick={() => r.id && nav(key === 'institution-summary' || key === 'coverage-gaps' ? `/institutions/${r.id}` : `/fdrs/${r.id}`)}>
                      {data.columns.map((c: any) => <td key={c.key} className={c.kind === 'amount' ? 'text-right' : ''}>{cell(c, r)}</td>)}
                    </tr>))}</tbody>
                </table>
              </div>
              <Pager page={page - 1} size={SIZE} total={data.total} onPage={(p) => setPage(p + 1)} />
            </>)}
        </section>)}
    </div>
  );
}
