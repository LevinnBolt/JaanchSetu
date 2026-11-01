import { CoinLoader } from './loaders';
import { LANGS, setLang, t, translated, useLang } from './i18n';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, ReactNode } from 'react';

// ---------------------------------------------------------------- auth + data
export interface Me { id: string; email: string; name: string; roles: string[]; institutionId: string | null; institutionName: string | null }
export const AuthCtx = createContext<{ me: Me; reload: () => void; logout: () => void }>(null as any);
export const useMe = () => useContext(AuthCtx);
export const has = (me: Me, ...r: string[]) => me.roles.some((x) => r.includes(x));

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then((d) => live && (setData(d), setError(''))).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

// ---------------------------------------------------------------- icons
const PATHS: Record<string, string> = {
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  building: 'M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4 M9 9v.01 M9 12v.01 M9 15v.01 M9 18v.01',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  book: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  plus: 'M12 5v14 M5 12h14',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  repeat: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  unlock: 'M3 11h18v11H3z M7 11V7a5 5 0 0 1 9.9-1',
  lock: 'M3 11h18v11H3z M7 11V7a5 5 0 0 1 10 0v4',
  layers: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  x: 'M18 6L6 18 M6 6l12 12',
  menu: 'M3 12h18 M3 6h18 M3 18h18',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 12h10',
  bank: 'M3 21h18 M3 10h18 M5 6l7-3 7 3 M4 10v11 M20 10v11 M8 14v3 M12 14v3 M16 14v3',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  chevL: 'M15 18l-6-6 6-6',
  chevR: 'M9 18l6-6-6-6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  chart: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  trash: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
};
export function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {(PATHS[name] || '').split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
    </svg>
  );
}

// ---------------------------------------------------------------- badges
const STATUS_TEXT: Record<string, string> = translated({
  DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_SCRUTINY: 'Under scrutiny', DISCREPANCY_RAISED: 'Discrepancy raised', ACCEPTED: 'Accepted (active)',
  EXPIRING_SOON: 'Expiring soon', MATURED: 'Matured', RENEWAL_PENDING: 'Renewal pending', RENEWED: 'Renewed', RELEASE_REQUESTED: 'Release / refund requested',
  RELEASE_RECOMMENDED: 'Release / refund recommended', RELEASED: 'Released / refunded', REJECTED: 'Rejected',
});
export const statusText = (s: string) => STATUS_TEXT[s] || s;
const STATUS_CLS: Record<string, string> = {
  DISCREPANCY_RAISED: 'bg-red-50 text-red-800 border-red-300', REJECTED: 'bg-red-50 text-red-800 border-red-300',
  EXPIRING_SOON: 'bg-amber-50 text-amber-900 border-amber-300', MATURED: 'bg-orange-50 text-orange-900 border-orange-300',
  ACCEPTED: 'bg-emerald-50 text-emerald-800 border-emerald-300', RELEASED: 'bg-stone-100 text-stone-700 border-stone-300', RENEWED: 'bg-stone-100 text-stone-700 border-stone-300',
  DRAFT: 'bg-stone-100 text-stone-700 border-stone-300',
};
const STATUS_DOT: Record<string, string> = {
  DISCREPANCY_RAISED: 'bg-red-500', REJECTED: 'bg-red-500', EXPIRING_SOON: 'bg-amber-500', MATURED: 'bg-orange-500', ACCEPTED: 'bg-emerald-500',
  RELEASED: 'bg-stone-400', RENEWED: 'bg-stone-400', DRAFT: 'bg-stone-400',
};
export const StatusBadge = ({ s }: { s: string }) => (
  <span className={`chip whitespace-nowrap ${STATUS_CLS[s] || 'bg-sky-50 text-sky-800 border-sky-300'}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s] || 'bg-sky-500'}`} />{STATUS_TEXT[s] || s}
  </span>
);

// How a bank answer is labelled. Default: simulation. The shell sets this from /meta (a bank API may be configured).
let bankInfo = { mode: 'simulation', label: 'Bank-confirmed (simulation)' };
const bankSubs = new Set<() => void>();
export function setBankInfo(b: { mode: string; label: string }) {
  if (b.mode === bankInfo.mode && b.label === bankInfo.label) return;
  bankInfo = { mode: b.mode, label: b.label };
  bankSubs.forEach((f) => f());
}
export function useBank() {
  const b = useSyncExternalStore((f) => { bankSubs.add(f); return () => { bankSubs.delete(f); }; }, () => bankInfo);
  return { ...b, simulated: b.mode === 'simulation', short: b.mode === 'simulation' ? 'simulation' : 'bank API' };
}

/** Provenance is always words + colour. There is deliberately no generic "Verified" badge. */
export const Prov = ({ kind, small }: { kind: 'SUBMITTED' | 'EXTRACTED' | 'BANK'; small?: boolean }) => {
  const bank = useBank();
  const m = {
    SUBMITTED: ['Submitted', 'bg-stone-100 text-stone-800 border-stone-400', 'file'],
    EXTRACTED: ['Extracted (OCR)', 'bg-blue-50 text-blue-900 border-blue-400', 'scan'],
    BANK: [bank.label, 'bg-amber-50 text-amber-900 border-amber-500', 'bank'],
  }[kind];
  return <span className={`chip ${small ? '!px-2 !py-0 text-[10.5px]' : ''} ${m[1]}`}><Icon name={m[2]} size={small ? 11 : 13} />{t(m[0])}</span>;
};

// ---------------------------------------------------------------- colour themes
export const THEMES: { key: string; name: string; brand: string; accent: string }[] = [
  { key: 'navy', name: 'Navy & Saffron', brand: '#14284B', accent: '#FF9933' },
  { key: 'indigo', name: 'Indigo & Amber', brand: '#2D2A6E', accent: '#FFC247' },
  { key: 'maroon', name: 'Maroon & Gold', brand: '#5E1633', accent: '#E8B84B' },
  { key: 'ocean', name: 'Ocean & Coral', brand: '#0B4F6C', accent: '#FF7A59' },
];
const readTheme = () => { try { return localStorage.getItem('jaanchsetu_theme') || 'navy'; } catch { return 'navy'; } };

export function ThemePicker({ className = '' }: { className?: string }) {
  const [cur, setCur] = useState(readTheme);
  const pick = (k: string) => {
    setCur(k);
    document.documentElement.setAttribute('data-theme', k);
    try { localStorage.setItem('jaanchsetu_theme', k); } catch { /* private mode: theme just won't persist */ }
  };
  return (
    <div role="radiogroup" aria-label={t('Colour theme')} className={`inline-flex items-center gap-1.5 ${className}`}>
      {THEMES.map((t) => (
        <button key={t.key} role="radio" aria-checked={cur === t.key} aria-label={t.name} title={t.name} onClick={() => pick(t.key)}
          className={`h-7 w-7 overflow-hidden rounded-full border-2 transition hover:scale-110 ${cur === t.key ? 'border-stone-900 ring-2 ring-stone-300' : 'border-white shadow'}`}
          style={{ background: `linear-gradient(135deg, ${t.brand} 50%, ${t.accent} 50%)` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- roles, people, paging
export const ROLE_LABEL: Record<string, string> = translated({ INSTITUTION: 'Institution', SCRUTINY: 'Scrutiny Officer', APPROVER: 'Approving Officer', ADMIN: 'Admin' });
export const ROLE_DUTY: Record<string, string> = translated({
  INSTITUTION: 'Submits FDRs, tracks maturity, requests renewal and release / refund.',
  SCRUTINY: 'The maker. Reviews OCR against what was typed, flags discrepancies, recommends release.',
  APPROVER: 'The checker. Gives the final approve or reject on a release.',
  ADMIN: 'Manages users, reminder rules, the demo clock and reads the audit trail.',
});
const ROLE_TONE: Record<string, string> = {
  INSTITUTION: 'bg-sky-50 text-sky-800 border-sky-300', SCRUTINY: 'bg-violet-50 text-violet-800 border-violet-300',
  APPROVER: 'bg-emerald-50 text-emerald-800 border-emerald-300', ADMIN: 'bg-amber-50 text-amber-900 border-amber-400',
};
export const RoleChip = ({ role }: { role: string }) => <span className={`chip whitespace-nowrap ${ROLE_TONE[role] || 'bg-stone-100 text-stone-700 border-stone-300'}`}>{ROLE_LABEL[role] || role}</span>;

export const initials = (name: string) => name.split('(')[0].replace(/^Registrar,\s*/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const Avatar = ({ name, className = '' }: { name: string; className?: string }) => (
  <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-extrabold text-brand ${className}`} aria-hidden="true">{initials(name)}</span>
);
/** Some banks arrive in capitals from OCR; show every bank the same way. */
export const titleCase = (s: string | null | undefined) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s || '');

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  const from = page * size + 1, to = Math.min(total, (page + 1) * size);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-4 py-3 text-sm text-stone-600" aria-label="Pagination">
      <span>{t('Showing')} <b className="text-stone-900">{from}–{to}</b> {t('of')} {total}</span>
      <span className="flex items-center gap-1">
        <button className="btn-alt btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}><Icon name="chevL" size={14} />{t('Prev')}</button>
        <span className="px-2 tabular-nums">{t('Page')} {page + 1} / {pages}</span>
        <button className="btn-alt btn-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{t('Next')}<Icon name="chevR" size={14} /></button>
      </span>
    </nav>
  );
}

/** What can honestly be said about an FDR's verification. Never green, never a bare "Verified". */
export const VerifyBadge = ({ v }: { v: string }) => {
  const bank = useBank();
  const m: Record<string, [string, string, string]> = {
    NOT_SUBMITTED: ['Not submitted', 'bg-stone-100 text-stone-700 border-stone-300', 'file'],
    PENDING: ['Pending', 'bg-sky-50 text-sky-800 border-sky-300', 'clock'],
    BANK_CONFIRMED: [bank.label, 'bg-amber-50 text-amber-900 border-amber-500', 'bank'],
    DISCREPANCY: ['Discrepancy / rejected', 'bg-red-50 text-red-800 border-red-300', 'alert'],
  };
  const x = m[v] || m.PENDING;
  return <span className={`chip whitespace-nowrap ${x[1]}`}><Icon name={x[2]} size={12} />{t(x[0])}</span>;
};

/** Choose the interface language. Each option shows the native name and the English name. */
export function LanguagePicker({ className = '' }: { className?: string }) {
  const lang = useLang();
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 ${className}`}>
      <Icon name="globe" size={15} /><span className="sr-only">{t('Language')}</span>
      <select aria-label={t('Language')} className="inp !w-auto !py-1 text-sm" value={lang} onChange={(e) => setLang(e.target.value)}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.code === 'en' ? 'English' : `${l.native} (${l.english})`}</option>)}
      </select>
    </label>
  );
}

export const Empty = ({ children, icon = 'file' }: { children: ReactNode; icon?: string }) => (
  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">
    <span className="rounded-full bg-brand-50 p-3 text-brand"><Icon name={icon} size={22} /></span>
    <div className="max-w-md text-sm">{children}</div>
  </div>
);
export const Err = ({ msg }: { msg: string }) => (msg ? <div role="alert" className="my-2 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"><Icon name="alert" size={16} className="mt-0.5 shrink-0" />{msg}</div> : null);
export const Ok = ({ msg }: { msg: string }) => (msg ? <div className="my-2 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"><Icon name="check" size={16} className="mt-0.5 shrink-0" />{msg}</div> : null);
export const Days = ({ d }: { d: number | null }) =>
  d === null ? <>—</> : d < 0 ? <span className="font-semibold text-orange-800">{t('{n}d past maturity', { n: -d })}</span> : d <= 7 ? <span className="font-semibold text-red-700">{t('{n}d left', { n: d })}</span> : d <= 30 ? <span className="font-semibold text-amber-700">{t('{n}d left', { n: d })}</span> : <span>{t('{n}d left', { n: d })}</span>;

// ---------------------------------------------------------------- loaders
// The one JaanchSetu loader is a 3D rupee coin (see loaders.tsx).
/** Minimum time (ms) a loader stays on screen. Local data loads in milliseconds, which would hide the animation. Set to 0 to disable. */
export const LOADER_MS = { splash: 0, page: 0 };

export const Loader = ({ size = 170 }: { size?: number }) => <CoinLoader size={size} />;

/** Tiny flat coin for buttons and inline waits. Inherits the text colour. */
export const Spinner = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg role="status" aria-label="Working" width={size} height={size} viewBox="0 0 120 120" fill="none" className={`shrink-0 ${className}`}>
    <g className="coin-spin">
      <circle cx="60" cy="60" r="50" stroke="currentColor" strokeWidth="13" />
      <circle cx="60" cy="60" r="29" stroke="currentColor" strokeWidth="7" opacity=".5" />
      <circle cx="60" cy="60" r="8" fill="currentColor" />
    </g>
  </svg>
);

/** Full-screen loader: the coin, "Loading..." and a slim progress line on a soft theme-tinted white. */
export const FullPageLoader = () => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-white"
    style={{ backgroundImage: 'radial-gradient(50% 42% at 50% 46%, rgb(var(--brand-50)) 0%, rgb(255 255 255) 78%)' }}>
    {/* slow breathing halo behind the bridge */}
    <div className="load-halo pointer-events-none absolute h-72 w-72 rounded-full bg-brand/[0.07] blur-3xl" aria-hidden="true" />
    <div className="relative flex flex-col items-center gap-8">
      <Loader size={200} />
      <div className="flex flex-col items-center gap-4">
        <span className="load-text load-dots text-base font-bold uppercase tracking-[0.34em] text-brand" aria-hidden="true">{t('Loading')}</span>
        <span className="load-text relative h-[5px] w-56 overflow-hidden rounded-full bg-brand/10" aria-hidden="true">
          <span className="load-bar absolute inset-y-0 w-1/3 rounded-full" style={{ backgroundImage: 'linear-gradient(90deg, rgb(var(--gold) / 0), rgb(var(--gold)) 55%, rgb(var(--gold-600)))' }} />
        </span>
      </div>
    </div>
  </div>
);
export const SplashLoader = FullPageLoader;

export const Skeleton = ({ className = 'h-6 w-full' }: { className?: string }) => <div className={`skeleton ${className}`} />;
export const PageSkeleton = () => (
  <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center" aria-busy="true">
    <div className="flex flex-col items-center gap-3"><Loader size={150} /><span className="load-dots text-xs font-bold uppercase tracking-[0.26em] text-brand">{t('Loading')}</span></div>
  </div>
);
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="h-page">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-stone-600">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-stone-200">
      {tabs.map((tb) => (
        <button key={tb.key} role="tab" aria-selected={value === tb.key} onClick={() => onChange(tb.key)}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${value === tb.key ? 'border-gold-600 text-brand' : 'border-transparent text-stone-500 hover:text-brand'}`}>
          {t(tb.label)}{tb.count !== undefined && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${value === tb.key ? 'bg-gold-100 text-brand' : 'bg-stone-100 text-stone-600'}`}>{tb.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- lifecycle stepper
const STAGES = ['Submitted', 'Scrutiny', 'Accepted', 'Expiring', 'Matured', 'Renew / release', 'Closed'];
const STAGE_OF: Record<string, number> = {
  DRAFT: -1, SUBMITTED: 0, UNDER_SCRUTINY: 1, DISCREPANCY_RAISED: 1, ACCEPTED: 2, EXPIRING_SOON: 3, MATURED: 4,
  RENEWAL_PENDING: 5, RELEASE_REQUESTED: 5, RELEASE_RECOMMENDED: 5, RENEWED: 6, RELEASED: 6, REJECTED: 6,
};
export function Stepper({ status }: { status: string }) {
  const cur = STAGE_OF[status] ?? 0;
  const bad = status === 'DISCREPANCY_RAISED' || status === 'REJECTED';
  return (
    <ol className="flex w-full items-start" aria-label={`Lifecycle position: ${statusText(status)}`}>
      {STAGES.map((s, i) => {
        const done = i < cur || (i === cur && ['RENEWED', 'RELEASED'].includes(status));
        const here = i === cur && !done;
        return (
          <li key={s} className="flex min-w-0 basis-0 flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : i <= cur ? 'bg-brand' : 'bg-stone-300'}`} />
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${done ? 'border-brand bg-brand text-white' : here ? (bad ? 'border-red-600 bg-red-50 text-red-700 ring-4 ring-red-100' : 'border-gold-600 bg-gold text-brand ring-4 ring-gold-100') : 'border-stone-300 bg-white text-stone-400'}`}>
                {done ? <Icon name="check" size={14} /> : bad && here ? '!' : i + 1}
              </span>
              <span className={`h-0.5 flex-1 ${i === STAGES.length - 1 ? 'opacity-0' : i < cur ? 'bg-brand' : 'bg-stone-300'}`} />
            </div>
            <span className={`mt-1.5 w-full break-words px-0.5 text-[11px] leading-tight ${here ? 'font-bold text-brand' : done ? 'font-semibold text-stone-700' : 'text-stone-400'}`}>{t(s)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- toasts + dialogs
type ToastKind = 'ok' | 'err' | 'info';
interface ToastItem { id: number; msg: string; kind: ToastKind }
interface PromptState { title: string; label: string; min: number; confirmText: string; danger?: boolean; resolve: (v: string | null) => void }
let toasts: ToastItem[] = [];
let prompt: PromptState | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let toastId = 0;

export function toast(msg: string, kind: ToastKind = 'ok') {
  const id = ++toastId;
  toasts = [...toasts, { id, msg, kind }];
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, kind === 'err' ? 8000 : 5000);
}

/** In-app replacement for window.prompt: resolves with the text, or null if cancelled. */
export function promptText(o: { title: string; label: string; min?: number; confirmText?: string; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    prompt = { title: o.title, label: o.label, min: o.min ?? 3, confirmText: o.confirmText ?? 'Confirm', danger: o.danger, resolve };
    emit();
  });
}

export function DialogHost() {
  const toastList = useSyncExternalStore(subscribe, () => toasts);
  const p = useSyncExternalStore(subscribe, () => prompt);
  const [val, setVal] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!p) return;
    const previous = document.activeElement as HTMLElement | null;
    setVal('');
    const timer = setTimeout(() => ref.current?.focus(), 0);
    return () => { clearTimeout(timer); previous?.focus(); };
  }, [p]);
  const close = (v: string | null) => { p?.resolve(v); prompt = null; emit(); };
  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toastList.map((x) => (
          <div key={x.id} role={x.kind === 'err' ? 'alert' : 'status'} className={`pointer-events-auto flex animate-slideIn items-start gap-2 rounded-lg border p-3 text-sm shadow-pop ${x.kind === 'err' ? 'border-red-300 bg-red-50 text-red-900' : x.kind === 'info' ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
            <Icon name={x.kind === 'err' ? 'alert' : 'check'} size={16} className="mt-0.5 shrink-0" />{x.msg}
          </div>
        ))}
      </div>
      {p && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/50 p-4" onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); close(null); }
          if (e.key === 'Tab') {
            const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('textarea,button:not([disabled])'));
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
          <form role="dialog" aria-modal="true" aria-label={p.title} className="card w-full max-w-md !p-6 shadow-pop" onSubmit={(e) => { e.preventDefault(); if (val.trim().length >= p.min) close(val.trim()); }}>
            <h2 className="h-sec mb-3">{p.title}</h2>
            <label className="lbl" htmlFor="dlg-text">{p.label}</label>
            <textarea id="dlg-text" ref={ref} className="inp min-h-[96px]" value={val} onChange={(e) => setVal(e.target.value)} />
            <p className={`mt-1 text-xs ${val.trim().length >= p.min ? 'text-emerald-700' : 'text-stone-500'}`}>{val.trim().length >= p.min ? t('Ready') : t('At least {n} characters required ({have} so far)', { n: p.min, have: val.trim().length })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-alt" onClick={() => close(null)}>{t('Cancel')}</button>
              <button type="submit" className={p.danger ? 'btn-danger' : 'btn'} disabled={val.trim().length < p.min}>{p.confirmText}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export const Conf = ({ v }: { v: number | null }) =>
  v === null ? <span className="text-xs text-stone-500">{t('confidence n/a (PDF text)')}</span> : (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-600" title={`OCR confidence ${Math.round(v)}%`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-200"><span className={`block h-full ${v >= 90 ? 'bg-emerald-500' : v >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, v)}%` }} /></span>
      {Math.round(v)}% {v < 90 && <b className="text-amber-800">{t('check')}</b>}
    </span>
  );
