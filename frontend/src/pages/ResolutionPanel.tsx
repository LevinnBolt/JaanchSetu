import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dmy, dt, inr } from '../api';
import { t } from '../i18n';
import { Empty, Err, Icon, Spinner, promptText, toast, useLoad, useBank } from '../ui';

const post = (p: string, body?: unknown) => api(p, { method: 'POST', body: body ?? {} });

const STATE_TEXT: Record<string, string> = {
  OPEN: 'Open', EVIDENCE_PENDING: 'Evidence pending', VERIFICATION_PENDING: 'Verification pending', APPROVAL_PENDING: 'Waiting for approval',
  APPROVED: 'Approved', EXECUTION_PENDING: 'Ready to complete', COMPLETED: 'Completed', REJECTED: 'Rejected', BLOCKED: 'Blocked', CANCELLED: 'Cancelled',
};
const STATE_TONE: Record<string, string> = {
  OPEN: 'bg-sky-50 text-sky-800 border-sky-300', EVIDENCE_PENDING: 'bg-sky-50 text-sky-800 border-sky-300', VERIFICATION_PENDING: 'bg-amber-50 text-amber-900 border-amber-300',
  APPROVAL_PENDING: 'bg-violet-50 text-violet-800 border-violet-300', APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-300', EXECUTION_PENDING: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  COMPLETED: 'bg-emerald-100 text-emerald-900 border-emerald-400', REJECTED: 'bg-red-50 text-red-800 border-red-300', BLOCKED: 'bg-red-50 text-red-800 border-red-300', CANCELLED: 'bg-stone-100 text-stone-700 border-stone-300',
};
const STEPS = ['OPEN', 'EVIDENCE_PENDING', 'VERIFICATION_PENDING', 'APPROVAL_PENDING', 'EXECUTION_PENDING', 'COMPLETED'];
const STEP_LABEL: Record<string, string> = { OPEN: 'Opened', EVIDENCE_PENDING: 'Evidence', VERIFICATION_PENDING: 'Verified', APPROVAL_PENDING: 'Approval', EXECUTION_PENDING: 'Execution', COMPLETED: 'Completed' };
const EVENT_TEXT: Record<string, string> = {
  CASE_OPENED: 'Case opened', EVIDENCE_STARTED: 'Evidence started', EVIDENCE_ADDED: 'Evidence added', SUBMITTED_FOR_VERIFICATION: 'Submitted for verification', BLOCKED: 'Blocked by a check',
  VERIFIED: 'Verification passed', APPROVED: 'Approved by the checker', REJECTED: 'Rejected by the checker', READY_FOR_EXECUTION: 'Ready to complete', COMPLETED: 'Completed',
  ESCALATED: 'Escalated', CANCELLED: 'Cancelled', REOPENED: 'Reopened',
};

export const stateText = (s: string) => t(STATE_TEXT[s] || s);

const StateChip = ({ s }: { s: string }) => <span className={`chip whitespace-nowrap ${STATE_TONE[s] || ''}`}>{stateText(s)}</span>;

function CaseStepper({ state }: { state: string }) {
  const idx = state === 'APPROVED' ? 4 : STEPS.indexOf(state);
  const dead = ['REJECTED', 'CANCELLED'].includes(state);
  const blocked = state === 'BLOCKED';
  return (
    <ol className="flex items-center" aria-label={t('Case progress')}>
      {STEPS.map((s, i) => {
        const done = !dead && !blocked && idx >= i;
        return (
          <li key={s} className="flex flex-1 items-center">
            <span className="flex flex-col items-center gap-1">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-brand text-white' : 'border border-stone-300 bg-white text-stone-400'}`}>{done ? <Icon name="check" size={13} /> : i + 1}</span>
              <span className={`text-[10.5px] font-semibold ${done ? 'text-brand' : 'text-stone-400'}`}>{t(STEP_LABEL[s])}</span>
            </span>
            {i < STEPS.length - 1 && <span className={`mx-1 mb-4 h-px flex-1 ${done && idx > i ? 'bg-brand' : 'bg-stone-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function CaseCard({ c, act, busy }: { c: any; act: (fn: () => Promise<any>, ok: string) => void; busy: boolean }) {
  const [kind, setKind] = useState('NOTE');
  const [note, setNote] = useState('');
  const asked = async (title: string, label: string, confirmText: string, danger = false, min = 5) => promptText({ title: t(title), label: t(label), min, confirmText: t(confirmText), danger });
  return (
    <section className={`card ${['REJECTED', 'CANCELLED'].includes(c.state) ? 'opacity-80' : '!border-2 !border-brand'}`} aria-label={c.caseNo}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="h-sec flex items-center gap-2"><Icon name={c.type === 'RENEWAL' ? 'repeat' : 'unlock'} size={18} />{c.type === 'RENEWAL' ? t('Renewal case') : t('Release case')} <span className="font-mono text-xs font-semibold text-stone-500">{c.caseNo}</span></h3>
        <span className="flex items-center gap-2"><StateChip s={c.state} />{c.escalationLevel > 0 && <span className="chip border-red-300 bg-red-50 text-red-800">{t('Escalated')} · {c.escalationLevel}</span>}</span>
      </div>
      <div className="mt-4"><CaseStepper state={c.state} /></div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-bold uppercase text-stone-500">{t('Reason')}</dt><dd>{c.delayReason}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-stone-500">{t('Assigned officer')}</dt><dd>{c.assignedToName || <span className="text-stone-500">{t('Not assigned')}</span>}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-stone-500">{t('Due date')}</dt><dd>{c.dueDate ? <>{dmy(c.dueDate)}{c.overdue && <span className="ml-2 chip border-red-300 bg-red-50 text-red-800">{t('Deadline missed')}</span>}</> : <span className="text-stone-500">{t('No deadline set')}</span>}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-stone-500">{t('Opened by')}</dt><dd>{c.openedByName}, {dt(c.createdAt)}</dd></div>
      </dl>

      {c.blockedReasons?.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <b>{t('This case is blocked:')}</b>
          <ul className="mt-1 list-disc pl-5">{c.blockedReasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
        </div>)}

      <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-stone-500">{t('Evidence checklist')}</h4>
      <ul className="mt-2 space-y-1.5">
        {c.checks.map((k: any) => (
          <li key={k.key} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${k.pass ? 'bg-emerald-100 text-emerald-700' : k.blocking ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}><Icon name={k.pass ? 'check' : 'alert'} size={12} /></span>
            <span><b>{t(k.label)}</b>{!k.blocking && !k.pass && <span className="ml-2 chip border-amber-300 bg-amber-50 text-amber-900">{t('not required by policy')}</span>}<br /><span className="text-stone-600">{t(k.detail)}</span></span>
          </li>))}
        {c.type === 'RENEWAL' && (
          <li className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${c.state === 'COMPLETED' || c.renewedFdr ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}><Icon name={c.renewedFdr ? 'check' : 'clock'} size={12} /></span>
            <span><b>{t('Renewed FDR linked and accepted')}</b><br /><span className="text-stone-600">{c.renewedFdr ? <>{t('Renewed FDR')} <Link className="font-semibold text-brand underline" to={`/fdrs/${c.renewedFdr.id}`}>{c.renewedFdr.fdrNumber}</Link> ({c.renewedFdr.status})</> : t('Needed to complete. Upload the renewed FDR after requesting renewal; scrutiny accepts it.')}</span></span>
          </li>)}
        {c.type === 'RELEASE' && (
          <li className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${c.orderNo ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}><Icon name={c.orderNo ? 'check' : 'clock'} size={12} /></span>
            <span><b>{t('Release order issued and acknowledged')}</b><br /><span className="text-stone-600">{c.orderNo ? <>{t('Order')} <Link className="font-mono font-semibold text-brand underline" to={`/verify/${c.orderNo}`}>{c.orderNo}</Link></> : t('Needed to complete. The release goes through the release request (maker–checker) below, which issues the order.')}{c.acknowledgment && <> · {t('Acknowledgement')}: “{c.acknowledgment}”</>}</span></span>
          </li>)}
      </ul>

      {c.evidence.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-stone-50 p-3 text-sm">
          {c.evidence.map((e: any) => <li key={e.id}><b>{t(e.kind.replace(/_/g, ' ').toLowerCase().replace(/^./, (x: string) => x.toUpperCase()))}</b>: {e.note} <span className="text-xs text-stone-500">· {e.by}, {dt(e.at)}</span></li>)}
        </ul>)}
      {c.can.addEvidence && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim().length < 3) return; act(() => post(`/resolutions/${c.id}/evidence`, { kind, note }), 'Evidence added.'); setNote(''); }}>
          <div><label className="lbl" htmlFor={`k-${c.id}`}>{t('Evidence type')}</label>
            <select id={`k-${c.id}`} className="inp !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
              {[['NOTE', 'Note'], ['BANK_LETTER', 'Bank letter'], ['BOARD_RESOLUTION', 'Board resolution'], ['OTHER', 'Other']].map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </select></div>
          <div className="min-w-[14rem] flex-1"><label className="lbl" htmlFor={`n-${c.id}`}>{t('Describe the evidence')}</label><input id={`n-${c.id}`} className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <button className="btn-alt" type="submit" disabled={busy || note.trim().length < 3}>{t('Add evidence')}</button>
        </form>)}

      <div className="mt-5 flex flex-wrap gap-2">
        {c.can.submit && <button className="btn" disabled={busy} onClick={() => act(() => post(`/resolutions/${c.id}/submit`), 'Checks run.')}>{c.state === 'BLOCKED' ? t('Run checks again') : t('Verify and submit for approval')}</button>}
        {c.can.reopen && <button className="btn-alt" disabled={busy} onClick={() => act(() => post(`/resolutions/${c.id}/reopen`), 'Case reopened.')}>{t('Reopen')}</button>}
        {c.can.approve && <button className="btn" disabled={busy} onClick={async () => { const x = await asked('Approve this case', 'Comment (mandatory)', 'Approve'); if (x) act(() => post(`/resolutions/${c.id}/approve`, { comment: x }), 'Case approved.'); }}>{t('Approve (checker)')}</button>}
        {c.can.reject && <button className="btn-danger" disabled={busy} onClick={async () => { const x = await asked('Reject this case', 'Comment (mandatory)', 'Reject', true); if (x) act(() => post(`/resolutions/${c.id}/reject`, { comment: x }), 'Case rejected.'); }}>{t('Reject (checker)')}</button>}
        {c.can.complete && <button className="btn" disabled={busy} onClick={async () => {
          if (c.type === 'RELEASE') { const x = await asked('Record the release acknowledgement', 'Who confirmed receipt, and how', 'Complete case'); if (x) act(() => post(`/resolutions/${c.id}/complete`, { acknowledgment: x }), 'Case completed.'); }
          else act(() => post(`/resolutions/${c.id}/complete`, {}), 'Case completed.');
        }}>{t('Complete case')}</button>}
        {c.can.escalate && c.escalationLevel < 2 && <button className="btn-alt" disabled={busy} onClick={async () => { const x = await asked('Escalate this case', 'Why is it being escalated?', 'Escalate'); if (x) act(() => post(`/resolutions/${c.id}/escalate`, { reason: x }), 'Case escalated.'); }}>{t('Escalate')}</button>}
        {c.can.cancel && <button className="btn-alt" disabled={busy} onClick={async () => { const x = await asked('Cancel this case', 'Reason for cancelling', 'Cancel case', true); if (x) act(() => post(`/resolutions/${c.id}/cancel`, { reason: x }), 'Case cancelled.'); }}>{t('Cancel case')}</button>}
      </div>
      {c.state === 'APPROVAL_PENDING' && c.can.approveBlockedReason && <p className="mt-2 text-xs text-stone-600">{c.can.approveBlockedReason}</p>}

      {c.approvals.length > 0 && (<>
        <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-stone-500">{t('Approval history')}</h4>
        <ul className="mt-2 space-y-1 text-sm">{c.approvals.map((a: any) => <li key={a.id}><b className={a.decision === 'APPROVED' ? 'text-emerald-800' : 'text-red-800'}>{a.decision === 'APPROVED' ? t('Approved') : t('Rejected')}</b> {t('by')} {a.by} ({a.role}), {dt(a.at)}: “{a.comment}”</li>)}</ul>
      </>)}

      <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-stone-500">{t('Timeline')}</h4>
      <ol className="mt-2 space-y-2 border-l-2 border-stone-200 pl-4">
        {c.events.map((e: any) => (
          <li key={e.id} className="relative text-sm">
            <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
            <b>{t(EVENT_TEXT[e.event] || e.event)}</b>{e.to && e.from !== e.to && <span className="text-stone-500"> → {stateText(e.to)}</span>}
            <div className="text-xs text-stone-500">{e.by} · {dt(e.at)}{e.meta?.reason ? ` · ${e.meta.reason}` : ''}{e.meta?.comment ? ` · “${e.meta.comment}”` : ''}</div>
          </li>))}
      </ol>
    </section>
  );
}

function OpenCase({ fdrId, isStaff, onDone }: { fdrId: string; isStaff: boolean; onDone: () => void }) {
  const officers = useLoad(() => (isStaff ? api('/resolution-officers') : Promise.resolve([])), [isStaff]);
  const [type, setType] = useState<'RENEWAL' | 'RELEASE' | ''>('');
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try { await post(`/fdrs/${fdrId}/resolutions`, { type, delayReason: reason, dueDate: due || undefined, assignedToId: who || undefined }); toast(t('Case opened.')); setType(''); setReason(''); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <h3 className="h-sec">{t('Recommended officer actions')}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {([['RENEWAL', 'repeat', 'Renew', 'Create a renewal case and verify the new deposit evidence.'], ['RELEASE', 'unlock', 'Release', 'Verify completed obligations and request approval.']] as const).map(([k, ic, title, text]) => (
          <button key={k} className={`rounded-xl border-2 p-4 text-left transition hover:border-gold-600 ${type === k ? 'border-brand bg-brand-50' : 'border-stone-200 bg-white'}`} onClick={() => setType(k)} aria-pressed={type === k}>
            <span className="flex items-center gap-2 font-bold text-brand"><Icon name={ic} size={18} />{t(title)}</span>
            <span className="mt-1 block text-[13px] text-stone-600">{t(text)}</span>
          </button>))}
      </div>
      {type && (
        <form className="card mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Err msg={err} />
          <div><label className="lbl" htmlFor="rc-reason">{t('Reason for the delay / why this action')}</label><textarea id="rc-reason" className="inp min-h-[4rem]" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl" htmlFor="rc-due">{t('Due date (optional)')}</label><input id="rc-due" type="date" className="inp" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            {isStaff && <div><label className="lbl" htmlFor="rc-who">{t('Assign to (optional)')}</label>
              <select id="rc-who" className="inp" value={who} onChange={(e) => setWho(e.target.value)}><option value="">{t('Not assigned')}</option>{(officers.data || []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
          </div>
          <button className="btn" type="submit" disabled={busy || reason.trim().length < 5}>{busy ? <><Spinner size={16} />{t('Opening…')}</> : t('Open case')}</button>
        </form>)}
    </div>
  );
}

export default function ResolutionPanel({ d, stamp, reload, isStaff, canOpen }: { d: any; stamp: unknown; reload: () => void; isStaff: boolean; canOpen: boolean }) {
  const f = d.fdr;
  const bank = useBank();
  const mat = useLoad(() => api(`/fdrs/${f.id}/maturity`), [f.id, stamp]);
  const cases = useLoad(() => api(`/fdrs/${f.id}/resolutions`), [f.id, stamp]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr('');
    try { await fn(); toast(t(ok)); reload(); cases.reload(); mat.reload(); } catch (e) { setErr((e as Error).message); toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  if (mat.error || cases.error) return <Err msg={mat.error || cases.error || ''} />;
  if (!mat.data || !cases.data) return <div className="skeleton h-40" />;
  const m = mat.data;
  const bankN = (d.truthTable as any[]).filter((r) => r.bank).length;
  const total = (d.truthTable as any[]).length || 9;
  const list: any[] = cases.data;
  const active = list.find((c) => !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(c.state));
  return (
    <div className="space-y-4">
      <section className="card" aria-label={t('Maturity status')}>
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <div><div className="text-xs font-bold uppercase text-stone-500">{t('Pending action')}</div><div className="mt-1 font-bold text-brand">{m.pendingResolution ? (active ? t('Case in progress') : t('Resolution needed')) : m.matured ? t('Resolved') : t('Not due yet')}</div></div>
          <div><div className="text-xs font-bold uppercase text-stone-500">{m.matured ? t('Past maturity') : t('Time to maturity')}</div><div className={`mt-1 text-2xl font-extrabold ${m.band === 'MATURED_CRITICAL' ? 'text-red-700' : m.band === 'MATURED_LATE' ? 'text-orange-700' : 'text-brand'}`}>{m.matured ? m.daysPastMaturity : m.daysToMaturity}<span className="ml-1 text-sm font-semibold">{t('days')}</span></div></div>
          <div><div className="text-xs font-bold uppercase text-stone-500">{t('Principal')}</div><div className="mt-1 text-2xl font-extrabold text-brand">{f.amount != null ? inr(f.amount) : '—'}</div></div>
          <div><div className="text-xs font-bold uppercase text-stone-500">{bank.simulated ? t('Bank-confirmed (simulation)') : t('Bank-confirmed')}</div><div className="mt-1 text-2xl font-extrabold text-brand">{bankN}/{total}</div></div>
        </div>
        <p className="mt-3 text-xs text-stone-500">{t('Financial status')}: <b>{t(f.status)}</b>. {t('Matured means the date has passed; unresolved means no renewal or release has been completed. The financial status and the resolution case are tracked separately.')}</p>
      </section>

      {bankN < total && m.matured && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>{t('Verification required')}</b><br />
          {t('The uploaded FDR is not yet bank-confirmed ({have}/{total} fields). A resolution case can be opened, but final approval must satisfy the configured verification requirements.', { have: bankN, total })}
          {bank.simulated && <> {t('Bank answers here come from a labelled simulator, not a real bank.')}</>}
        </div>)}

      <Err msg={err} />
      {list.length === 0 && !canOpen && <Empty icon="clock">{m.matured ? t('No resolution case has been opened for this FDR.') : t('A resolution case can be opened once the FDR is accepted and still held.')}</Empty>}
      {!active && m.canOpenCase && canOpen && <OpenCase fdrId={f.id} isStaff={isStaff} onDone={() => { reload(); cases.reload(); mat.reload(); }} />}
      {!active && !m.canOpenCase && list.length === 0 && canOpen && <Empty icon="check">{t('This FDR is already resolved or cannot take a case in its current status.')}</Empty>}
      {list.map((c) => <CaseCard key={c.id} c={c} act={act} busy={busy} />)}
    </div>
  );
}
