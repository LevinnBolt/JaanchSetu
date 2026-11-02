import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './index.css';
import { api, dmy, getToken, setToken } from './api';
import { AuthCtx, Avatar, DialogHost, Icon, Me, ROLE_LABEL, FullPageLoader, LOADER_MS, Loader, LanguagePicker, RoleChip, SplashLoader, Spinner, ThemePicker, has, setBankInfo, useBank, useLoad } from './ui';
import { t, useLang } from './i18n';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FdrList from './pages/FdrList';
import FdrNew from './pages/FdrNew';
import FdrDetail from './pages/FdrDetail';
import Institutions from './pages/Institutions';
import Notifications from './pages/Notifications';
import AuditPage from './pages/Audit';
import Admin from './pages/Admin';
import DemoGuide from './pages/DemoGuide';
import Reports from './pages/Reports';
import VerifyOrder from './pages/VerifyOrder';

function Shell({ me, reload, logout, intro }: { me: Me; reload: () => void; logout: () => void; intro: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Centred bridge loader on page changes. The page stays mounted underneath, so its data loads meanwhile.
  const [busy, setBusy] = useState(intro && LOADER_MS.page > 0);
  const prevPath = useRef(loc.pathname);
  const searchRef = useRef<HTMLInputElement>(null);
  const clock = useLoad(() => api('/clock'), []);
  const notes = useLoad(() => api('/notifications'), []);
  const meta = useLoad(() => api('/meta'), []);
  const bank = useBank();
  useEffect(() => { if (meta.data?.bank) setBankInfo(meta.data.bank); }, [meta.data]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (prevPath.current === loc.pathname) return;
    prevPath.current = loc.pathname;
    if (LOADER_MS.page > 0) setBusy(true);
  }, [loc.pathname]);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), LOADER_MS.page);
    return () => clearTimeout(t);
  }, [busy]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { const t = setInterval(() => { notes.reload(); clock.reload(); }, 15000); return () => clearInterval(t); }, []);
  const group = (g: string) => <div className="mb-1.5 mt-5 px-3 text-[10.5px] font-bold uppercase tracking-widest text-brand-100/60 first:mt-0">{t(g)}</div>;
  const item = (to: string, icon: string, label: string, end = false, badge = 0) => (
    <NavLink to={to} end={end} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-gold text-brand shadow-sm' : 'text-brand-100 hover:bg-white/10 hover:text-white'}`}>
      <Icon name={icon} size={18} />{t(label)}
      {badge > 0 && <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">{badge}</span>}
    </NavLink>
  );
  const unread = notes.data?.unread || 0;
  return (
    <AuthCtx.Provider value={{ me, reload, logout }}>
      {busy && <FullPageLoader />}
      <div className="flex min-h-screen">
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brand text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <Link to="/" className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center"><Loader size={44} /></span>
            <span><span className="block text-xl font-extrabold leading-none tracking-tight">{t('JaanchSetu')}</span><span className="text-[11px] text-brand-100">{t('FDR lifecycle · SIH26265')}</span></span>
          </Link>
          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
            {group('Workspace')}
            <div className="space-y-1">
              {item('/', 'home', 'Dashboard', true)}
              {item('/fdrs', 'file', 'All FDRs')}
              {has(me, 'INSTITUTION') && item('/fdrs/new', 'plus', 'Submit FDR')}
              {item('/reports', 'chart', 'Reports')}
              {item('/notifications', 'bell', 'Notifications', false, unread)}
            </div>
            {(!has(me, 'INSTITUTION') || me.roles.length > 1 || has(me, 'ADMIN')) && <>
              {group('Oversight')}
              <div className="space-y-1">
                {(!has(me, 'INSTITUTION') || me.roles.length > 1) && item('/institutions', 'building', 'Institutions')}
                {has(me, 'ADMIN') && item('/audit', 'lock', 'Audit trail')}
                {has(me, 'ADMIN') && item('/admin', 'sliders', 'Admin & demo clock')}
              </div>
            </>}
            {group('Help')}
            <div className="space-y-1">{item('/demo', 'book', 'Demo guide')}</div>
          </nav>
          <div className="px-4 pb-1 md:hidden"><LanguagePicker className="!text-brand-100" /></div>
          <div className="border-t border-white/10 p-4 text-xs text-brand-100">
            <div className="flex items-center gap-3">
              <Avatar name={me.name} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{me.name.split('(')[0].trim()}</div>
                <div className="truncate">{me.institutionName || me.roles.map((r) => ROLE_LABEL[r]).join(' + ')}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="flex flex-wrap gap-1">{me.roles.map((r) => <RoleChip key={r} role={r} />)}</span>
              <button onClick={logout} className="inline-flex items-center gap-1.5 font-semibold text-gold hover:underline"><Icon name="logout" size={14} />{t('Sign out')}</button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {clock.data?.isShifted && (
            <div role="status" className="flex items-center justify-center gap-2 bg-gold px-4 py-1.5 text-center text-sm font-bold text-brand">
              <Icon name="clock" size={16} />{t('Demo date:')} {dmy(clock.data.demoDate)} <span className="font-medium">({t('real date')} {dmy(clock.data.realToday)}{t('). Reminders, status and dashboards use the demo date.')}</span>
            </div>
          )}
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-white/90 px-4 py-2.5 backdrop-blur">
            <button className="btn-alt !p-2 lg:hidden" aria-label={t('Open menu')} onClick={() => setOpen(true)}><Icon name="menu" /></button>
            <form className="relative min-w-0 max-w-md flex-1" onSubmit={(e) => { e.preventDefault(); nav(`/fdrs?q=${encodeURIComponent(q)}`); }} role="search">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input ref={searchRef} aria-label={t('Search FDRs')} className="inp !pl-9 !pr-9" placeholder={t('Search FDRs')} value={q} onChange={(e) => setQ(e.target.value)} />
              <kbd className="pointer-events-none absolute hidden sm:block right-2.5 top-1/2 -translate-y-1/2 rounded border border-stone-300 bg-stone-50 px-1.5 text-[11px] font-semibold text-stone-500">/</kbd>
            </form>
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              <LanguagePicker className="hidden md:inline-flex" />
              <ThemePicker className="hidden md:inline-flex" />
              <Link to="/notifications" className="btn-alt relative !p-2" aria-label={`Notifications, ${unread} unread`}>
                <Icon name="bell" />{unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 lg:px-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/fdrs" element={<FdrList />} />
              <Route path="/fdrs/new" element={has(me, 'INSTITUTION') ? <FdrNew /> : <Navigate to="/" replace />} />
              <Route path="/fdrs/:id" element={<FdrDetail />} />
              <Route path="/institutions" element={<Institutions />} />
              <Route path="/institutions/:id" element={<Institutions />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/notifications" element={<Notifications onChange={notes.reload} />} />
              <Route path="/audit" element={has(me, 'ADMIN') ? <AuditPage /> : <Navigate to="/" replace />} />
              <Route path="/admin" element={has(me, 'ADMIN') ? <Admin onClock={clock.reload} /> : <Navigate to="/" replace />} />
              <Route path="/demo" element={<DemoGuide />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <footer className="border-t border-stone-200 bg-white px-4 py-2.5 text-center text-xs font-medium text-stone-700">
            {t('Prototype for SIH 2026. Not an official AICTE system.')} {bank.simulated ? t('No real bank integration.') : `Bank checks go to the configured bank API (${bank.label.replace(/^Bank-confirmed \(|\)$/g, '')}); everything else is prototype data.`}
          </footer>
        </div>
      </div>
    </AuthCtx.Provider>
  );
}

/** Not linked anywhere: open /loader to look at the loader on its own. */
function LoaderPreview() {
  const [full, setFull] = useState(false);
  return (
    <div className="min-h-screen bg-paper p-6 sm:p-8">
      {full && <div onClick={() => setFull(false)} className="cursor-pointer"><FullPageLoader /></div>}
      <h1 className="h-page mb-1">{t('JaanchSetu loader')}</h1>
      <p className="mb-5 max-w-2xl text-sm text-stone-600">{t('A 3D rupee coin: real thickness, a reeded edge, ₹ on the front and FDR on the back, light that sweeps across as it turns.')}</p>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <button className="btn" onClick={() => setFull(true)}>{t('Preview full screen (click to close)')}</button>
        <Link to="/" className="btn-alt">{t('Back to the app')}</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card flex items-center justify-center py-8"><Loader size={220} /></div>
        <div className="card flex items-center justify-center py-8"><Loader size={110} /></div>
        <div className="card flex flex-col items-center justify-center gap-4 py-8">
          <button className="btn"><Spinner size={20} />{t('Verifying…')}</button>
          <button className="btn-gold"><Spinner size={20} />{t('Signing in…')}</button>
          <span className="text-center text-[13px] text-stone-600">{t('Small coin for buttons')}</span>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [minDone, setMinDone] = useState(LOADER_MS.splash <= 0);
  const booted = useRef(false);
  const lang = useLang(); // changing the language re-renders every screen
  useEffect(() => { const t = setTimeout(() => setMinDone(true), LOADER_MS.splash); return () => clearTimeout(t); }, []);
  useEffect(() => { if (ready && minDone) booted.current = true; }, [ready, minDone]);
  const load = () => (getToken() ? api('/auth/me').then(setMe).catch(() => setMe(null)) : Promise.resolve()).finally(() => setReady(true));
  useEffect(() => { load(); }, []);
  const logout = () => { setToken(null); setMe(null); };
  if (!ready || !minDone) return <SplashLoader />;
  return (
    <BrowserRouter>
      <Routes key={lang}>
        <Route path="/login" element={<Login onDone={load} />} />
        <Route path="/loader" element={<LoaderPreview />} />
        <Route path="/verify/:orderNo" element={<VerifyOrder />} />
        <Route path="*" element={me ? <Shell me={me} reload={load} logout={logout} intro={booted.current} /> : <Navigate to="/login" />} />
      </Routes>
      <DialogHost />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
