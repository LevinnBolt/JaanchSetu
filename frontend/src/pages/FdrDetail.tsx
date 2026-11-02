import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dmy, download, dt, getToken, inr } from '../api';
import { t } from '../i18n';
import ResolutionPanel from './ResolutionPanel';
import { Conf, Days, Empty, Err, Icon, PageSkeleton, Prov, Stepper, StatusBadge, Tabs, promptText, statusText, toast, useBank, useLoad, useMe } from '../ui';

const LEVEL = ['Institution', 'Scrutiny officer', 'Approving officer'];
const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase();

function DocViewer({ doc }: { doc: any }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let u = '';
    fetch(`/api/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('Could not load the document'))))
      .then((b) => { u = URL.createObjectURL(b); setUrl(u); })
      .catch((e) => setErr(e.message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [doc.id]);
  return (
    <div className="card sticky top-20 !p-3">
      <div className="mb-2 flex items-center justify-between text-xs"><b className="truncate text-brand">{doc.fileName}</b><span className="text-stone-500">{Math.round(doc.sizeBytes / 1024)} KB</span></div>
      {err ? <Err msg={err} /> : !url ? <div className="skeleton h-72" /> : doc.mimeType === 'application/pdf'
        ? <iframe title={t('FDR document')} src={url} className="h-[480px] w-full rounded border" />
        : <img src={url} alt={`Uploaded FDR document ${doc.fileName}`} className="w-full rounded border border-stone-200" />}
      <p className="mt-2 break-all font-mono text-[10px] text-stone-500">SHA-256 {doc.sha256}</p>
    </div>
  );
}

export default function FdrDetail() {
  const { id } = useParams();
  const { me } = useMe();
  const bank = useBank();
  const nav = useNavigate();
  const { data: d, error, reload } = useLoad(() => api(`/fdrs/${id}`), [id]);
  const audit = useLoad(() => api(`/fdrs/${id}/audit`), [id]);
  const [tab, setTab] = useState('truth');
  const [split, setSplit] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<any>, ok?: string) => {
    setErr(''); setBusy(true);
    try { const r = await fn(); const m = ok || r?.message; if (m) toast(m, r?.status === 'MISMATCH' || r?.status === 'NOT_FOUND' || r?.status === 'SERVICE_UNAVAILABLE' ? 'info' : 'ok'); reload(); audit.reload(); return r; }
    catch (e) { setErr((e as Error).message); toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  const post = (p: string, body?: unknown) => api(p, { method: 'POST', body: body ?? {} });

  if (error) return <Err msg={error} />;
  if (!d) return <PageSkeleton />;
  const f = d.fdr;
  const can = (a: string) => d.actions.includes(a);
  const rows = d.truthTable as any[];
  const n = (k: string) => rows.filter((r) => r[k]).length;
  const bankN = n('bank');
  const openDisc = d.discrepancies.filter((x: any) => x.status === 'OPEN').length;
  const curDoc = d.documents[0];
  const mismatches = rows.reduce((a, r) => a + r.mismatches.length, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link to="/fdrs" className="inline-flex items-center gap-1 text-sm font-semibold text-stone-600 hover:text-brand"><Icon name="arrow" size={14} className="rotate-180" />{t('All FDRs')}</Link>
        <div className="card mt-2 !p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-3"><h1 className="h-page">{t('FDR')} {f.fdrNumber}</h1><StatusBadge s={f.status} /></div>
              <p className="mt-1 text-sm text-stone-600">{f.institution.name}, {f.institution.city}, {f.institution.state}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
              {[['Bank', f.bank], ['Amount', inr(f.amount)], ['Issued', dmy(f.issueDate)], ['Matures', dmy(f.maturityDate)]].map(([k, v]) => (
                <div key={k as string}><div className="lbl !mb-0">{k}</div><div className="font-bold text-brand">{v}</div></div>))}
              <div className="col-span-2 sm:col-span-4 text-right text-sm"><Days d={f.daysToMaturity} /></div>
            </div>
          </div>
          <div className="mt-6 px-1"><Stepper status={f.status} /></div>
          {f.rejectionReason && <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm font-semibold text-red-900">{t('Rejected:')} {f.rejectionReason}</p>}
        </div>
      </div>

      {/* trust summary: the honesty rule made visible */}
      <section className="card !p-0 overflow-hidden" aria-label={t('Verification summary')}>
        <div className="grid divide-y divide-stone-200 md:grid-cols-4 md:divide-x md:divide-y-0">
          {([['EXTRACTED', n('extracted') + rows.filter((r: any) => !r.extracted && r.submitted).length], ['REVIEW', n('review')], ['BANK', bankN]] as const).map(([k, c]) => (
            <div key={k} className="p-4"><Prov kind={k} /><div className="mt-2 text-2xl font-extrabold tabular-nums text-brand">{c}<span className="text-base font-semibold text-stone-400"> {t('/ 9 fields')}</span></div></div>))}
          <div className={`p-4 ${openDisc ? 'bg-red-50' : ''}`}><span className="lbl !mb-1">{t('Open discrepancies')}</span><div className={`text-2xl font-extrabold tabular-nums ${openDisc ? 'text-red-700' : 'text-brand'}`}>{openDisc}</div><div className="text-xs text-stone-600">{mismatches} value mismatch{mismatches === 1 ? '' : 'es'} {t('in the truth table')}</div></div>
        </div>
        <div className={`flex items-start gap-2 border-t px-4 py-2.5 text-sm ${bankN ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-stone-200 bg-stone-50 text-stone-700'}`}>
          <Icon name={bankN ? 'bank' : 'alert'} size={16} className="mt-0.5 shrink-0" />
          {bankN ? <span><b>{bankN} {t('of 9 fields hold a')} {bank.label} value.</b> {bank.simulated ? 'This is a simulator built from seed data; no real bank has confirmed this FDR.' : 'The answer came from the configured bank API.'}</span>
            : <span><b>{t('Not confirmed by any bank source.')}</b> {t('The values read from the document are not proof that this FDR is genuine.')} {can('BANK_CHECK') ? `Use “Check with bank${bank.simulated ? ' (simulation)' : ''}”.` : ''}</span>}
        </div>
      </section>

      {/* actions */}
      {(d.actions.length > 0 || err) && (
        <div className="card flex flex-wrap items-center gap-2 !p-4">
          <b className="mr-1 text-sm text-brand">{t('Actions')}</b>
          {can('SUBMIT') && <button className="btn" disabled={busy} onClick={() => run(() => post(`/fdrs/${id}/submit`), 'Submitted for scrutiny.')}>{t('Submit for scrutiny')}</button>}
          {can('START_SCRUTINY') && <button className="btn" disabled={busy} onClick={() => run(() => post(`/fdrs/${id}/start-scrutiny`), 'Scrutiny started.')}>{t('Start scrutiny')}</button>}
          {can('BANK_CHECK') && <button className="btn-gold" disabled={busy} onClick={() => run(() => post(`/fdrs/${id}/bank-check`))}><Icon name="bank" size={16} />{t('Check with bank')}{bank.simulated ? ' (simulation)' : ''}</button>}
          {can('ACCEPT') && <button className="btn" disabled={busy} onClick={() => run(() => post(`/fdrs/${id}/accept`), 'FDR accepted.')}><Icon name="check" size={16} />{t('Accept FDR')}</button>}
          {can('REQUEST_RENEWAL') && <button className="btn" disabled={busy} onClick={() => run(() => post(`/fdrs/${id}/renewal-request`), 'Renewal requested. Now upload the renewed FDR.')}><Icon name="repeat" size={16} />{t('Request renewal')}</button>}
          {can('UPLOAD_RENEWAL') && <button className="btn" onClick={() => nav(`/fdrs/new?renews=${id}`)}><Icon name="upload" size={16} />{t('Upload renewed FDR')}</button>}
          {can('REQUEST_RELEASE') && <button className="btn-alt" disabled={busy} onClick={async () => { const r = await promptText({ title: t('Request release / refund of this deposit'), label: t('Reason for the release / refund'), min: 5, confirmText: t('Request release / refund') }); if (r) run(() => post(`/fdrs/${id}/release-requests`, { reason: r }), 'Release / refund requested.'); }}><Icon name="unlock" size={16} />{t('Request release / refund')}</button>}
          {can('MANAGE_DISCREPANCIES') && <button className="btn-alt" disabled={busy} onClick={async () => { const r = await promptText({ title: t('Raise a discrepancy'), label: t('Describe the problem'), min: 5, confirmText: t('Raise') }); if (r) run(() => post(`/fdrs/${id}/discrepancies`, { reason: r }), 'Discrepancy raised.'); }}>{t('Raise discrepancy')}</button>}
          {can('REJECT') && <button className="btn-danger" disabled={busy} onClick={async () => { const r = await promptText({ title: t('Reject this FDR'), label: t('Reason for rejection'), min: 5, confirmText: t('Reject FDR'), danger: true }); if (r) run(() => post(`/fdrs/${id}/reject`, { reason: r }), 'FDR rejected.'); }}>{t('Reject')}</button>}
          {can('UPLOAD_DOCUMENT') && (
            <label className="btn-alt cursor-pointer"><Icon name="upload" size={16} />{t('Upload document')}
              <input className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('document', file); run(() => api(`/fdrs/${id}/documents`, { form: fd }), 'Document uploaded and read.'); e.target.value = ''; }} />
            </label>)}
        </div>)}
      <Err msg={err} />

      {d.releaseRequests.map((r: any) => <ReleasePanel key={r.id} r={r} run={run} me={me} />)}

      {['MATURED', 'RENEWAL_PENDING'].includes(f.status) && tab !== 'resolution' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
          <span><b>{t('This deposit has matured and no renewal or release is complete.')}</b> {t('Open the Resolution tab to see what is needed and to act.')}</span>
          <button className="btn-alt btn-sm" onClick={() => setTab('resolution')}>{t('Open Resolution')}</button>
        </div>)}

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'truth', label: 'Truth table' },
        ...(['ACCEPTED', 'EXPIRING_SOON', 'MATURED', 'RENEWAL_PENDING', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED', 'RENEWED', 'RELEASED'].includes(f.status) ? [{ key: 'resolution', label: 'Resolution' }] : []),
        { key: 'disc', label: 'Discrepancies', count: d.discrepancies.length },
        { key: 'docs', label: 'Documents', count: d.documents.length },
        { key: 'rem', label: 'Reminders & escalation', count: d.reminders.filter((r: any) => !r.suppressed).length },
        { key: 'time', label: 'Timeline', count: d.timeline.length },
        { key: 'audit', label: 'Audit trail', count: audit.data?.length },
      ]} />

      {tab === 'resolution' && <ResolutionPanel d={d} stamp={d} reload={() => { reload(); audit.reload(); }} isStaff={!me.roles.every((r: string) => r === 'INSTITUTION')} canOpen={me.roles.includes('INSTITUTION') || me.roles.includes('SCRUTINY')} />}

      {tab === 'truth' && (
        <div className={`grid gap-4 ${split && curDoc ? 'xl:grid-cols-[1fr_380px]' : ''}`}>
          <div className="card !p-0 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 p-4">
              <p className="max-w-2xl text-sm text-stone-700">{t('Each value shows where it came from. Only the amber column is a bank source')}{bank.simulated ? <>{t(', and it is a')} <b>{t('simulation')}</b></> : <> (<b>{bank.label.replace(/^Bank-confirmed \(|\)$/g, '')}</b>)</>}{t('. An officer’s review is recorded as an action and never upgrades a value to bank-confirmed.')}</p>
              {curDoc && <button className="btn-alt btn-sm" onClick={() => setSplit(!split)}><Icon name="eye" size={14} />{split ? 'Hide document' : 'Compare with document'}</button>}
            </div>
            <table className="tbl min-w-[980px]">
              <thead><tr><th>{t('Field')}</th><th><Prov kind="EXTRACTED" small /></th><th><Prov kind="BANK" small /></th><th>{t('Officer review')}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key} className={r.mismatches.length ? 'bg-red-50/40' : ''}>
                  <td className="font-bold text-brand">{r.label}</td>
                  <td>{r.extracted ? <><div className="font-semibold">{r.extracted.display}</div><Conf v={r.extracted.confidence} />{r.submitted && String(r.submitted.display).toLowerCase().replace(/[\s.,]+/g, " ").trim() !== String(r.extracted.display).toLowerCase().replace(/[\s.,]+/g, " ").trim() && <div className="mt-1 text-xs font-semibold text-red-800">{t('Institution entered')}: {r.submitted.display}</div>}</>
                    : r.submitted ? <><div className="font-semibold">{r.submitted.display}</div><div className="text-xs text-stone-500">{t('Not read from the document; entered by the institution')}</div></> : <span className="text-stone-400">{t('Not read')}</span>}</td>
                  <td>{r.bank ? <><div className="font-semibold">{r.bank.display}</div><div className="text-xs text-amber-800">{dt(r.bank.at)}</div></> : <span className="text-stone-400">{t('Not checked')}</span>}</td>
                  <td className="min-w-[300px]">
                    {r.review && <div className="text-sm"><span className="chip border-stone-300 bg-stone-50 text-stone-800">{r.review.action === 'CONFIRMED' ? 'Officer confirmed OCR' : 'Officer corrected'}</span> <b>{r.review.display}</b><div className="text-xs text-stone-500">{r.review.by}, {dt(r.review.at)}{r.review.note ? ` · ${r.review.note}` : ''}</div></div>}
                    {can('REVIEW_FIELDS') && <ReviewButtons row={r} run={run} id={id!} />}
                    {r.mismatches.map((m: string) => <div key={m} className="mt-1.5 flex items-start gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-900"><Icon name="alert" size={12} className="mt-0.5 shrink-0" />{m}</div>)}
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
          {split && curDoc && <DocViewer doc={curDoc} />}
        </div>)}

      {tab === 'disc' && (
        <div className="space-y-3">
          {d.discrepancies.length === 0 ? <Empty icon="check">{t('No discrepancy flags. They appear when the document, a value changed by the institution, or the bank answer disagree.')}</Empty> : d.discrepancies.map((x: any) => (
            <div key={x.id} className={`card !p-4 ${x.status === 'OPEN' ? '!border-red-300' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${x.status === 'OPEN' ? 'border-red-400 bg-red-50 text-red-800' : x.status === 'WAIVED' ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-emerald-400 bg-emerald-50 text-emerald-800'}`}>{x.status === 'OPEN' ? 'Open' : x.status === 'WAIVED' ? 'Waived' : 'Resolved'}</span>
                <b className="capitalize text-brand">{pretty(x.type)}</b>{x.fieldLabel && <span className="text-sm text-stone-500">· {x.fieldLabel}</span>}
              </div>
              <p className="mt-2">{x.reason}</p>
              <p className="mt-1 text-xs text-stone-500">{t('Raised by {who}, {when}', { who: x.raisedBy, when: dt(x.createdAt) })}</p>
              {x.status !== 'OPEN' && <p className="mt-2 rounded bg-stone-50 p-2 text-sm"><b>{x.status === 'WAIVED' ? t('Waived') : t('Resolved')}</b> {t('by {who} on {when}', { who: x.resolvedBy, when: dt(x.resolvedAt) })}: “{x.resolutionNote}”</p>}
              {x.status === 'OPEN' && can('MANAGE_DISCREPANCIES') && (
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-sm" disabled={busy} onClick={async () => { const note = await promptText({ title: t('Resolve discrepancy'), label: t('How was it resolved?'), min: 3, confirmText: t('Mark resolved') }); if (note) run(() => post(`/discrepancies/${x.id}/resolve`, { note }), 'Marked resolved.'); }}>{t('Resolve')}</button>
                  <button className="btn-alt btn-sm" disabled={busy} onClick={async () => { const reason = await promptText({ title: t('Waive discrepancy'), label: t('Written reason for waiving (required)'), min: 10, confirmText: t('Waive with reason') }); if (reason) run(() => post(`/discrepancies/${x.id}/waive`, { reason }), 'Waived with a recorded reason.'); }}>{t('Waive (reason required)')}</button>
                </div>)}
            </div>))}
        </div>)}

      {tab === 'docs' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.documents.length === 0 ? <Empty icon="upload">{t('No document yet. Institution users can upload a PDF, JPG or PNG with “Upload document”. Without one the FDR is flagged “missing document”.')}</Empty> : d.documents.map((x: any) => (
            <div key={x.id} className="card !p-4">
              <div className="flex items-start justify-between gap-2"><button className="text-left font-bold text-brand underline" onClick={() => download(`/documents/${x.id}/download`, x.fileName, true).catch((e) => toast(e.message, 'err'))}>{x.fileName}</button>{x.current && <span className="chip border-emerald-300 bg-emerald-50 text-emerald-800">{t('Current')}</span>}</div>
              <div className="mt-1 text-sm text-stone-600">{x.mimeType} · {Math.round(x.sizeBytes / 1024)} KB · {x.uploadedByName}, {dt(x.uploadedAt)}</div>
              <div className="mt-2 break-all rounded bg-stone-50 p-2 font-mono text-[11px] text-stone-600">SHA-256 {x.sha256}</div>
              <div className="mt-2 text-sm"><b>{t('OCR:')}</b> {pretty(x.ocrStatus)}{x.ocrMeanConfidence !== null && ` · mean confidence ${Math.round(x.ocrMeanConfidence)}%`}<div className="text-xs text-stone-500">{x.ocrNote}</div></div>
            </div>))}
          {curDoc && <div className="lg:col-span-2"><DocViewer doc={curDoc} /></div>}
        </div>)}

      {tab === 'rem' && (
        <div className="space-y-3">
          {d.reminders.length === 0 ? <Empty icon="clock">{t('No reminders yet. They are sent 90, 60, 30 and 7 days before maturity (admins can change this). Ask an admin to jump the demo date to see them fire.')}</Empty> : d.reminders.map((r: any) => (
            <div key={r.id} className="card !p-4">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-brand">{t('{n}-day reminder', { n: r.thresholdDays })}</b>
                {r.suppressed ? <span className="chip border-stone-300 bg-stone-50 text-stone-600">{t('Skipped (a tighter reminder replaced it)')}</span>
                  : r.ackedAt ? <span className="chip border-emerald-300 bg-emerald-50 text-emerald-800">{t('Acknowledged by {who}, {when}', { who: r.ackedByName, when: dt(r.ackedAt) })}</span>
                    : <span className="chip border-red-300 bg-red-50 text-red-800">{t('Not acknowledged · with')} {LEVEL[r.level]}</span>}
              </div>
              {!r.suppressed && (
                <ol className="mt-3 flex flex-wrap items-start gap-2">
                  {LEVEL.map((l, i) => {
                    const ev = r.events.find((e: any) => e.level === i);
                    return (
                      <li key={l} className={`flex-1 min-w-[150px] rounded-lg border p-2 text-xs ${ev ? (i === r.level && !r.ackedAt ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50') : 'border-dashed border-stone-300 text-stone-400'}`}>
                        <b className="block text-sm">{l}</b>{ev ? <>{dt(ev.at)}<br />{ev.note}</> : 'Not reached'}
                      </li>);
                  })}
                </ol>)}
              {!r.suppressed && !r.ackedAt && can('ACK_REMINDERS') && <button className="btn btn-sm mt-3" disabled={busy} onClick={() => run(() => post(`/reminders/${r.id}/ack`), 'Reminder acknowledged.')}>{t('Acknowledge')}</button>}
            </div>))}
        </div>)}

      {tab === 'time' && (
        <div className="card">
          {d.chain.length > 1 && (
            <div className="mb-5">
              <h3 className="h-sec mb-2">{t('Renewal chain')}</h3>
              <div className="flex flex-wrap items-center gap-2">{d.chain.map((c: any, i: number) => (
                <span key={c.id} className="flex items-center gap-2">{i > 0 && <Icon name="arrow" size={16} className="text-stone-400" />}
                  <Link to={`/fdrs/${c.id}`} className={`rounded-lg border px-3 py-2 text-sm ${c.isCurrent ? 'border-brand bg-brand text-white' : 'border-stone-300 bg-white hover:border-brand'}`}><b>{c.fdrNumber}</b><br />{inr(c.amount)} · {t('to')} {dmy(c.maturityDate)}<br />{statusText(c.status)}</Link></span>))}</div>
            </div>)}
          <ol className="relative ml-3 space-y-4 border-l-2 border-stone-200 pl-6">
            {d.timeline.map((tr: any, i: number) => (
              <li key={i} className="relative">
                <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand ring-2 ring-brand/30" />
                <div className="text-xs text-stone-500">{dt(tr.at)}</div>
                <div className="text-sm">{d.chain.length > 1 && <b>{tr.fdrNumber} · </b>}{tr.from && <>{pretty(tr.from)} → </>}<b className="capitalize text-brand">{pretty(tr.to)}</b></div>
                <div className="text-xs text-stone-600">{t('by')} {tr.actor}{tr.note ? ` · ${tr.note}` : ''}</div>
              </li>))}
          </ol>
        </div>)}

      {tab === 'audit' && (
        <div className="card !p-0 overflow-x-auto">
          {!audit.data || audit.data.length === 0 ? <div className="p-6"><Empty icon="lock">{t('No audit entries for this FDR yet.')}</Empty></div> : (
            <table className="tbl"><thead><tr><th>#</th><th>{t('When')}</th><th>{t('Who')}</th><th>{t('Action')}</th></tr></thead>
              <tbody>{audit.data.map((a: any) => <tr key={a.seq}><td>{a.seq}</td><td>{dt(a.at)}</td><td>{a.actor}</td><td className="capitalize">{pretty(a.action)}</td></tr>)}</tbody></table>)}
        </div>)}
    </div>
  );
}

function ReviewButtons({ row, run, id }: any) {
  const post = (body: unknown) => api(`/fdrs/${id}/fields/${row.key}/review`, { method: 'POST', body });
  return (
    <div className="mt-1.5 flex flex-nowrap gap-1 whitespace-nowrap">
      {row.extracted && <button className="btn btn-sm" onClick={() => run(() => post({ action: 'CONFIRM' }), `${row.label}: OCR reading confirmed.`)}><Icon name="check" size={12} />{t('Confirm OCR')}</button>}
      {!row.extracted && row.submitted && <button className="btn-alt btn-sm" onClick={() => run(() => post({ action: 'CORRECT', value: row.submitted.value, note: 'Value entered by the institution checked against the document' }), `${row.label}: institution value kept.`)}>{t('Use institution value')}</button>}
      <button className="btn-alt btn-sm" onClick={async () => { const v = await promptText({ title: `Correct ${row.label}`, label: t('Value as printed on the document'), min: 1, confirmText: t('Save correction') }); if (v) run(() => post({ action: 'CORRECT', value: v }), `${row.label} corrected.`); }}>{t('Correct…')}</button>
    </div>
  );
}

function ReleasePanel({ r, run, me }: any) {
  const [items, setItems] = useState<any[]>(r.checklist);
  const [note, setNote] = useState('');
  const post = (p: string, body: unknown) => api(p, { method: 'POST', body });
  const save = () => api(`/release-requests/${r.id}/checklist`, { method: 'PUT', body: { items: items.map(({ key, ticked, note }) => ({ key, ticked, note })) } });
  const steps = [['Requested', true], ['Maker recommends', r.status !== 'REQUESTED'], ['Checker decides', ['APPROVED', 'REJECTED'].includes(r.status)]] as const;
  return (
    <section className="card !border-2 !border-brand" aria-label={t('Release request')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h-sec flex items-center gap-2"><Icon name="unlock" size={18} />{t('Release / refund request · maker–checker')}</h2>
        <ol className="flex items-center gap-2 text-xs font-bold">{steps.map(([l, done], i) => <li key={l} className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${done ? 'bg-brand text-white' : 'bg-stone-100 text-stone-500'}`}>{i + 1}. {l}</li>)}</ol>
      </div>
      <p className="mt-2 text-sm">{t('Requested by {who} on {when}.', { who: r.requestedByName, when: dt(r.requestedAt) })} <b>{t('Reason:')}</b> {r.reason}</p>
      {r.openDiscrepancies > 0 && <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm font-semibold text-red-900">{t('Release is blocked while')} {r.openDiscrepancies} {t('discrepancy flag(s) are Open.')}</p>}
      <ul className="my-3 space-y-2">{items.map((c, i) => (
        <li key={c.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 p-2.5 text-sm">
          <label className="flex min-w-[260px] flex-1 items-center gap-2 font-semibold"><input type="checkbox" className="h-4 w-4 accent-brand" disabled={!r.canEditChecklist} checked={c.ticked} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, ticked: e.target.checked } : x)))} />{c.label}</label>
          <input aria-label={`Note for ${c.label}`} className="inp !w-full sm:!w-72" placeholder={t('Note (required)')} disabled={!r.canEditChecklist} value={c.note} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
        </li>))}</ul>
      {r.canEditChecklist && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="inp !w-72" aria-label={t('Recommendation note')} placeholder={t('Recommendation note')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-alt" onClick={() => run(save, 'Checklist saved.')}>{t('Save checklist')}</button>
          <button className="btn" onClick={async () => { const ok = await run(save); if (ok) run(() => post(`/release-requests/${r.id}/recommend`, { note: note || 'Recommended' }), 'Release recommended. A different person must now approve it.'); }}>{t('Recommend release (maker)')}</button>
        </div>)}
      {r.recommendBlockedReason && <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm font-semibold text-red-900">{t('You cannot recommend this:')} {r.recommendBlockedReason}</p>}
      {r.makerName && <p className="mt-2 text-sm"><b>{t('Maker:')}</b> {r.makerName} · {dt(r.recommendedAt)} · “{r.makerNote}”</p>}
      {r.status === 'RECOMMENDED' && (
        <div className="mt-3">
          {r.decideBlockedReason && <p role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900"><Icon name="lock" size={16} className="mt-0.5 shrink-0" />{me.name} {t('cannot decide this request:')} {r.decideBlockedReason}</p>}
          {me.roles.includes('APPROVER') && (
            <div className="flex gap-2">
              <button className="btn" disabled={!r.canDecide} onClick={async () => { const x = await promptText({ title: t('Approve release'), label: t('Reason for approving (mandatory)'), min: 5, confirmText: t('Approve release') }); if (x) run(() => post(`/release-requests/${r.id}/decision`, { approve: true, reason: x }), 'Release approved. The FDR is now released.'); }}>{t('Approve (checker)')}</button>
              <button className="btn-danger" disabled={!r.canDecide} onClick={async () => { const x = await promptText({ title: t('Reject release'), label: t('Reason for rejecting (mandatory)'), min: 5, confirmText: t('Reject release'), danger: true }); if (x) run(() => post(`/release-requests/${r.id}/decision`, { approve: false, reason: x }), 'Release rejected.'); }}>{t('Reject (checker)')}</button>
            </div>)}
        </div>)}
      {r.checkerName && <p className="mt-2 text-sm"><b>{t('Checker:')}</b> {r.checkerName} · {dt(r.decidedAt)} · <span className="capitalize">{r.status.toLowerCase()}</span> · “{r.decisionReason}”</p>}
      {r.orderNo && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brand-50 p-3 text-sm">
          <Icon name="shield" size={20} className="text-brand" />
          <span className="min-w-0"><b className="block font-mono text-brand">{r.orderNo}</b><span className="text-xs text-stone-600">{t('Release / refund order. Tied to the audit trail, so anyone can check it with the QR code.')}</span></span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button className="btn btn-sm" onClick={() => download(`/release-orders/${r.orderNo}/pdf`, `${r.orderNo}.pdf`).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={13} />{t('Download order (PDF)')}</button>
            <a className="btn-alt btn-sm" href={`/verify/${r.orderNo}`} target="_blank" rel="noreferrer">{t('Open the public check page')}</a>
          </span>
        </div>)}
    </section>
  );
}
