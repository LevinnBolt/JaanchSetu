import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dmy, inr } from '../api';
import { Days, Empty, Err, Icon, PageHeader, PageSkeleton, Pager, Skeleton, StatusBadge, VerifyBadge, has, promptText, titleCase, toast, useLoad, useMe } from '../ui';
import { CoveragePanel } from '../coverageUi';

const SIZE = 15;
const Tile = ({ label, value, icon, alarm }: { label: string; value: string | number; icon: string; alarm?: boolean }) => (
  <div className={`card flex items-center gap-3 !p-4 ${alarm ? '!border-red-300' : ''}`}>
    <span className={`rounded-lg p-2.5 ${alarm ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand'}`}><Icon name={icon} size={20} /></span>
    <div><div className="text-xl font-extrabold tabular-nums text-brand">{value}</div><div className="text-xs font-semibold text-stone-500">{t(label)}</div></div>
  </div>
);

/** Wait for the user to stop typing before asking the server. */
function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Institutions() {
  const { id } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => { setPage(1); }, [dq]);
  const list = useLoad(() => (id ? Promise.resolve(null) : api(`/institutions?pageSize=${SIZE}&page=${page}&q=${encodeURIComponent(dq)}`)), [id, page, dq]);
  const one = useLoad(() => (id ? api(`/institutions/${id}`) : Promise.resolve(null)), [id]);
  const cover = useLoad(() => (id ? api(`/coverage/institution/${id}`) : Promise.resolve(null)), [id]);
  const { me } = useMe();
  const setRequirement = async () => {
    const v = await promptText({ title: t('Required security deposit'), label: t('Amount in rupees that this institution must keep as security deposit (leave empty to clear)'), min: 0, confirmText: t('Save') });
    if (v === null) return;
    const n = Number(v.replace(/[^0-9]/g, ''));
    try { await api(`/admin/institutions/${id}`, { method: 'PATCH', body: { requiredDeposit: n > 0 ? n : null } }); toast(t('Required deposit saved.')); cover.reload(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  if (list.error) return <Err msg={list.error} />;

  if (id) {
    if (one.error) return <Err msg={one.error} />;
    if (!one.data) return <PageSkeleton />;
    const i = one.data.institution;
    const shown = one.data.fdrs.length;
    return (
      <div className="space-y-5">
        <Link to="/institutions" className="inline-flex items-center gap-1 text-sm font-semibold text-stone-600 hover:text-brand"><Icon name="chevL" size={15} />{t('All institutions')}</Link>
        <PageHeader title={i?.name} subtitle={`${i?.city}, ${i?.state}`} actions={<Link className="btn-alt" to={`/fdrs?institutionId=${id}`}>{t('Open in the FDR list')}</Link>} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Deposits held" value={i?.heldCount ?? 0} icon="layers" />
          <Tile label="Total deposit value" value={inr(i?.totalDeposit)} icon="bank" />
          <Tile label="FDRs on record" value={one.data.totalFdrs ?? shown} icon="file" />
          <Tile label="Open discrepancies" value={i?.openDiscrepancies ?? 0} icon="scan" alarm={(i?.openDiscrepancies ?? 0) > 0} />
        </div>
        {cover.data && <CoveragePanel c={cover.data} onEdit={has(me, 'ADMIN') ? setRequirement : undefined} />}
        {shown === 0 ? <Empty>{t('This institution has no FDRs yet.')}</Empty> : (
          <div className="card overflow-hidden !p-0"><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>{t('FDR')}</th><th>{t('Bank')}</th><th className="text-right">{t('Amount')}</th><th>{t('Matures')}</th><th>{t('Time left')}</th><th>{t('Status')}</th><th>{t('Verification')}</th></tr></thead>
            <tbody>{one.data.fdrs.map((r: any) => <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/fdrs/${r.id}`)}><td><Link className="font-bold text-brand hover:underline" to={`/fdrs/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.fdrNumber || 'Draft'}</Link></td><td>{titleCase(r.bank)}</td><td className="text-right tabular-nums">{inr(r.amount)}</td><td>{dmy(r.maturityDate)}</td><td><Days d={r.daysToMaturity} /></td><td><StatusBadge s={r.status} /></td><td><VerifyBadge v={r.verification} /></td></tr>)}</tbody></table></div>
            {(one.data.totalFdrs ?? shown) > shown && <p className="border-t border-stone-100 px-4 py-3 text-sm text-stone-600">{t('Showing the first {n} of {total}.', { n: shown, total: one.data.totalFdrs })} <Link className="font-semibold text-brand underline" to={`/fdrs?institutionId=${id}`}>{t('See them all in the FDR list')}</Link>.</p>}
          </div>)}
      </div>
    );
  }

  const totals = list.data?.totals;
  return (
    <div className="space-y-5">
      <PageHeader title={t('Institution-wise view')} subtitle={t('One row per institution. Open one to see its instruments.')}
        actions={<div className="relative"><Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" /><input aria-label={t('Search institutions')} className="inp !w-64 !pl-8" placeholder={t('Search name, city or state')} value={q} onChange={(e) => setQ(e.target.value)} /></div>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Institutions" value={totals ? totals.institutions.toLocaleString('en-IN') : '…'} icon="building" />
        <Tile label="FDRs on record" value={totals ? totals.fdrs.toLocaleString('en-IN') : '…'} icon="file" />
        <Tile label="Deposit value held" value={totals ? inr(totals.depositHeld) : '…'} icon="bank" />
        <Tile label="Open discrepancies" value={totals ? totals.openDiscrepancies.toLocaleString('en-IN') : '…'} icon="scan" alarm={!!totals && totals.openDiscrepancies > 0} />
      </div>
      {!list.data ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : list.data.total === 0 ? <Empty icon="search">{t('No institution matches “')}{dq}”.</Empty> : (
        <div className="card overflow-hidden !p-0"><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>{t('Institution')}</th><th>{t('State')}</th><th className="text-right">{t('FDRs')}</th><th className="text-right">{t('Held')}</th><th className="text-right">{t('Deposit held')}</th><th>{t('Open flags')}</th></tr></thead>
          <tbody>{list.data.items.map((i: any) => (
            <tr key={i.id} className="cursor-pointer" onClick={() => nav(`/institutions/${i.id}`)}>
              <td><Link className="font-bold text-brand hover:underline" to={`/institutions/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.name}</Link><div className="text-xs text-stone-500">{i.city}</div></td>
              <td>{i.state}</td><td className="text-right tabular-nums">{i.fdrCount}</td><td className="text-right tabular-nums">{i.heldCount}</td><td className="text-right tabular-nums">{inr(i.totalDeposit)}</td>
              <td>{i.openDiscrepancies ? <span className="chip border-red-300 bg-red-50 text-red-800"><Icon name="alert" size={12} />{i.openDiscrepancies} open</span> : <span className="text-stone-400">{t('None')}</span>}</td>
            </tr>))}</tbody></table></div>
          <Pager page={page - 1} size={SIZE} total={list.data.total} onPage={(p) => setPage(p + 1)} />
        </div>)}
    </div>
  );
}
