import { t } from '../i18n';
import { useState } from 'react';
import { api, dt } from '../api';
import { Empty, Err, Icon, PageHeader, Pager, Spinner, useLoad } from '../ui';

const SIZE = 50;
const tone = (a: string) => (/REJECT|DISCREPANCY|WAIVE|ESCALAT|DENIED/.test(a) ? 'border-red-300 bg-red-50 text-red-800' : /APPROVE|ACCEPT|RELEASED|RESOLVE|CONFIRM/.test(a) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : /REMINDER|MATUR|CLOCK|RADAR/.test(a) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-stone-300 bg-stone-100 text-stone-800');

export default function AuditPage() {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error } = useLoad(() => api(`/audit?limit=${SIZE}&offset=${offset}&q=${encodeURIComponent(q)}`), [q, offset]);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const verify = async () => { setBusy(true); try { setRes(await api('/audit/verify')); } catch (e) { setRes({ intact: false, message: (e as Error).message }); } setBusy(false); };
  return (
    <div className="space-y-4">
      <PageHeader title={t('Audit trail')} subtitle={t('Append-only. Every entry stores SHA-256(previous entry hash + this entry\'s data). The database also refuses UPDATE and DELETE on this table.')} />

      <div className="card flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand"><Icon name="lock" size={22} /></span>
        <div className="min-w-0 flex-1">
          <b className="block text-brand">{t('Tamper check')}</b>
          <span className="text-sm text-stone-600">{t('Recomputes the whole hash chain. Any edited or removed row breaks it.')}</span>
        </div>
        <button className="btn" disabled={busy} onClick={verify}>{busy ? <><Spinner size={22} />{t('Verifying…')}</> : 'Verify chain integrity'}</button>
        {res && <div role="status" className={`flex w-full items-center gap-2 rounded-lg border p-3 text-sm font-semibold ${res.intact ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-red-400 bg-red-50 text-red-900'}`}>
          <Icon name={res.intact ? 'check' : 'alert'} size={18} />{res.intact ? 'Chain intact' : 'Chain BROKEN'}: {res.message}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative"><Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" /><input aria-label={t('Search the audit trail')} className="inp !w-72 !pl-8" value={q} onChange={(e) => { setOffset(0); setQ(e.target.value); }} placeholder={t('Search user, action or id')} /></div>
        {data && <span className="text-sm text-stone-600">{data.total} entries</span>}
      </div>
      <Err msg={error} />
      {data && data.items.length === 0 ? <Empty icon="search">{t('No entry matches “')}{q}”.</Empty> : (
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>#</th><th>{t('When')}</th><th>{t('Who')}</th><th>{t('Action')}</th><th>{t('Entity')}</th><th>{t('Hash')}</th></tr></thead>
            <tbody>{data?.items.map((a: any) => (
              <tr key={a.seq}>
                <td className="tabular-nums text-stone-500">{a.seq}</td>
                <td className="whitespace-nowrap">{dt(a.at)}{a.clockDate && <div className="text-xs text-stone-500">demo date {a.clockDate}</div>}</td>
                <td>{a.actor}<div className="text-xs text-stone-500">{a.role}</div></td>
                <td><span className={`chip ${tone(a.action)}`}>{a.action}</span>
                  <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-stone-500 hover:text-brand">{t('detail')}</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs">{JSON.stringify(a.detail, null, 1)}</pre></details></td>
                <td className="text-xs"><b className="text-stone-700">{a.entityType}</b><div className="max-w-[10rem] truncate font-mono text-stone-500" title={a.entityId}>{a.entityId}</div></td>
                <td><code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700" title={a.hash}>{a.hash.slice(0, 12)}…</code></td>
              </tr>))}</tbody>
          </table></div>
          {data && <Pager page={Math.floor(offset / SIZE)} size={SIZE} total={data.total} onPage={(p) => setOffset(p * SIZE)} />}
        </div>)}
    </div>
  );
}
