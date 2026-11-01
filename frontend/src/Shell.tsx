import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, dmy, setToken } from './api';
import { AuthCtx, Avatar, Icon, LanguagePicker, Me, ROLE_LABEL, has, setBankInfo, useBank, useLoad } from './ui';
import { t } from './i18n';
import { BridgeMark } from './brand';
import Dashboard from './pages/OversightDashboard';
import FdrList from './pages/FdrList';
import FdrNew from './pages/FdrNew';
import FdrDetail from './pages/FdrDetail';
import Institutions from './pages/Institutions';
import Notifications from './pages/Notifications';
import AuditPage from './pages/Audit';
import Admin from './pages/Admin';
import DemoGuide from './pages/DemoGuide';
import Reports from './pages/Reports';

const PAGES = [{ path: '/', label: 'Overview', icon: 'home' }, { path: '/fdrs', label: 'Deposit register', icon: 'layers' }, { path: '/reports', label: 'Reports & exports', icon: 'chart' }, { path: '/notifications', label: 'Notifications', icon: 'bell' }];

function CommandMenu({ close, me }: { close: () => void; me: Me }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const go = (path: string) => { close(); nav(path); };
  const pages = [...PAGES, ...(has(me, 'INSTITUTION') ? [{ path: '/fdrs/new', label: 'Submit a new FDR', icon: 'plus' }] : []), ...(!has(me, 'INSTITUTION') || me.roles.length > 1 ? [{ path: '/institutions', label: 'Institutions & coverage', icon: 'building' }] : []), ...(has(me, 'ADMIN') ? [{ path: '/admin', label: 'Administration & demo clock', icon: 'sliders' }, { path: '/audit', label: 'Audit trail', icon: 'lock' }] : []), { path: '/demo', label: 'Demo guide', icon: 'book' }];
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setLoading(false); return; }
    let live = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => api(`/fdrs?q=${encodeURIComponent(query.trim())}&pageSize=5`).then(d => { if (live) setResults(d.items || []); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }), 220);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);
  useEffect(() => { const el = panel.current?.querySelector('input'); el?.focus(); }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab') return;
    const els = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]') || []);
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return <div className="command-backdrop" onClick={close}><div ref={panel} className="command-dialog" role="dialog" aria-modal="true" aria-label="Find a deposit or open a workspace" onClick={e => e.stopPropagation()} onKeyDown={trap}>
    <form className="command-input" onSubmit={e => { e.preventDefault(); go(`/fdrs?q=${encodeURIComponent(query)}`); }}><Icon name="search" size={23}/><input aria-label="Search commands and deposits" placeholder="Where would you like to go?" value={query} onChange={e => setQuery(e.target.value)}/><button type="button" className="keycap" onClick={close} aria-label="Close search">Esc</button></form>
    <div className="command-results"><p className="eyebrow">Workspace</p>{pages.filter(p => p.label.toLowerCase().includes(query.toLowerCase())).map(p => <button key={p.path} onClick={() => go(p.path)}><Icon name={p.icon}/><span>{t(p.label)}</span><Icon name="arrow" size={15}/></button>)}
      {query.trim().length >= 2 && <><p className="eyebrow">Matching deposits</p><div aria-live="polite">{loading ? <p className="command-note">Searching your accessible records…</p> : error ? <p className="command-note text-red-700">{error}</p> : !results.length ? <p className="command-note">No matching deposits.</p> : results.map(r => <button key={r.id} onClick={() => go(`/fdrs/${r.id}`)}><Icon name="file"/><span><b>{r.fdrNumber || 'Draft'}</b><small>{r.institutionName}</small></span><Icon name="arrow" size={15}/></button>)}</div></>}
    </div><div className="command-foot">Search respects your institution access. <span>Enter to search all records</span></div>
  </div></div>;
}

export default function Shell({ me, reload, logout }: { me: Me; reload: () => void; logout: () => void; intro?: boolean }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const commandButton = useRef<HTMLButtonElement>(null);
  const clock = useLoad(() => api('/clock'), []);
  const notes = useLoad(() => api('/notifications'), []);
  const meta = useLoad(() => api('/meta'), []);
  const demo = useLoad(() => api('/demo/accounts'), []);
  const bank = useBank();
  const staff = !has(me, 'INSTITUTION') || me.roles.length > 1;
  const unread = notes.data?.unread || 0;
  useEffect(() => { if (meta.data?.bank) setBankInfo(meta.data.bank); }, [meta.data]);
  useEffect(() => { setOpen(false); setCommand(false); }, [loc.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { const target = e.target as HTMLElement; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommand(v => !v); } else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(target.tagName) && !target.isContentEditable) { e.preventDefault(); setCommand(true); } else if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { const timer = setInterval(() => { notes.reload(); clock.reload(); }, 30000); return () => clearInterval(timer); }, []);
  const closeCommand = () => { setCommand(false); commandButton.current?.focus(); };
  const navItem = (path: string, label: string, icon: string, badge?: number) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}><Icon name={icon} size={19}/><span>{t(label)}</span>{badge ? <b className="side-count">{badge}</b> : null}</NavLink>;
  const current = loc.pathname === '/' ? 'Overview' : loc.pathname.startsWith('/fdrs/') ? 'Deposit workspace' : ({ '/fdrs': 'Deposit register', '/institutions': 'Institutions', '/reports': 'Reports', '/notifications': 'Notifications', '/admin': 'Administration', '/audit': 'Audit trail', '/demo': 'Demo guide' } as Record<string,string>)[loc.pathname] || 'Workspace';
  return <AuthCtx.Provider value={{ me, reload, logout }}><div className="workspace-shell"><a className="skip-link" href="#workspace-content">Skip to workspace</a>
    {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setOpen(false)}/>}
    <aside className={`workspace-sidebar ${open ? 'is-open' : ''}`}><Link to="/" className="workspace-brand"><BridgeMark size={39}/><span><b>JaanchSetu<span className="brand-dot">.</span></b><small>THE DEPOSIT WORKSPACE</small></span></Link>
      <div className="workspace-scope"><span className="live-dot"/><span>SIH 2026 <b>/</b> SIH26265</span><Icon name="shield" size={14}/></div>
      <nav aria-label="Main navigation"><p className="side-label">Workspace</p>{PAGES.map(p => navItem(p.path,p.label,p.icon,p.path === '/notifications' ? unread : 0))}{has(me,'INSTITUTION') && navItem('/fdrs/new','Submit a deposit','plus')}
      {staff && <><p className="side-label">Governance</p>{navItem('/institutions','Institutions & coverage','building')}{has(me,'ADMIN') && <>{navItem('/audit','Audit trail','lock')}{navItem('/admin','Administration','sliders')}</>}</>}
      <p className="side-label">Explore</p>{navItem('/demo','Demo guide','book')}</nav>
      <div className="sidebar-bottom"><div className="side-note"><Icon name="link" size={17}/><b>Evidence before decisions.</b><p>A clear source. A recorded review. An accountable next step.</p></div><div className="side-person"><Avatar name={me.name}/><span><b>{me.name.split('(')[0].trim()}</b><small>{me.roles.map(r => ROLE_LABEL[r]).join(' · ')}</small></span><button aria-label="Sign out" onClick={logout}><Icon name="logout" size={17}/></button></div></div>
    </aside>
    <div className="workspace-body">{clock.data?.isShifted && <div className="demo-clock-banner" role="status"><Icon name="clock" size={15}/>Demo clock: {dmy(clock.data.demoDate)} · dates and reminders use this simulated date.</div>}
      <header className="workspace-topbar"><button className="mobile-toggle" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu"/></button><div className="workspace-breadcrumb"><Icon name="folder" size={16}/><span>Workspace</span><span>/</span><b>{t(current)}</b></div><button ref={commandButton} className="command-trigger" onClick={() => setCommand(true)}><Icon name="search" size={16}/><span>Find anything</span><kbd>Ctrl K</kbd></button><div className="topbar-tools"><span className="demo-pill"><span/>Prototype</span><LanguagePicker className="topbar-language"/><Link to="/notifications" className="notification-button" aria-label={`${unread} unread notifications`}><Icon name="bell"/>{unread > 0 && <i/>}</Link></div></header>
      {demo.data?.demoMode && <div className="demo-toolbar"><span><span className="live-dot"/>Synthetic records · {bank.simulated ? 'Bank simulator' : 'Configured bank service'}</span><label>Explore as <select aria-label="Demo role" disabled={switching} value={demo.data.accounts.find((a: any) => a.email === me.email)?.email || ''} onChange={async e => { setSwitching(true); setSwitchError(''); try { const result = await api('/auth/login',{body:{email:e.target.value,password:demo.data.password}}); setToken(result.token); navigate('/'); reload(); } catch(e) { setSwitchError((e as Error).message); } finally { setSwitching(false); } }}><option value="" disabled>Current account</option>{demo.data.accounts.map((a: any) => <option key={a.email} value={a.email}>{ROLE_LABEL[a.role]}</option>)}</select></label>{switchError && <span role="alert">{switchError}</span>}</div>}
      <main id="workspace-content" tabIndex={-1} className="workspace-content"><Routes>
        <Route path="/" element={<Dashboard/>}/><Route path="/fdrs" element={<FdrList/>}/><Route path="/fdrs/new" element={has(me,'INSTITUTION') ? <FdrNew/> : <Navigate to="/" replace/>}/><Route path="/fdrs/:id" element={<FdrDetail/>}/><Route path="/institutions" element={<Institutions/>}/><Route path="/institutions/:id" element={<Institutions/>}/><Route path="/reports" element={<Reports/>}/><Route path="/notifications" element={<Notifications onChange={notes.reload}/>}/><Route path="/audit" element={has(me,'ADMIN') ? <AuditPage/> : <Navigate to="/" replace/>}/><Route path="/admin" element={has(me,'ADMIN') ? <Admin onClock={clock.reload}/> : <Navigate to="/" replace/>}/><Route path="/demo" element={<DemoGuide/>}/><Route path="*" element={<Navigate to="/"/>}/>
      </Routes></main><footer className="workspace-footer"><span>JaanchSetu <b>·</b> SIH26265</span><span>Prototype. Not an official AICTE system. {bank.simulated ? 'No real bank integration.' : 'Bank checks use the configured service.'}</span><span>Built for accountable decisions <Icon name="shield" size={13}/></span></footer>
    </div>{command && <CommandMenu me={me} close={closeCommand}/>}</div></AuthCtx.Provider>;
}
