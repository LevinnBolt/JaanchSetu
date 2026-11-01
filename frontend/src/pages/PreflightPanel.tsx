import { Conf, Icon, Spinner } from '../ui';
import { t } from '../i18n';

type State = 'MATCH' | 'DIFFERENT' | 'NOT_READ' | 'NOT_TYPED';

const norm = (key: string, v: unknown): string => {
  const s = (v ?? '').toString().trim();
  if (!s) return '';
  if (key === 'amount') return s.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (key === 'ifsc' || key === 'fdrNumber') return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key.endsWith('Date')) return s;
  return s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
};
const stateOf = (key: string, typed: string, extracted: string | null): State =>
  !extracted ? 'NOT_READ' : !norm(key, typed) ? 'NOT_TYPED' : norm(key, typed) === norm(key, extracted) ? 'MATCH' : 'DIFFERENT';

const LOOK: Record<State, { label: string; cls: string }> = {
  MATCH: { label: 'Matches the scan', cls: 'border-stone-300 bg-stone-100 text-stone-800' },
  DIFFERENT: { label: 'Different from the scan', cls: 'border-red-300 bg-red-50 text-red-800' },
  NOT_READ: { label: 'Not read from the scan', cls: 'border-stone-300 bg-white text-stone-500' },
  NOT_TYPED: { label: 'Not typed yet', cls: 'border-sky-300 bg-sky-50 text-sky-800' },
};

/**
 * Pre-flight check: what the scan says next to what was typed, BEFORE submitting. The comparison is live (it only
 * needs the one OCR reading). OCR can misread, so this is a hint: the officer still confirms every value.
 */
export default function PreflightPanel({ scan, busy, error, values, labels, onUse, onRecheck }: {
  scan: any | null; busy: boolean; error: string; values: Record<string, string>; labels: Record<string, string>;
  onUse: (key: string, value: string) => void; onRecheck: () => void;
}) {
  if (!scan && !busy && !error) return null;
  const rows = (scan?.fields || []).map((f: any) => ({ ...f, live: stateOf(f.key, values[f.key] ?? '', f.extracted) as State }));
  const diff = rows.filter((r: any) => r.live === 'DIFFERENT').length;
  const unread = rows.filter((r: any) => r.live === 'NOT_READ').length;
  return (
    <section className="rounded-xl border border-brand/30 bg-brand-50/40 p-4 md:col-span-2" aria-live="polite" aria-labelledby="pf-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="pf-h" className="flex items-center gap-2 font-bold text-brand"><Icon name="scan" size={18} />{t('Pre-flight check')}</h3>
        <button type="button" className="btn-alt btn-sm" onClick={onRecheck} disabled={busy}>{busy ? <Spinner size={14} /> : <Icon name="repeat" size={13} />}{t('Read the scan again')}</button>
      </div>
      {busy && <p className="mt-2 flex items-center gap-2 text-sm text-stone-700"><Spinner size={18} />{t('Reading the scan… this takes a few seconds.')}</p>}
      {error && <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">{error}</p>}
      {scan && !busy && (
        <>
          <p className={`mt-2 flex items-start gap-2 text-sm font-semibold ${diff ? 'text-red-800' : 'text-stone-800'}`}>
            <Icon name={diff ? 'alert' : 'info'} size={16} className="mt-0.5 shrink-0" />
            {diff ? t('{n} value(s) you typed differ from the scan. Check them before you submit.', { n: diff }) : unread >= rows.length ? t('The scan could not be read. You can still submit it; an officer will read it.') : t('Everything you typed that could be read matches the scan.')}
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="tbl">
              <thead><tr><th>{t('Field')}</th><th>{t('You typed')}</th><th>{t('The scan reads')}</th><th>{t('Status')}</th><th /></tr></thead>
              <tbody>{rows.map((r: any) => (
                <tr key={r.key} className={r.live === 'DIFFERENT' ? 'bg-red-50/50' : ''}>
                  <td className="font-semibold text-brand">{t(labels[r.key] || r.label)}</td>
                  <td>{values[r.key] || <span className="text-stone-400">—</span>}</td>
                  <td>{r.extractedDisplay ? <><div className="font-semibold">{r.extractedDisplay}</div><Conf v={r.confidence} /></> : <span className="text-stone-400">—</span>}</td>
                  <td><span className={`chip whitespace-nowrap ${LOOK[r.live as State].cls}`}>{t(LOOK[r.live as State].label)}</span></td>
                  <td className="text-right">{(r.live === 'DIFFERENT' || r.live === 'NOT_TYPED') && r.extracted && <button type="button" className="btn-alt btn-sm whitespace-nowrap" onClick={() => onUse(r.key, r.extracted)}>{t('Use the scan\'s value')}</button>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          {scan.warnings?.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <b>{t('An officer would be asked to look at:')}</b>
              <ul className="mt-1 list-disc space-y-1 pl-5">{scan.warnings.map((w: any, i: number) => <li key={i}>{w.reason}</li>)}</ul>
              <p className="mt-1 text-xs text-amber-900">{t('These were worked out from the values when the scan was read. Press “Read the scan again” after you change several values.')}</p>
            </div>)}
          <p className="mt-2 text-xs text-stone-600">{t(scan.disclaimer)}</p>
        </>)}
    </section>
  );
}
