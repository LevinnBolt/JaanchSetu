import { t } from '../i18n';
import { FormEvent, useEffect, useState } from 'react';
import { api, dmy, dt } from '../api';
import { Avatar, Empty, Err, Icon, Ok, PageHeader, Pager, RoleChip, ROLE_LABEL, Skeleton, Spinner, Tabs, toast, useLoad } from '../ui';

const SIZE = 10;
const ROLES = ['INSTITUTION', 'SCRUTINY', 'APPROVER', 'ADMIN'];

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// ------------------------------------------------------------------ clock and reminder rules
function RadarTab({ onClock }: { onClock: () => void }) {
  const s = useLoad(() => api('/admin/settings'), []);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [days, setDays] = useState('');
  const [esc, setEsc] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s.data) { setDays(s.data.reminderDays.join(',')); setEsc(String(s.data.escalationDays)); } }, [s.data]);
  const run = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    setErr(''); setMsg(''); setBusy(true);
    try { const r = await fn(); setMsg(ok(r)); s.reload(); onClock(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  if (!s.data) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  const today = s.data.clock.today as string;
  const shifted = !!s.data.clock.isShifted;
  const jump = (n: number) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const setClock = (d: string | null) => run(() => api('/admin/clock', { method: 'PUT', body: { date: d } }), (r) => `Demo date is now ${dmy(r.clock.today)}. Radar: ${r.radar.statusChanges} status changes, ${r.radar.remindersSent} reminders sent, ${r.radar.escalations} escalations.`);
  return (
    <div className="space-y-5">
      <Err msg={err} /><Ok msg={msg} />
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="h-sec">{t('Demo clock')}</h2>
            <p className="max-w-xl text-sm text-stone-600">{t('Jump forward to see the Maturity Radar fire reminders and escalate. Every change runs the radar straight away. Moving backwards forgets reminders from the “future”. With thousands of FDRs a big jump can take a minute.')}</p>
          </div>
          <div className={`rounded-xl border px-5 py-3 text-center ${shifted ? 'border-gold-600 bg-gold-100' : 'border-stone-200 bg-stone-50'}`}>
            <div className="text-[11px] font-bold uppercase tracking-widest text-stone-600">{shifted ? 'Demo date in use' : 'Real date in use'}</div>
            <div className="text-2xl font-extrabold text-brand">{dmy(today)}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="lbl">{t('Jump forward')}</div>
            <div className="inline-flex overflow-hidden rounded-md border border-brand shadow-sm" role="group" aria-label={t('Jump forward')}>
              {[7, 30, 60, 90].map((n) => <button key={n} disabled={busy} className="border-r border-white/20 bg-brand px-4 py-2 text-sm font-bold text-white transition last:border-r-0 hover:bg-brand-700 disabled:opacity-60" onClick={() => setClock(jump(n))}>+{n}d</button>)}
            </div>
          </div>
          <div>
            <label className="lbl" htmlFor="dd">{t('Or a specific date')}</label>
            <div className="flex gap-2"><input id="dd" type="date" className="inp !w-44" value={date} onChange={(e) => setDate(e.target.value)} />
              <button className="btn-alt" disabled={!date || busy} onClick={() => setClock(date)}>{t('Set date')}</button></div>
          </div>
          <div className="flex gap-2">
            <button className="btn-alt" onClick={() => setClock(null)} disabled={!shifted || busy}><Icon name="repeat" size={15} />{t('Reset to real date')}</button>
            <button className="btn-gold" disabled={busy} onClick={() => run(() => api('/admin/radar/run', { method: 'POST', body: {} }), (r) => `Radar ran: ${r.checked} FDRs, ${r.remindersSent} reminders, ${r.escalations} escalations.`)}>{busy ? <Spinner size={18} /> : <Icon name="zap" size={15} />}{t('Run radar now')}</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="h-sec">{t('Reminder rules')}</h2>
        <p className="text-sm text-stone-600">{t('Only the tightest threshold crossed is sent. Unacknowledged reminders escalate institution → scrutiny officer → approving officer.')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {s.data.reminderDays.map((d: number) => <span key={d} className="chip border-brand/30 bg-brand-50 text-brand !text-sm"><Icon name="bell" size={13} />{d} days before</span>)}
          <span className="chip border-stone-300 bg-white text-stone-700 !text-sm"><Icon name="alert" size={13} />escalate every {s.data.escalationDays} days</span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api('/admin/reminder-rules', { method: 'PUT', body: { days: days.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => x > 0) } }), () => 'Reminder rules saved.'); }}>
            <div className="flex-1"><label className="lbl" htmlFor="rd">{t('Reminder days (comma separated)')}</label><input id="rd" className="inp" placeholder="90,60,30,7" value={days} onChange={(e) => setDays(e.target.value)} /></div>
            <button className="btn" type="submit" disabled={busy}>{t('Save')}</button>
          </form>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api('/admin/escalation', { method: 'PUT', body: { days: parseInt(esc, 10) } }), () => 'Escalation period saved.'); }}>
            <div className="flex-1"><label className="lbl" htmlFor="ed">{t('Escalate after (days)')}</label><input id="ed" className="inp" value={esc} onChange={(e) => setEsc(e.target.value)} /></div>
            <button className="btn" type="submit" disabled={busy}>{t('Save')}</button>
          </form>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ institution picker (searches the server)
function InstitutionPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useLoad(() => (dq.length >= 2 ? api(`/institutions?q=${encodeURIComponent(dq)}&pageSize=6`) : Promise.resolve(null)), [dq]);
  if (value) return <div className="flex items-center gap-2"><span className="chip border-brand/30 bg-brand-50 text-brand !text-sm">{value.name}</span><button type="button" className="text-sm font-semibold text-stone-600 underline" onClick={() => onChange(null)}>{t('Change')}</button></div>;
  return (
    <div className="relative">
      <input className="inp" aria-label={t('Find an institution')} placeholder={t('Type 2+ letters of the institution name')} value={q} onChange={(e) => setQ(e.target.value)} />
      {res.data && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-pop" role="listbox">
          {res.data.items.length === 0 ? <li className="px-3 py-2 text-sm text-stone-500">{t('No match.')}</li> : res.data.items.map((i: any) => (
            <li key={i.id}><button type="button" role="option" aria-selected="false" className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => onChange({ id: i.id, name: i.name })}>{i.name}<span className="block text-xs text-stone-500">{i.city}, {i.state}</span></button></li>))}
        </ul>)}
    </div>
  );
}

// ------------------------------------------------------------------ bulk import of institutions
/** Small CSV reader: quoted fields, commas / semicolons / tabs, first row is the header. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const endRow = () => { row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += c;
  }
  if (cur !== '' || row.length) endRow();
  if (rows.length < 2) return [];
  const alias: Record<string, string> = { institution: 'name', 'institution name': 'name', 'e-mail': 'email', 'email address': 'email' };
  const head = rows[0].map((h) => { const k = h.replace(/^﻿/, '').trim().toLowerCase(); return alias[k] || k; });
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
const CSV_TEMPLATE = 'name,city,state,email,required\nExample Institute of Technology,Pune,Maharashtra,registrar@example-institute.test,1500000\nExample College of Pharmacy,Nagpur,Maharashtra,,\n';
const saveFile = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

function ImportCard({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: { row: number; name: string; reason: string }[]; users: { institution: string; email: string; password: string }[] } | null>(null);
  const rows = parseCsv(text);
  const withEmail = rows.filter((r) => r.email).length;
  const readFile = async (f?: File | null) => { if (!f) return; setResult(null); setErr(''); setText(await f.text()); };
  const run = async () => {
    setErr(''); setResult(null); setBusy(true);
    const total = { created: 0, skipped: [] as { row: number; name: string; reason: string }[], users: [] as { institution: string; email: string; password: string }[] };
    try {
      for (let i = 0; i < rows.length; i += 200) {
        setProgress(`Importing ${Math.min(i + 200, rows.length).toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')}…`);
        const r = await api('/admin/institutions/import', { body: { rows: rows.slice(i, i + 200) } });
        total.created += r.created;
        total.skipped.push(...r.skipped.map((s: any) => ({ ...s, row: s.row + i })));
        total.users.push(...r.users);
      }
      setResult(total);
      toast(`${total.created.toLocaleString('en-IN')} institution(s) imported.`);
      onDone();
    } catch (e) { setErr((e as Error).message); setResult(total.created ? total : null); }
    setBusy(false); setProgress('');
  };
  return (
    <section className="card space-y-3" aria-labelledby="imp-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 id="imp-h" className="h-sec">{t('Import many institutions from a CSV')}</h2>
          <p className="max-w-2xl text-sm text-stone-600">{t('Columns:')} <b>{t('name, city, state')}</b>{t(', an optional')} <b>{t('email')}</b> {t('and an optional')} <b>{t('required')}</b> {t('deposit in rupees. A row with an email also gets an institution login with a temporary password. Institutions that already exist are skipped. Thousands of rows are fine; they are sent in batches.')}</p></div>
        <button className="btn-alt btn-sm" type="button" onClick={() => saveFile('institutions-template.csv', CSV_TEMPLATE)}><Icon name="download" size={13} />{t('Template')}</button>
      </div>
      <Err msg={err} />
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
        <div>
          <label className="lbl" htmlFor="imp-text">{t('Paste CSV rows, or choose a file')}</label>
          <textarea id="imp-text" className="inp min-h-[96px] font-mono text-xs" placeholder={'name,city,state,email\nExample Institute,Pune,Maharashtra,registrar@example.test'} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} />
        </div>
        <div className="space-y-2">
          <input aria-label={t('Choose a CSV file')} type="file" accept=".csv,.txt,text/csv" className="block w-full text-sm" onChange={(e) => readFile(e.target.files?.[0])} />
          <button className="btn w-full" disabled={busy || rows.length === 0} onClick={run} type="button">{busy ? <Spinner size={18} /> : <Icon name="upload" size={16} />}{busy ? progress : rows.length ? `Import ${rows.length.toLocaleString('en-IN')} institution${rows.length === 1 ? '' : 's'}` : 'Import'}</button>
          {rows.length > 0 && !busy && <p className="text-xs text-stone-500">{rows.length.toLocaleString('en-IN')} {t('rows read ·')} {withEmail.toLocaleString('en-IN')} {t('with a login')}</p>}
        </div>
      </div>
      {result && (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <b>{result.created.toLocaleString('en-IN')} imported</b>, {result.skipped.length.toLocaleString('en-IN')} skipped, {result.users.length.toLocaleString('en-IN')} login(s) created.
          {result.users.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="btn btn-sm" type="button" onClick={() => saveFile('institution-logins.csv', 'institution,email,temporary password\n' + result.users.map((u) => [u.institution, u.email, u.password].map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n') + '\n')}><Icon name="download" size={13} />{t('Download login details')}</button>
              <span className="text-xs">{t('Passwords are shown only now and are not stored in readable form. Share them securely; an admin can reset any password later.')}</span>
            </div>)}
          {result.skipped.length > 0 && (
            <details className="mt-2"><summary className="cursor-pointer font-semibold">Why were {result.skipped.length} row(s) skipped?</summary>
              <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs">{result.skipped.slice(0, 50).map((s, i) => <li key={i}>Row {s.row} (<b>{s.name}</b>): {s.reason}</li>)}{result.skipped.length > 50 && <li>…and {result.skipped.length - 50} more</li>}</ul></details>)}
        </div>)}
    </section>
  );
}

// ------------------------------------------------------------------ users and institutions
function UsersTab() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [dq, role]);
  const users = useLoad(() => api(`/admin/users?pageSize=${SIZE}&page=${page}&q=${encodeURIComponent(dq)}&role=${role}`), [dq, role, page]);

  // add institution
  const [inst, setInst] = useState({ name: '', city: '', state: '', required: '' });
  const [instErr, setInstErr] = useState('');
  const [instBusy, setInstBusy] = useState(false);
  const addInstitution = async (e: FormEvent) => {
    e.preventDefault(); setInstErr(''); setInstBusy(true);
    try { const need = Number(inst.required.replace(/[^0-9]/g, '')); const r = await api('/admin/institutions', { body: { name: inst.name, city: inst.city, state: inst.state, ...(need > 0 ? { requiredDeposit: need } : {}) } }); toast(`Institution “${r.name}” added.`); setInst({ name: '', city: '', state: '', required: '' }); setNewInst({ id: r.id, name: r.name }); }
    catch (x) { setInstErr((x as Error).message); }
    setInstBusy(false);
  };

  // add user
  const [u, setU] = useState({ name: '', email: '', password: '' });
  const [roles, setRoles] = useState<string[]>(['INSTITUTION']);
  const [newInst, setNewInst] = useState<{ id: string; name: string } | null>(null);
  const [userErr, setUserErr] = useState('');
  const [userBusy, setUserBusy] = useState(false);
  const toggle = (r: string) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  const addUser = async (e: FormEvent) => {
    e.preventDefault(); setUserErr('');
    if (!roles.length) return setUserErr('Choose at least one role.');
    if (roles.includes('INSTITUTION') && !newInst) return setUserErr('Choose the institution this user belongs to.');
    setUserBusy(true);
    try {
      await api('/admin/users', { body: { ...u, roles, institutionId: roles.includes('INSTITUTION') ? newInst!.id : undefined } });
      toast(`User ${u.email} created. Share the password with them securely.`);
      setU({ name: '', email: '', password: '' }); users.reload();
    } catch (x) { setUserErr((x as Error).message); }
    setUserBusy(false);
  };

  // reset password / deactivate
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const act = async (id: string, body: object, ok: string) => {
    try { await api(`/admin/users/${id}`, { method: 'PATCH', body }); toast(ok); setResetFor(null); setPw(''); users.reload(); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div className="space-y-5">
      <ImportCard onDone={() => users.reload()} />

      <div className="grid gap-5 lg:grid-cols-2">
        <form className="card space-y-3" onSubmit={addInstitution}>
          <h2 className="h-sec">{t('Add an institution')}</h2>
          <Err msg={instErr} />
          <div><label className="lbl" htmlFor="in-name">{t('Name')}</label><input id="in-name" className="inp" required minLength={3} value={inst.name} onChange={(e) => setInst({ ...inst, name: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl" htmlFor="in-city">{t('City')}</label><input id="in-city" className="inp" required value={inst.city} onChange={(e) => setInst({ ...inst, city: e.target.value })} /></div>
            <div><label className="lbl" htmlFor="in-state">{t('State')}</label><input id="in-state" className="inp" required value={inst.state} onChange={(e) => setInst({ ...inst, state: e.target.value })} /></div>
          </div>
          <div><label className="lbl" htmlFor="in-req">{t('Required security deposit (₹, optional)')}</label><input id="in-req" className="inp" inputMode="numeric" placeholder="e.g. 1500000" value={inst.required} onChange={(e) => setInst({ ...inst, required: e.target.value })} /></div>
          <button className="btn" disabled={instBusy}>{instBusy ? <Spinner size={18} /> : <Icon name="plus" size={16} />}Add institution</button>
        </form>

        <form className="card space-y-3" onSubmit={addUser}>
          <h2 className="h-sec">{t('Add a user')}</h2>
          <Err msg={userErr} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl" htmlFor="u-name">{t('Full name')}</label><input id="u-name" className="inp" required minLength={2} value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></div>
            <div><label className="lbl" htmlFor="u-email">{t('Email')}</label><input id="u-email" type="email" className="inp" required value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} autoComplete="off" /></div>
          </div>
          <div><label className="lbl" htmlFor="u-pw">{t('Temporary password (8+ characters)')}</label><input id="u-pw" type="password" className="inp" required minLength={8} value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} autoComplete="new-password" /></div>
          <fieldset><legend className="lbl">{t('Roles')}</legend>
            <div className="flex flex-wrap gap-2">{ROLES.map((r) => (
              <label key={r} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${roles.includes(r) ? 'border-brand bg-brand-50 text-brand' : 'border-stone-300 text-stone-600'}`}>
                <input type="checkbox" className="accent-brand" checked={roles.includes(r)} onChange={() => toggle(r)} />{ROLE_LABEL[r]}</label>))}</div>
          </fieldset>
          {roles.includes('INSTITUTION') && <div><span className="lbl">{t('Institution')}</span><InstitutionPicker value={newInst} onChange={setNewInst} /></div>}
          <button className="btn" disabled={userBusy}>{userBusy ? <Spinner size={18} /> : <Icon name="plus" size={16} />}Create user</button>
        </form>
      </div>

      <section className="card overflow-hidden !p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div><h2 className="h-sec">{t('Users')}</h2><p className="text-xs text-stone-500">{users.data ? `${users.data.counts.all.toLocaleString('en-IN')} accounts · ${users.data.counts.staff} staff, ${users.data.counts.institution.toLocaleString('en-IN')} institution` : 'Loading…'}</p></div>
          <div className="flex flex-wrap gap-2">
            <div className="relative"><Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" /><input aria-label={t('Search users')} className="inp !w-56 !pl-8" placeholder={t('Search users')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select aria-label={t('Filter by role')} className="inp !w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="">{t('All roles')}</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
        </div>
        <Err msg={users.error} />
        {!users.data ? <div className="space-y-2 p-5 pt-0">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : users.data.total === 0 ? <div className="p-5 pt-0"><Empty icon="search">{t('No user matches.')}</Empty></div> : (
          <>
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>{t('User')}</th><th>{t('Roles')}</th><th>{t('Institution')}</th><th className="text-right">{t('Access')}</th></tr></thead>
              <tbody>{users.data.items.map((x: any) => (
                <tr key={x.id} className={x.active ? '' : 'opacity-60'}>
                  <td><div className="flex items-center gap-3"><Avatar name={x.name} className="!h-8 !w-8" /><div><b className="block text-stone-900">{x.name}</b><span className="text-xs text-stone-500">{x.email}</span></div></div></td>
                  <td><span className="flex flex-wrap gap-1">{x.roles.map((r: string) => <RoleChip key={r} role={r} />)}</span></td>
                  <td className="text-stone-600">{x.institutionName || '—'}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      {resetFor === x.id ? (
                        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); act(x.id, { password: pw }, `Password reset for ${x.name}.`); }}>
                          <input type="password" aria-label={`New password for ${x.name}`} className="inp !w-40 !py-1" placeholder={t('New password')} minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
                          <button className="btn btn-sm" type="submit">{t('Save')}</button><button className="btn-alt btn-sm" type="button" onClick={() => { setResetFor(null); setPw(''); }}>{t('Cancel')}</button>
                        </form>) : <button className="whitespace-nowrap text-xs font-semibold text-brand underline" onClick={() => { setResetFor(x.id); setPw(''); }}>{t('Reset password')}</button>}
                      <button role="switch" aria-checked={x.active} aria-label={`${x.active ? 'Deactivate' : 'Activate'} ${x.name}`} onClick={() => act(x.id, { active: !x.active }, `${x.name} is now ${x.active ? 'inactive' : 'active'}.`)} className="inline-flex items-center gap-2 text-xs font-semibold text-stone-600">
                        <span className={`relative h-6 w-11 rounded-full transition ${x.active ? 'bg-emerald-500' : 'bg-stone-300'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${x.active ? 'left-[22px]' : 'left-0.5'}`} /></span>
                        <span className="w-14 text-left">{x.active ? 'Active' : 'Inactive'}</span>
                      </button>
                    </div>
                  </td>
                </tr>))}</tbody>
            </table></div>
            <Pager page={page - 1} size={SIZE} total={users.data.total} onPage={(p) => setPage(p + 1)} />
          </>)}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ email outbox
const MAIL_TONE: Record<string, string> = { SENT: 'border-emerald-300 bg-emerald-50 text-emerald-800', RECORDED: 'border-sky-300 bg-sky-50 text-sky-800', FAILED: 'border-red-300 bg-red-50 text-red-800' };
function EmailTab() {
  const mail = useLoad(() => api('/admin/emails?limit=100'), []);
  const d = mail.data;
  return (
    <section className="card overflow-hidden !p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="max-w-2xl">
          <h2 className="h-sec">{t('Email outbox')}</h2>
          <p className="text-sm text-stone-600">{t('Every reminder and escalation email the system tries to send is kept here, so nothing is lost even with no mail server.')} {d && (d.mailEnabled ? 'A mail server is configured: emails marked Sent were accepted by it.' : 'Mail sending is switched off (MAIL_DISABLED=true), so emails are recorded here only.')}</p>
        </div>
        <div className="flex items-center gap-2">
          {d && Object.entries(d.counts as Record<string, number>).map(([k, v]) => <span key={k} className={`chip ${MAIL_TONE[k] || ''}`}>{k.toLowerCase()} {v.toLocaleString('en-IN')}</span>)}
          <button className="btn-alt btn-sm" onClick={() => mail.reload()}><Icon name="repeat" size={13} />{t('Refresh')}</button>
        </div>
      </div>
      <Err msg={mail.error} />
      {!d ? <div className="space-y-2 p-5 pt-0">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : d.items.length === 0 ? <div className="p-5 pt-0"><Empty icon="mail">{t('No emails yet. Move the demo date forward on the Clock & rules tab and reminders will appear here.')}</Empty></div> : (
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>{t('When')}</th><th>{t('To')}</th><th>{t('Subject')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>{d.items.map((e: any) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-stone-600">{dt(e.createdAt)}</td>
              <td className="text-stone-700">{e.to}</td>
              <td><b className="text-stone-900">{e.subject}</b><details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-stone-500 hover:text-brand">{t('read the message')}</summary><pre className="mt-1 max-w-xl whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs text-stone-700">{e.body}</pre></details>{e.error && <div className="mt-1 text-xs text-red-700">{e.error}</div>}</td>
              <td><span className={`chip ${MAIL_TONE[e.status] || ''}`}>{e.status.toLowerCase()}</span></td>
            </tr>))}</tbody>
        </table></div>)}
    </section>
  );
}

export default function Admin({ onClock }: { onClock: () => void }) {
  const [tab, setTab] = useState('radar');
  return (
    <div className="space-y-5">
      <PageHeader title={t('Admin & demo clock')} subtitle={t('Reminder rules, the demo clock, users and institutions, and the email outbox.')} />
      <Tabs tabs={[{ key: 'radar', label: 'Clock & rules' }, { key: 'users', label: 'Users & institutions' }, { key: 'mail', label: 'Email outbox' }]} value={tab} onChange={setTab} />
      {tab === 'radar' && <RadarTab onClock={onClock} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'mail' && <EmailTab />}
    </div>
  );
}
