import { t } from '../i18n';
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Err, Icon, PageHeader, Prov, toast, useLoad, useMe , useBank } from '../ui';
import PreflightPanel from './PreflightPanel';

const EMPTY = { fdrNumber: '', bank: '', branch: '', ifsc: '', amount: '', issueDate: '', maturityDate: '', depositorName: '', inFavourOf: 'All India Council for Technical Education' };
const LABELS: Record<string, string> = { fdrNumber: 'FDR number', bank: 'Issuing bank', branch: 'Branch', ifsc: 'IFSC', amount: 'Deposit amount (₹)', issueDate: 'Issue date', maturityDate: 'Maturity date', depositorName: 'Depositor name', inFavourOf: 'In favour of / lien holder' };
const HINT: Record<string, string> = { ifsc: '4 letters, 0, then 6 letters/digits', amount: 'Whole rupees, e.g. 500000', fdrNumber: 'As printed on the receipt' };

export default function FdrNew() {
  const { me } = useMe();
  const [sp] = useSearchParams();
  const renews = sp.get('renews') || undefined;
  const [v, setV] = useState({ ...EMPTY, depositorName: me.institutionName || '' });
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // pre-flight: the scan is read as soon as it is attached, before anything is submitted
  const [scan, setScan] = useState<any>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const runPre = async (f: File, values: Record<string, string>) => {
    setScan(null); setScanErr(''); setScanBusy(true);
    try {
      const fd = new FormData();
      Object.entries(values).forEach(([k, x]) => x && fd.append(k, x));
      fd.append('document', f);
      setScan(await api('/fdrs/preflight', { form: fd }));
    } catch (e) { setScanErr((e as Error).message); }
    setScanBusy(false);
  };
  const samples = useLoad(() => api('/demo/samples'), []);
  const bank = useBank();
  const nav = useNavigate();

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast(t('That file is larger than 10 MB.'), 'err');
    if (!/\.(pdf|png|jpe?g)$/i.test(f.name)) return toast(t('Only PDF, JPG or PNG files are accepted.'), 'err');
    setFile(f);
    runPre(f, v);
  };
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
  const fill = async (s: any) => {
    setV({ ...EMPTY, ...s.typed });
    const res = await fetch('/api/demo/samples/' + s.file);
    const picked = new File([await res.blob()], s.file, { type: 'image/png' });
    setFile(picked);
    runPre(picked, { ...EMPTY, ...s.typed });
    toast(`Filled with the ${s.name} sample.`, 'info');
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={renews ? 'Upload renewed FDR' : 'Submit a new FDR'} subtitle={renews ? 'This FDR will be linked to the one it renews, so both appear on one timeline.' : 'Type the values, attach the scan. The system hashes the file, reads it and compares.'} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {[['1', 'You type', 'SUBMITTED'], ['2', 'We read the scan', 'EXTRACTED'], ['3', `${bank.simulated ? 'Bank (simulation)' : 'Bank check'} later`, 'BANK']].map(([n, t, k]) => (
          <div key={n} className="card flex items-center gap-3 !p-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span><div><div className="text-sm font-bold">{t}</div><Prov kind={k as any} small /></div></div>))}
      </div>
      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><b>{t('Honesty rule:')}</b> {t('neither the scan nor OCR proves an FDR is genuine. Only the issuing bank can')}{bank.simulated ? ', and in this prototype that is a simulator.' : ', and the bank check here goes to the configured bank API.'}</p>
      {samples.data && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 !border-gold !bg-gold-100/50 !p-3 text-sm"><b className="text-brand">{t('Demo helper')}</b> {t('fill the form and attach a generated specimen receipt:')}
          {samples.data.map((s: any) => <button key={s.name} className="btn-gold btn-sm" onClick={() => fill(s)} title={s.note}>{s.name === 'matching' ? 'Matching sample' : 'Mismatching sample (triggers flags)'}</button>)}
        </div>)}
      <Err msg={error} />
      <form className="card grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        {Object.keys(EMPTY).map((k) => (
          <div key={k} className={k === 'inFavourOf' || k === 'depositorName' ? 'md:col-span-2' : ''}>
            <label className="lbl" htmlFor={k}>{t(LABELS[k])}</label>
            <input id={k} className="inp" required type={k.endsWith('Date') ? 'date' : 'text'} value={(v as any)[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-describedby={HINT[k] ? `${k}-h` : undefined} />
            {HINT[k] && <p id={`${k}-h`} className="mt-0.5 text-xs text-stone-500">{t(HINT[k])}</p>}
          </div>))}
        <div className="md:col-span-2">
          <span className="lbl">{t('FDR document (PDF, JPG or PNG, max 10 MB)')}</span>
          <div role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${drag ? 'border-gold-600 bg-gold-100' : file ? 'border-emerald-400 bg-emerald-50' : 'border-stone-300 bg-stone-50 hover:border-brand'}`}>
            <Icon name={file ? 'check' : 'upload'} size={26} className={file ? 'text-emerald-700' : 'text-brand'} />
            {file ? <><b>{file.name}</b><span className="text-xs text-stone-600">{Math.round(file.size / 1024)} {t('KB · click to replace')}</span></> : <><b>{t('Drop the scan here, or click to browse')}</b><span className="text-xs text-stone-500">{t('Without a document the FDR is flagged “missing document”.')}</span></>}
          </div>
          <input ref={input} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <PreflightPanel scan={scan} busy={scanBusy} error={scanErr} values={v as unknown as Record<string, string>} labels={LABELS} onUse={(k, x) => setV((p) => ({ ...p, [k]: x }))} onRecheck={() => file && runPre(file, v)} />
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button className="btn" disabled={busy} type="submit">{busy ? 'Hashing and reading the document…' : <>{t('Submit for scrutiny')} <Icon name="arrow" size={16} /></>}</button>
          <button className="btn-alt" disabled={busy} type="button" onClick={() => submit(true)}>{t('Save as draft')}</button>
        </div>
      </form>
    </div>
  );
}
