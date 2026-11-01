import { t } from '../i18n';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { Err, Icon, Loader, ROLE_LABEL, Spinner, ThemePicker, useLoad, LanguagePicker } from '../ui';

const ROLE_ICON: Record<string, string> = { INSTITUTION: 'building', SCRUTINY: 'eye', APPROVER: 'check', ADMIN: 'sliders' };
const ROLE_NOTE: Record<string, string> = { INSTITUTION: 'Start here', SCRUTINY: 'Maker', APPROVER: 'Checker', ADMIN: 'Setup' };

/** Floating 3D "receipts" behind the card. Pure CSS, no libraries; hidden by reduced-motion. */
const SLIPS = [
  { x: '6%', y: '14%', s: 1, d: 0, r: '-14deg' }, { x: '82%', y: '10%', s: 0.8, d: 1.4, r: '12deg' },
  { x: '12%', y: '68%', s: 0.75, d: 2.2, r: '9deg' }, { x: '86%', y: '64%', s: 1.05, d: 0.7, r: '-10deg' },
  { x: '72%', y: '90%', s: 0.6, d: 3, r: '6deg' },
];

export default function Login({ onDone }: { onDone: () => Promise<unknown> | void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [show, setShow] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const demo = useLoad(() => api('/demo/accounts'), []);
  const go = async (e: string, p: string) => {
    setError(''); setBusy(e);
    try {
      const r = await api('/auth/login', { body: { email: e, password: p } });
      setToken(r.token);
      await onDone();
      nav('/');
    } catch (x) { setError((x as Error).message); setBusy(''); }
  };
  const move = (e: React.MouseEvent) => {
    const b = stage.current?.getBoundingClientRect();
    if (!b) return;
    setTilt({ x: ((e.clientX - b.left) / b.width - 0.5) * 2, y: ((e.clientY - b.top) / b.height - 0.5) * 2 });
  };
  return (
    <div ref={stage} onMouseMove={move} onMouseLeave={() => setTilt({ x: 0, y: 0 })} className="login3d relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-brand px-4 py-8 text-white">
      <div className="login3d-glow" aria-hidden="true" />
      <div className="login3d-floor" aria-hidden="true" />
      {SLIPS.map((s, i) => (
        <div key={i} aria-hidden="true" className="login3d-slip" style={{ left: s.x, top: s.y, ['--s' as string]: s.s, ['--r' as string]: s.r, animationDelay: `${s.d}s` }}>
          <span className="login3d-slip-bar" /><span className="login3d-slip-line" /><span className="login3d-slip-line w-2/3" /><b>₹</b>
        </div>))}

      <div className="absolute right-4 top-4 z-20 flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur"><LanguagePicker className="!text-white [&_select]:!text-stone-900" /><ThemePicker /></div>

      <div className="relative z-10 w-full max-w-md" style={{ perspective: '1100px' }}>
        <div className="pointer-events-none relative z-20 mb-[-46px] flex justify-center" style={{ transform: `translate3d(${tilt.x * 10}px, ${tilt.y * 6}px, 0)`, transition: 'transform .15s ease-out' }}>
          <Loader size={104} />
        </div>
        <div className="login3d-card" style={{ transform: `rotateY(${tilt.x * 5}deg) rotateX(${-tilt.y * 5}deg)` }}>
          <div className="text-center">
            <div className="text-2xl font-extrabold tracking-tight text-brand">{t('JaanchSetu')}</div>
            <div className="mt-0.5 text-xs font-semibold text-stone-500">{t('Security deposit / FDR lifecycle portal · SIH26265')}</div>
          </div>
          <h1 className="mt-5 text-center text-lg font-bold text-stone-800">{t('Sign in')}</h1>
          <Err msg={error} />
          <form className="mt-3 space-y-3.5" onSubmit={(e) => { e.preventDefault(); go(email, password); }}>
            <div><label className="lbl" htmlFor="em">{t('Email')}</label><input id="em" className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder={t('name@demo.test')} autoFocus /></div>
            <div><label className="lbl" htmlFor="pw">{t('Password')}</label>
              <div className="relative"><input id="pw" type={show ? 'text' : 'password'} className="inp !pr-16" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                <button type="button" className="absolute inset-y-0 right-2 px-2 text-xs font-bold text-brand hover:underline" onClick={() => setShow(!show)} aria-pressed={show}>{show ? t('Hide') : t('Show')}</button></div></div>
            <button className="btn w-full" type="submit" disabled={!email || !password || !!busy}>{busy && busy === email ? <><Spinner size={18} />{t('Signing in…')}</> : <>{t('Sign in')} <Icon name="arrow" size={16} /></>}</button>
          </form>

          {demo.data?.demoMode && (
            <div className="mt-5">
              <div className="mb-2.5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-stone-500"><span className="h-px flex-1 bg-stone-200" />{t('Demo access')}<span className="h-px flex-1 bg-stone-200" /></div>
              <div className="grid grid-cols-2 gap-2">
                {demo.data.accounts.map((a: any) => (
                  <button key={a.email} disabled={!!busy} onClick={() => go(a.email, demo.data.password)} aria-label={t('Enter as') + ' ' + ROLE_LABEL[a.role]}
                    className="group flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-left transition hover:-translate-y-0.5 hover:border-gold-600 hover:shadow-card disabled:opacity-60">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand transition group-hover:bg-gold">{busy === a.email ? <Spinner size={16} /> : <Icon name={ROLE_ICON[a.role]} size={16} />}</span>
                    <span className="min-w-0"><b className="block text-[12.5px] leading-tight text-brand">{ROLE_LABEL[a.role]}</b><span className="text-[10.5px] text-stone-500">{t(ROLE_NOTE[a.role])}</span></span>
                  </button>))}
              </div>
              <p className="mt-2 text-center text-[11px] text-stone-500">{t('Demo password for every account:')} <b>{demo.data.password}</b></p>
            </div>)}
          {demo.error && <p className="mt-4 text-center text-xs text-red-700">{t('Cannot reach the server. Start the API and refresh.')}</p>}
        </div>
      </div>
      <p className="relative z-10 mt-6 max-w-md text-center text-xs text-brand-100">{t('Prototype for SIH 2026. Not an official AICTE system. No real bank integration. All data is fictional.')}</p>
    </div>
  );
}
