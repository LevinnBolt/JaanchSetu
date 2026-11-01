import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, dmy, inr } from '../api';
import { t } from '../i18n';
import { CoverageChip, coverageMessage } from '../coverageUi';
import { Days, Empty, Err, Icon, PageSkeleton, Skeleton, StatusBadge, Tabs, has, statusText, useBank, useLoad, useMe } from '../ui';

const CARDS: { k: string; label: string; to: string; icon: string; tone: string; hint: string; staffOnly?: boolean; bank?: boolean }[] = [
  { k: 'totalInstitutions', label: 'Institutions', to: '/institutions', icon: 'building', tone: 'sky', hint: 'On the portal', staffOnly: true },
  { k: 'coverageAtRisk', label: 'Coverage at risk', to: '/reports?report=coverage-gaps', icon: 'shield', tone: 'red', hint: 'Deposit short now or within 90 days', staffOnly: true },
  { k: 'pendingVerification', label: 'Pending verification', to: '/fdrs?bucket=pending', icon: 'eye', tone: 'sky', hint: 'Awaiting a scrutiny decision' },
  { k: 'bankConfirmed', label: 'Bank-confirmed', to: '/fdrs?bucket=bankconfirmed', icon: 'bank', tone: 'amber', hint: 'Checked with the bank', bank: true },
  { k: 'active', label: 'Active', to: '/fdrs?bucket=active', icon: 'layers', tone: 'emerald', hint: 'Accepted and running' },
  { k: 'expiring90', label: 'Expiring in 90 days', to: '/fdrs?bucket=expiring90', icon: 'clock', tone: 'amber', hint: 'Need renewal or release' },
  { k: 'matured', label: 'Matured', to: '/fdrs?bucket=matured', icon: 'alert', tone: 'orange', hint: 'Past maturity date' },
  { k: 'renewalPending', label: 'Renewal pending', to: '/fdrs?bucket=renewal', icon: 'repeat', tone: 'sky', hint: 'Awaiting renewed FDR' },
  { k: 'releasePending', label: 'Release / refund pending', to: '/fdrs?bucket=release', icon: 'unlock', tone: 'violet', hint: 'In maker-checker' },
  { k: 'openDiscrepancies', label: 'Open discrepancies', to: '/fdrs?bucket=discrepancy', icon: 'scan', tone: 'red', hint: 'Flags to resolve or waive' },
  { k: 'overdue', label: 'Overdue (escalated)', to: '/fdrs?bucket=overdue', icon: 'bell', tone: 'red', hint: 'Reminder not acknowledged' },
];
const TONE: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', orange: 'bg-orange-50 text-orange-700',
  sky: 'bg-sky-50 text-sky-700', violet: 'bg-violet-50 text-violet-700', red: 'bg-red-50 text-red-700',
};
const EDGE: Record<string, string> = {
  emerald: 'before:bg-emerald-500', amber: 'before:bg-amber-500', orange: 'before:bg-orange-500', sky: 'before:bg-sky-500', violet: 'before:bg-violet-500', red: 'before:bg-red-500',
};
const PIPELINE = ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED', 'RENEWED', 'RELEASED', 'REJECTED'];
const BAR: Record<string, string> = { DISCREPANCY_RAISED: 'bg-red-500', REJECTED: 'bg-red-400', EXPIRING_SOON: 'bg-amber-500', MATURED: 'bg-orange-500', ACCEPTED: 'bg-emerald-500', RELEASED: 'bg-stone-400', RENEWED: 'bg-stone-400', DRAFT: 'bg-stone-300' };

function QueueList({ items, empty }: { items: any[] | undefined; empty: string }) {
  if (!items || items.length === 0) return <Empty icon="check">{t(empty)}</Empty>;
  return (
    <ul className="divide-y divide-stone-100">
      {items.map((i) => (
        <li key={i.fdrId + i.note}>
          <Link to={`/fdrs/${i.fdrId}`} className="group flex items-center gap-3 rounded-md px-2 py-3 transition hover:bg-brand-50">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><b className="text-brand">{i.fdrNumber}</b><StatusBadge s={i.status} /></div>
              <div className="truncate text-sm text-stone-600">{i.institutionName}</div>
              <div className="text-sm">{i.note}</div>
              {i.blocked && <div className="mt-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-900">{t('You cannot act on this:')} {i.blocked}</div>}
            </div>
            {i.daysToMaturity !== null && <span className="text-xs"><Days d={i.daysToMaturity} /></span>}
            <Icon name="arrow" size={16} className="text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-brand" />
          </Link>
        </li>))}
    </ul>
  );
}

export default function Dashboard() {
  const { me } = useMe();
  const nav = useNavigate();
  const bank = useBank();
  const { data, error } = useLoad(() => api('/dashboard'), []);
  const staff = !(has(me, 'INSTITUTION') && !has(me, 'SCRUTINY', 'APPROVER', 'ADMIN'));
  const impact = useLoad(() => (staff ? api('/dashboard/impact') : Promise.resolve(null)), [staff]);
  const [hover, setHover] = useState<number | null>(null);
  const qs = data?.queues || {};
  const tabsAvail = [
    ...(qs.scrutiny ? [{ key: 'scrutiny', label: 'Needs my scrutiny', count: qs.scrutiny.length }] : []),
    ...(qs.approval ? [{ key: 'approval', label: 'Needs my approval', count: qs.approval.length }] : []),
    { key: 'overdue', label: 'My overdue items', count: qs.overdue?.length ?? 0 },
  ];
  const [tab, setTab] = useState('');
  if (error) return <Err msg={error} />;
  if (!data) return <PageSkeleton />;
  const active = tabsAvail.find((t) => t.key === tab) ? tab : tabsAvail[0].key;
  const max = Math.max(1, ...data.timeline.map((m: any) => m.count));
  const total = Object.values(data.byStatus as Record<string, number>).reduce((a, b) => a + b, 0) || 1;
  const pipeMax = Math.max(1, ...Object.values(data.byStatus as Record<string, number>));
  const first = me.name.split('(')[0].trim();
  const tl: { key: string; label: string; count: number; amount: number }[] = data.timeline;
  const yearAmount = tl.reduce((s, m) => s + m.amount, 0);
  const yearCount = tl.reduce((s, m) => s + m.count, 0);
  const peak = tl.reduce((p, m) => (m.count > p.count ? m : p), tl[0]);
  const soon = tl.slice(0, 3).reduce((s, m) => s + m.count, 0);

  // The single most useful thing for this person to do next.
  const focus: { icon: string; title: string; text: string; to: string; cta: string } | null =
    qs.approval?.length ? { icon: 'check', title: 'Your decision is needed', text: t('{n} release request(s) wait for your approval.', { n: qs.approval.length }), to: `/fdrs/${qs.approval[0].fdrId}`, cta: 'Review the first' }
    : qs.scrutiny?.length ? { icon: 'eye', title: 'Waiting for your scrutiny', text: t('{n} item(s) need review: new submissions, discrepancies or release requests.', { n: qs.scrutiny.length }), to: `/fdrs/${qs.scrutiny[0].fdrId}`, cta: 'Start with the first' }
    : qs.overdue?.length ? { icon: 'bell', title: 'Reminders need an answer', text: t('{n} reminder(s) were not acknowledged and have escalated.', { n: qs.overdue.length }), to: `/fdrs/${qs.overdue[0].fdrId}`, cta: 'Open the first' }
    : has(me, 'INSTITUTION') ? { icon: 'plus', title: 'Add a deposit', text: t('Submit a new FDR with its scanned receipt. The portal reads it and compares.'), to: '/fdrs/new', cta: 'Submit an FDR' }
    : has(me, 'ADMIN') ? { icon: 'clock', title: 'Try the Maturity Radar', text: t('Move the demo date forward to watch reminders and escalations fire.'), to: '/admin', cta: 'Open demo clock' }
    : null;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand via-brand to-brand-700 p-6 text-white shadow-card">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[28px] border-white/5" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm text-brand-100">{dmy(data.today)}</p>
            <h1 className="text-3xl font-extrabold tracking-tight">{t('Namaste,')} {first}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-brand-100">
              {data.cards.overdue > 0 ? t('{n} deposit(s) have escalated reminders.', { n: data.cards.overdue }) : t('No escalated reminders.')}{' '}
              {t('{a} open discrepancy flag(s) across {b} FDRs.', { a: data.cards.openDiscrepancies, b: total })}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {has(me, 'INSTITUTION') && <Link to="/fdrs/new" className="btn-gold"><Icon name="plus" size={16} />{t('Submit FDR')}</Link>}
              <Link to="/fdrs?bucket=expiring90" className="btn-alt !border-white/30 !bg-white/10 !text-white hover:!bg-white/20"><Icon name="clock" size={16} />{t('Maturity radar')}</Link>
              <Link to="/demo" className="btn-alt !border-white/30 !bg-white/10 !text-white hover:!bg-white/20"><Icon name="book" size={16} />{t('Demo guide')}</Link>
            </div>
          </div>
          {focus && (
            <button onClick={() => nav(focus.to)} className="group flex w-full items-center gap-4 rounded-xl border border-gold/50 bg-white/10 p-4 text-left transition hover:bg-white/15 lg:w-[340px]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold text-brand"><Icon name={focus.icon} size={22} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-gold">{t('Next step')}</span>
                <b className="block leading-tight">{t(focus.title)}</b>
                <span className="mt-0.5 block text-[13px] leading-snug text-brand-100">{focus.text}</span>
                <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-gold">{t(focus.cta)}<Icon name="arrow" size={13} className="transition group-hover:translate-x-1" /></span>
              </span>
            </button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.filter((c) => !c.staffOnly || staff).map((c) => {
          const v = c.k === 'coverageAtRisk' ? (data.coverage ? data.coverage.shortfall + data.coverage.atRisk : 0) : data.cards[c.k];
          const alarm = (c.k === 'overdue' || c.k === 'openDiscrepancies' || c.k === 'coverageAtRisk') && v > 0;
          return (
            <Link key={c.k} to={c.to} className={`card group relative overflow-hidden !p-4 transition before:absolute before:inset-x-0 before:top-0 before:h-1 hover:-translate-y-0.5 hover:shadow-pop ${EDGE[c.tone]} ${alarm ? '!border-red-300' : ''}`}>
              <span className={`mb-2 inline-flex rounded-lg p-2 ${TONE[c.tone]}`}><Icon name={c.icon} size={18} /></span>
              <div className="text-3xl font-extrabold tabular-nums text-brand">{(v ?? 0).toLocaleString('en-IN')}</div>
              <div className="text-sm font-bold leading-tight text-stone-800">{c.bank ? (bank.simulated ? t('Bank-confirmed (sim.)') : t('Bank-confirmed')) : t(c.label)}</div>
              <div className="mt-0.5 text-xs text-stone-500">{t(c.hint)}</div>
            </Link>);
        })}
      </div>

      {!staff && data.myCoverage && data.myCoverage.status !== 'NOT_SET' && (
        <Link to={`/institutions/${me.institutionId}`} className={`card flex flex-wrap items-center gap-3 transition hover:shadow-pop ${['SHORTFALL', 'AT_RISK'].includes(data.myCoverage.status) ? '!border-red-300' : ''}`}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand"><Icon name="shield" size={22} /></span>
          <span className="min-w-0 flex-1"><b className="block text-brand">{t('Your deposit cover')}</b><span className="text-sm text-stone-700">{coverageMessage(data.myCoverage)}</span></span>
          <CoverageChip s={data.myCoverage.status} />
        </Link>)}

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <section className="card flex flex-col lg:col-span-2" aria-labelledby="tl">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div><h2 id="tl" className="h-sec">{t('Maturity timeline · next 12 months')}</h2>
              <p className="text-xs text-stone-500">{t('Deposits still held, by maturity month.')} {data.maturedBeforeThisMonth > 0 && t('{n} more matured before this month.',{ n: data.maturedBeforeThisMonth })}</p></div>
            <div className="min-h-[2.5rem] rounded-md bg-brand-50 px-3 py-1.5 text-right text-xs text-brand">
              {hover !== null ? <><b>{tl[hover].label}</b>: {tl[hover].count} {t('FDRs ·')} {inr(tl[hover].amount)}</> : t('Hover a bar for details')}
            </div>
          </div>

          <div className="relative mt-8 pl-7" role="img" aria-label={t('Bar chart of FDR maturities by month')}>
            <div className="relative h-52">
              {[0, 0.5, 1].map((g) => (
                <div key={g} className="absolute inset-x-0 border-t border-dashed border-stone-200" style={{ bottom: `${g * 100}%` }}>
                  <span className="absolute -left-7 -top-2 w-6 pr-1 text-right text-[10px] text-stone-400">{Math.round(max * g)}</span></div>))}
              <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2.5">
                {tl.map((m, i) => (
                  <button key={m.key} className="group relative flex h-full flex-1 items-end outline-offset-2"
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    aria-label={`${m.label}: ${m.count} FDRs, ${inr(m.amount)}`} onClick={() => nav(`/fdrs?maturityFrom=${m.key}-01&maturityTo=${m.key}-31`)}>
                    <span className={`relative block w-full rounded-t-md transition-all ${i === 0 ? 'bg-amber-500' : 'bg-brand group-hover:bg-gold-600'}`}
                      style={{ height: m.count ? `${Math.max(4, (m.count / max) * 100)}%` : '2px', opacity: m.count ? 1 : 0.25 }}>
                      {m.count > 0 && <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold tabular-nums text-brand">{m.count}</span>}
                    </span>
                  </button>))}
              </div>
            </div>
            <div className="mt-1.5 flex gap-1.5 sm:gap-2.5">{tl.map((m) => <span key={m.key} className="flex-1 text-center text-[10.5px] text-stone-600">{m.label}</span>)}</div>
          </div>

          <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 text-sm">
            <div><dt className="text-xs text-stone-500">{t('Maturing in 3 months')}</dt><dd className="text-lg font-extrabold tabular-nums text-brand">{soon} <span className="text-xs font-semibold text-stone-500">{t('FDRs')}</span></dd></div>
            <div><dt className="text-xs text-stone-500">{t('Busiest month')}</dt><dd className="text-lg font-extrabold text-brand">{peak.count ? peak.label : '—'} <span className="text-xs font-semibold text-stone-500">{peak.count ? t('{n} FDRs', { n: peak.count }) : ''}</span></dd></div>
            <div><dt className="text-xs text-stone-500">{t('Value maturing in 12 months')}</dt><dd className="text-lg font-extrabold tabular-nums text-brand">{inr(yearAmount)} <span className="text-xs font-semibold text-stone-500">{t('{n} FDRs', { n: yearCount })}</span></dd></div>
          </dl>
        </section>

        <section className="card" aria-labelledby="pl">
          <h2 id="pl" className="h-sec">{t('Lifecycle pipeline')}</h2>
          <p className="mb-3 text-xs text-stone-500">{t('All {n} deposits by status. Click a row to filter.', { n: total })}</p>
          <ul className="space-y-1.5">
            {PIPELINE.filter((s) => data.byStatus[s]).map((s) => (
              <li key={s}>
                <Link to={`/fdrs?status=${s}`} className="block rounded-md px-1.5 py-1 hover:bg-brand-50">
                  <div className="flex justify-between text-xs"><span className="font-semibold text-stone-700">{statusText(s)}</span><b className="tabular-nums">{data.byStatus[s]}</b></div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${BAR[s] || 'bg-sky-500'}`} style={{ width: `${Math.max(4, (data.byStatus[s] / pipeMax) * 100)}%` }} /></div>
                </Link>
              </li>))}
          </ul>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <section className="card lg:col-span-3">
          <h2 className="h-sec mb-2">{t('Work queues')}</h2>
          <Tabs tabs={tabsAvail} value={active} onChange={setTab} />
          <div className="pt-2">
            {active === 'scrutiny' && <QueueList items={qs.scrutiny} empty="Nothing waiting for scrutiny. New submissions and release requests appear here." />}
            {active === 'approval' && <QueueList items={qs.approval} empty="No release is waiting for approval. Releases recommended by a scrutiny officer appear here." />}
            {active === 'overdue' && <QueueList items={qs.overdue} empty="No unacknowledged reminders. Ask an admin to jump the demo date to see reminders fire." />}
          </div>
        </section>
        <div className="space-y-5 lg:col-span-2">
        <section className="card" aria-labelledby="ra">
          <div className="flex items-center justify-between"><h2 id="ra" className="h-sec">{t('Recent alerts')}</h2><Link to="/notifications" className="text-xs font-semibold text-brand underline">{t('All notifications')}</Link></div>
          {data.recentAlerts.length === 0 ? <Empty icon="bell">{t('No alerts yet. Reminders and escalations appear here.')}</Empty> : (
            <ul className="mt-2 divide-y divide-stone-100">
              {data.recentAlerts.map((a: any) => (
                <li key={a.id}><Link to={a.fdrId ? `/fdrs/${a.fdrId}` : '/notifications'} className="flex items-start gap-2 rounded px-1 py-2 hover:bg-brand-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.unread ? 'bg-red-500' : 'bg-stone-300'}`} aria-label={a.unread ? 'Unread' : 'Read'} />
                  <span className="min-w-0 text-sm"><span className={`block leading-snug ${a.unread ? 'font-semibold text-stone-900' : 'text-stone-700'}`}>{a.title}</span><span className="text-xs text-stone-500">{dmy(a.createdAt)} · {a.kind.toLowerCase()}</span></span></Link></li>))}
            </ul>)}
        </section>
        <section className="card">
          <h2 className="h-sec">{t('Needs attention · maturing within 90 days')}</h2>
          <p className="mb-2 text-xs text-stone-500">{t('Soonest first, including already matured deposits')}</p>
          {data.upcoming.length === 0 ? <Empty icon="clock">{t('No deposit matures in the next 90 days.')}</Empty> : (
            <ul className="divide-y divide-stone-100">
              {data.upcoming.map((u: any) => (
                <li key={u.fdrId}><Link to={`/fdrs/${u.fdrId}`} className="flex items-center justify-between gap-2 rounded px-1 py-2 hover:bg-brand-50">
                  <span className="min-w-0"><b className="block text-sm text-brand">{u.fdrNumber}</b><span className="block truncate text-xs text-stone-500">{u.institutionName}</span></span>
                  <span className="text-right text-xs"><Days d={u.daysToMaturity} /><span className="block text-stone-500">{dmy(u.maturityDate)}</span></span></Link></li>))}
            </ul>)}
        </section>
        </div>
      </div>

      {staff && (
        <section className="card" aria-labelledby="imp">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 id="imp" className="h-sec">{t('Measured impact')}</h2><p className="text-xs text-stone-500">{impact.data?.basis ? t(impact.data.basis) : t('Figures computed from the records in this system.')}</p></div>
          </div>
          {impact.error ? <Err msg={impact.error} /> : !impact.data ? <div className="mt-3 grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div> : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {impact.data.groups.map((g: any) => (
                <div key={g.key} className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-500">{t(g.title)}</h3>
                  <ul className="space-y-3">
                    {g.items.map((i: any) => (
                      <li key={i.label}>
                        <div className="flex items-baseline gap-1"><span className="text-2xl font-extrabold tabular-nums text-brand">{i.value === null ? 'n/a' : Number(i.value).toLocaleString('en-IN')}</span><span className="text-sm font-semibold text-stone-500">{i.value === null ? '' : i.unit}</span></div>
                        <div className="text-sm font-semibold leading-tight text-stone-800">{t(i.label)}</div>
                        <div className="text-xs text-stone-500">{i.note}</div>
                      </li>))}
                  </ul>
                </div>))}
            </div>)}
        </section>)}
    </div>
  );
}
