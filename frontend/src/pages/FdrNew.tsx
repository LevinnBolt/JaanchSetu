import { t } from '../i18n';
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Conf, Err, Icon, PageHeader, Spinner, toast, useBank, useLoad, useMe } from '../ui';

const KEYS = ['fdrNumber', 'bank', 'branch', 'ifsc', 'amount', 'issueDate', 'maturityDate', 'depositorName', 'inFavourOf'] as const;
type Key = (typeof KEYS)[number];
const LABELS: Record<Key, string> = { fdrNumber: 'FDR number', bank: 'Issuing bank', branch: 'Branch', ifsc: 'IFSC', amount: 'Deposit amount (₹)', issueDate: 'Issue date', maturityDate: 'Maturity date', depositorName: 'Depositor name', inFavourOf: 'In favour of / lien' };
const HINT: Partial<Record<Key, string>> = { ifsc: '4 letters, 0, then 6 letters/digits', amount: 'Whole rupees, e.g. 500000', fdrNumber: 'As printed on the receipt' };
const AICTE = 'All India Council for Technical Education';

export default function FdrNew() {
  const { me } = useMe();
  const [sp] = useSearchParams();
  const renews = sp.get('renews') || undefined;
  const [v, setV] = useState<Record<Key, string>>({ fdrNumber: '', bank: '', branch: '', ifsc: '', amount: '', issueDate: '', maturityDate: '', depositorName: me.institutionName || '', inFavourOf: AICTE });
  const [edited, setEdited] = useState<Set<Key>>(new Set());
  const [edit, setEdit] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The scan is read as soon as it is attached. What it reads becomes the values submitted with it.
  const [scan, setScan] = useState<any>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const samples = useLoad(() => api('/demo/samples'), []);
  const bank = useBank();
  const nav = useNavigate();

  const read = async (f: File) => {
    setScan(null); setScanErr(''); setScanBusy(true);
    try {
      const fd = new FormData();
      fd.append('document', f);
      const res = await api('/fdrs/preflight', { form: fd });
      setScan(res);
      // Fill every field the scan could read, except those the person has changed by hand.
      setV((p) => {
        const next = { ...p };
        for (const row of res.fields as any[]) if (row.extracted && !edited.has(row.key)) next[row.key as Key] = row.extracted;
        return next;
      });
    } catch (e) { setScanErr((e as Error).message); }
    setScanBusy(false);
  };

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast(t('That file is larger than 10 MB.'), 'err');
    if (!/\.(pdf|png|jpe?g)$/i.test(f.name)) return toast(t('Only PDF, JPG or PNG files are accepted.'), 'err');
    setFile(f);
    read(f);
  };
  const setField = (k: Key, x: string) => { setV((p) => ({ ...p, [k]: x })); setEdited((p) => new Set(p).add(k)); };
  const missing = KEYS.filter((k) => !v[k].trim());
  const ready = !!file && !scanBusy && missing.length === 0;

  const submit = async (asDraft: boolean) => {
    setError(''); setBusy(true);
    try {
      const f = new FormData();
      Object.entries(v).forEach(([k, x]) => f.append(k, x));
      if (renews) f.append('renewsFdrId', renews);
      if (asDraft) f.append('asDraft', 'true');
      if (file) f.append('document', file);
      const r = await api('/fdrs', { form: f });
      toast(asDraft ? 'Draft saved.' : 'FDR submitted. The document was hashed and read; review the truth table.');
      nav(`/fdrs/${r.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const useSample = async (s: any) => {
    const res = await fetch('/api/demo/samples/' + s.file);
    pick(new File([await res.blob()], s.file, { type: 'image/png' }));
    toast(`Attached the ${s.name} sample.`, 'info');
  };
  const rows: any[] = scan?.fields || [];
  const unread = rows.filter((r) => !r.extracted).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={renews ? 'Upload renewed FDR' : 'Submit a new FDR'} subtitle={renews ? 'This FDR will be linked to the one it renews, so both appear on one timeline.' : 'Attach the scanned receipt. The portal reads it and fills in the details for you.'} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {[['1', 'You upload the scan'], ['2', 'We read it'], ['3', `${bank.simulated ? 'Bank (simulation)' : 'Bank check'} later`]].map(([n, label]) => (
          <div key={n} className="card flex items-center gap-3 !p-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span><div className="text-sm font-semibold text-brand">{t(label)}</div></div>))}
      </div>
      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><b>{t('Honesty rule:')}</b> {t('neither the scan nor OCR proves an FDR is genuine. Only the issuing bank can')}{bank.simulated ? <> ({t('here a labelled simulator')})</> : null}. {t('An officer confirms or corrects every value that was read.')}</p>
      {samples.data && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 !border-gold !bg-gold-100/50 !p-3 text-sm"><b className="text-brand">{t('Demo helper')}</b> {t('attach a generated specimen receipt:')}
          {samples.data.filter((s: any) => s.name === 'matching').map((s: any) => <button key={s.name} className="btn-gold btn-sm" onClick={() => useSample(s)} title={s.note}>{t('Matching sample')}</button>)}
        </div>)}
      <Err msg={error} />
      <form className="card space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready) submit(false); }}>
        <div>
          <span className="lbl">{t('FDR document (PDF, JPG or PNG, max 10 MB)')}</span>
          <div role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-gold-600 bg-gold-100' : file ? 'border-emerald-400 bg-emerald-50' : 'border-stone-300 bg-stone-50 hover:border-gold-600'}`}>
            <Icon name={file ? 'check' : 'upload'} size={30} className={file ? 'text-emerald-700' : 'text-brand'} />
            {file ? <><b>{file.name}</b><span className="text-xs text-stone-600">{Math.round(file.size / 1024)} {t('KB · click to replace')}</span></> : <><b>{t('Drop the scan here, or click to browse')}</b><span className="text-xs text-stone-600">{t('The details are read from it automatically')}</span></>}
          </div>
          <input ref={input} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
        </div>

        {scanBusy && <p className="flex items-center gap-2 text-sm text-stone-700" aria-live="polite"><Spinner size={18} />{t('Reading the scan… this takes a few seconds.')}</p>}
        {scanErr && <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">{scanErr}</p>}

        {scan && !scanBusy && (
          <section aria-live="polite" aria-labelledby="read-h" className="rounded-xl border border-brand/30 bg-brand-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="read-h" className="flex items-center gap-2 font-bold text-brand"><Icon name="scan" size={18} />{t('What the portal read')}</h3>
              <div className="flex gap-2">
                <button type="button" className="btn-alt btn-sm" onClick={() => file && read(file)}><Icon name="repeat" size={13} />{t('Read the scan again')}</button>
                <button type="button" className="btn-alt btn-sm" onClick={() => setEdit(!edit)} aria-expanded={edit}>{edit ? t('Hide editing') : t('Correct a value')}</button>
              </div>
            </div>
            <p className="mt-2 text-sm text-stone-700">{unread >= rows.length ? t('The scan could not be read. Type the values below; an officer will still check them.') : unread ? t('{n} value(s) could not be read. Fill them in below.', { n: unread }) : t('Everything was read. Check that it looks right; OCR can misread.')}</p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {KEYS.map((k) => {
                const row = rows.find((r) => r.key === k);
                const shown = v[k] ? (row?.extracted === v[k] && row?.extractedDisplay ? row.extractedDisplay : v[k]) : '';
                const unreadField = !row?.extracted && !v[k].trim();
                return (
                  <div key={k} className={`rounded-lg border bg-white p-2.5 ${unreadField ? 'border-red-300' : 'border-stone-200'}`}>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-stone-500">{t(LABELS[k])}</dt>
                    {edit || unreadField ? (
                      <input id={k} className="inp mt-1" required type={k.endsWith('Date') ? 'date' : 'text'} value={v[k]} onChange={(e) => setField(k, e.target.value)} aria-label={t(LABELS[k])} />
                    ) : (
                      <dd className="mt-0.5 font-semibold text-stone-900">{shown || '—'}{row?.extracted === v[k] && !edited.has(k) && <div className="mt-1"><Conf v={row.confidence} /></div>}{edited.has(k) && <span className="ml-2 chip border-sky-300 bg-sky-50 text-sky-800">{t('edited by you')}</span>}</dd>)}
                    {HINT[k] && (edit || unreadField) && <p className="mt-0.5 text-xs text-stone-500">{t(HINT[k] as string)}</p>}
                  </div>);
              })}
            </dl>
            {scan.warnings?.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <b>{t('An officer would be asked to look at:')}</b>
                <ul className="mt-1 list-disc space-y-1 pl-5">{scan.warnings.map((w: any, i: number) => <li key={i}>{w.reason}</li>)}</ul>
              </div>)}
            <p className="mt-2 text-xs text-stone-600">{t('The values read from your scan are submitted as yours. Nothing is submitted until you press the button below.')}</p>
          </section>)}

        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy || !ready} type="submit">{busy ? 'Hashing and reading the document…' : <>{t('Submit for scrutiny')} <Icon name="arrow" size={16} /></>}</button>
          <button className="btn-alt" disabled={busy || !ready} type="button" onClick={() => submit(true)}>{t('Save as draft')}</button>
          {!file && <span className="self-center text-xs text-stone-500">{t('Attach the scan to continue.')}</span>}
        </div>
      </form>
    </div>
  );
}
