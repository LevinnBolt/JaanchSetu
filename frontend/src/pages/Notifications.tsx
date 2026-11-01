import { t } from '../i18n';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt } from '../api';
import { Empty, Err, Icon, PageHeader, Skeleton, useLoad } from '../ui';

const KIND: Record<string, { icon: string; tone: string }> = {
  REMINDER: { icon: 'clock', tone: 'bg-amber-50 text-amber-700' },
  ESCALATION: { icon: 'alert', tone: 'bg-red-50 text-red-700' },
  RELEASE: { icon: 'unlock', tone: 'bg-violet-50 text-violet-700' },
  DISCREPANCY: { icon: 'scan', tone: 'bg-red-50 text-red-700' },
};

export default function Notifications({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useLoad(() => api('/notifications'), []);
  const [only, setOnly] = useState(false);
  const act = async (p: string) => { await api(p, { method: 'POST', body: {} }); reload(); onChange(); };
  const items: any[] = (data?.items || []).filter((n: any) => !only || !n.readAt);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Notification centre')} subtitle={data ? `${data.unread} unread of ${data.items.length}` : 'Loading…'}
        actions={<>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" className="h-4 w-4 accent-brand" checked={only} onChange={(e) => setOnly(e.target.checked)} />{t('Unread only')}</label>
          <button className="btn-alt" onClick={() => act('/notifications/read-all')} disabled={!data?.unread}><Icon name="check" size={15} />{t('Mark all read')}</button>
        </>} />
      <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"><Icon name="info" size={16} className="mt-0.5 shrink-0" />{t('Each notification is also emailed when a mail server is configured. In this local demo, mail is switched off and nothing leaves your machine.')}</p>
      <Err msg={error} />
      {!data && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>}
      {data && items.length === 0 && <Empty icon="bell">{only ? 'Nothing unread. You are all caught up.' : 'No notifications yet. Reminders appear here when an FDR nears maturity. Admins can move the demo date forward to trigger them.'}</Empty>}
      <ul className="space-y-2">{items.map((n: any) => {
        const k = KIND[n.kind] || { icon: 'bell', tone: 'bg-sky-50 text-sky-700' };
        return (
          <li key={n.id} className={`card relative flex gap-4 !p-4 ${n.readAt ? 'opacity-75' : 'border-brand/40'}`}>
            {!n.readAt && <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" aria-label="Unread" />}
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${k.tone}`}><Icon name={k.icon} size={19} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2"><b className="text-stone-900">{n.title}</b><span className="rounded bg-stone-100 px-1.5 text-[10.5px] font-bold uppercase tracking-wide text-stone-600">{n.kind}</span><span className="text-xs text-stone-500">{dt(n.createdAt)}</span></div>
              <p className="mt-0.5 text-sm text-stone-700">{n.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {n.fdrId && <Link className="btn-alt btn-sm" to={`/fdrs/${n.fdrId}`}>{t('Open FDR')}<Icon name="arrow" size={13} /></Link>}
                {n.reminderId && n.acknowledged === false && <button className="btn btn-sm" onClick={() => act(`/reminders/${n.reminderId}/ack`)}>{t('Acknowledge')}</button>}
                {n.acknowledged && <span className="chip border-emerald-300 bg-emerald-50 text-emerald-800"><Icon name="check" size={12} />{t('Acknowledged')}</span>}
                {!n.readAt && <button className="btn-alt btn-sm" onClick={() => act(`/notifications/${n.id}/read`)}>{t('Mark read')}</button>}
              </div>
            </div>
          </li>);
      })}</ul>
    </div>
  );
}
