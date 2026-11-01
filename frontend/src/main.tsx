import Shell from './Shell';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import './workspace.css';
import { api, getToken, setToken } from './api';
import { DialogHost, Icon, Me, FullPageLoader, LOADER_MS, Loader, SplashLoader, Spinner } from './ui';
import { t, useLang } from './i18n';
import Login from './pages/EntryLogin';
import VerifyOrder from './pages/VerifyOrder';

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
        <Route path="*" element={me ? <Shell key={me.id} me={me} reload={load} logout={logout} intro={booted.current} /> : <Navigate to="/login" />} />
      </Routes>
      <DialogHost />
    </BrowserRouter>
  );
}

const container = document.getElementById('root') as HTMLElement & { __jaanchsetuRoot?: ReturnType<typeof ReactDOM.createRoot> };
const root = container.__jaanchsetuRoot || (container.__jaanchsetuRoot = ReactDOM.createRoot(container));
root.render(<React.StrictMode><App /></React.StrictMode>);
