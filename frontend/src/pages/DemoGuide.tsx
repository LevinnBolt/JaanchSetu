import { t } from '../i18n';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon, PageHeader, ROLE_DUTY, ROLE_LABEL, RoleChip, useLoad } from '../ui';

const ROLE_ICON: Record<string, string> = { INSTITUTION: 'building', SCRUTINY: 'eye', APPROVER: 'check', ADMIN: 'sliders' };
const ROLES: { role: string; need: string; login: string }[] = [
  { role: 'INSTITUTION', need: 'Required', login: 'institution@demo.test' },
  { role: 'SCRUTINY', need: 'Required (maker)', login: 'scrutiny@demo.test' },
  { role: 'APPROVER', need: 'Required (checker)', login: 'approver@demo.test' },
  { role: 'ADMIN', need: 'Configuration', login: 'admin@demo.test' },
];

// the ten capabilities in the problem statement, and where to see each one
const COVERAGE: { n: number; cap: string; how: string; to: string }[] = [
  { n: 1, cap: 'Central FDR repository', how: 'Institution-wise and instrument-wise records with filters, paging and CSV export. Admins add institutions and users one by one, or import thousands from a CSV.', to: '/fdrs' },
  { n: 2, cap: 'Digital document management', how: 'Upload, SHA-256 hash, AES-256 encrypted storage, side-by-side viewer on each FDR.', to: '/fdrs' },
  { n: 3, cap: 'Verification and discrepancy detection', how: 'Truth table (read from the document, bank, officer review), nine discrepancy types and a Verification column (Pending, Bank-confirmed or Discrepancy). Bank answers come from a labelled simulator, or from a real bank API when one is configured.', to: '/fdrs?bucket=pending' },
  { n: 4, cap: 'Validity and maturity tracking', how: 'Maturity Radar at 90, 60, 30 and 7 days, driven by a demo clock.', to: '/fdrs?bucket=expiring90' },
  { n: 5, cap: 'Renewal and replacement monitoring', how: 'Renewal requests link old and new FDR on one timeline.', to: '/fdrs?bucket=renewal' },
  { n: 6, cap: 'Release and refund workflow', how: 'Request release / refund, checklist, recommend, approve. The approver cannot be the maker, the requester or the creator.', to: '/fdrs?bucket=release' },
  { n: 7, cap: 'Alerts and escalation', how: 'In-app notifications and emails. Unacknowledged reminders escalate every 7 days. Every email is kept in Admin > Email outbox.', to: '/notifications' },
  { n: 8, cap: 'Dashboard and reports', how: 'Status cards, 12-month timeline, work queues, five ready-made Reports with CSV, and measured-impact figures.', to: '/reports' },
  { n: 9, cap: 'Audit trail and access control', how: 'Role-based access, hash-chained append-only log with an integrity check.', to: '/audit' },
  { n: 10, cap: 'Integration and data security', how: 'Pluggable bank adapter: the simulator by default, an HTTP bank API when BANK_API_URL is set. Encrypted files, JWT, bcrypt. Tested with 5,000 institutions and 8,000 FDRs.', to: '/demo' },
];

export default function DemoGuide() {
  const g = useLoad(() => api('/demo/guide'), []);
  const a = g.data?.anchors || {};
  const L = ({ k, children }: { k: string; children: ReactNode }) => (a[k] ? <Link className="btn btn-sm" to={`/fdrs/${a[k]}`}>{children}</Link> : null);
  const steps: { n: number; t: string; who: string[]; body: string; links: ReactNode }[] = [
    { n: 1, t: 'New FDR submission', who: ['INSTITUTION'], body: 'Open Submit FDR, click “Matching sample” (it fills the form and attaches a generated specimen receipt), then submit. OCR fills the Extracted column and the truth table appears. “Mismatching sample” shows flags immediately.', links: <Link className="btn btn-sm" to="/fdrs/new">{t('Open the submit form')}</Link> },
    { n: 2, t: 'Validity tracking', who: ['INSTITUTION', 'SCRUTINY', 'APPROVER', 'ADMIN'], body: 'The dashboard counts this FDR as Active, and its page shows days to maturity.', links: <><Link className="btn btn-sm" to="/">{t('Dashboard')}</Link><L k="s2">{t('Open the Active FDR')}</L></> },
    { n: 3, t: 'Approaching maturity', who: ['ADMIN', 'SCRUTINY'], body: 'This FDR matures in 95 days. In Admin click +30d (the 90-day reminder fires and status becomes Expiring soon), then +60d and +90d. Do not acknowledge: after 7 days the reminder escalates to the institution, then the scrutiny officer, then the approving officer.', links: <><L k="s3">{t('Open the FDR')}</L><Link className="btn-alt btn-sm" to="/admin">{t('Admin: demo clock')}</Link><L k="esc2">{t('See an escalated FDR')}</L></> },
    { n: 4, t: 'Renewal', who: ['INSTITUTION', 'SCRUTINY'], body: 'On this matured FDR choose Request renewal, then Upload renewed FDR (use a sample). A scrutiny officer accepts the new FDR and the old one becomes Renewed. Both appear on one timeline.', links: <><L k="s4">{t('Open the matured FDR')}</L><L k="renewedNew">{t('See a finished chain')}</L></> },
    { n: 5, t: 'Discrepancy identification', who: ['SCRUTINY'], body: 'The document of this FDR shows an invalid IFSC and a lien holder that is not AICTE. Resolve one with a note, waive the other with a written reason, confirm or correct the values read from the document, then Accept.', links: <L k="s5">{t('Open the flagged FDR')}</L> },
    { n: 6, t: 'Authorised release', who: ['INSTITUTION', 'SCRUTINY', 'APPROVER'], body: 'The institution requests release / refund on the first FDR. As scrutiny, tick the checklist (each with a note) and recommend on the second. As approver, approve the third. Then read the audit trail.', links: <><L k="s6a">{t('1 Request release')}</L><L k="s6b">{t('2 Recommend')}</L><L k="s6c">{t('3 Approve')}</L><Link className="btn-alt btn-sm" to="/audit">{t('Audit trail')}</Link></> },
  ];
  return (
    <div className="space-y-8">
      <PageHeader title={t('Demo guide')} subtitle={t('Everything a reviewer needs: who does what, six test scenarios, and where each requirement lives. All data is fictional and the bank is a simulator.')} />

      <section aria-labelledby="roles">
        <h2 id="roles" className="h-sec mb-3">{t('Who uses the portal')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r.role} className="card !p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand"><Icon name={ROLE_ICON[r.role]} size={20} /></span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${r.role === 'ADMIN' ? 'bg-stone-100 text-stone-600' : 'bg-gold-100 text-brand'}`}>{r.need}</span>
              </div>
              <b className="block text-brand">{ROLE_LABEL[r.role]}</b>
              <p className="mt-0.5 text-[13px] leading-snug text-stone-600">{ROLE_DUTY[r.role]}</p>
              <code className="mt-2 block truncate rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">{r.login}</code>
            </div>))}
        </div>
        <p className="mt-2 text-xs text-stone-500">{t('Password for every demo account: demo123. Sign out and choose another role on the login page to change role. The approver can never be the person who recommended, requested or created the record; the server refuses it.')}</p>
      </section>

      <section aria-labelledby="scen">
        <h2 id="scen" className="h-sec mb-3">{t('Six test scenarios')}</h2>
        <p className="mb-3 text-sm text-stone-600">{t('Bank results to try as scrutiny with “Check with bank (simulation)”:')} <span className="inline-flex flex-wrap gap-1.5 align-middle"><L k="bankMatch">{t('MATCH')}</L><L k="bankMismatch">{t('MISMATCH')}</L><L k="bankNotFound">{t('NOT_FOUND')}</L><L k="bankOutage">{t('SERVICE_UNAVAILABLE')}</L></span></p>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.n} className="card flex gap-4 !p-4 sm:!p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-base font-extrabold text-gold">{s.n}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-brand">{s.t}</h3><span className="text-xs text-stone-500">{t('sign in as')}</span>{s.who.map((w) => <RoleChip key={w} role={w} />)}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{s.body}</p>
                <div className="mt-3 flex flex-wrap gap-2">{s.links}</div>
              </div>
            </li>))}
        </ol>
      </section>

      <section aria-labelledby="cov">
        <h2 id="cov" className="h-sec mb-1">{t('Requirement coverage')}</h2>
        <p className="mb-3 text-sm text-stone-600">{t('The ten capabilities named in the problem statement SIH26265, and where to see each one.')}</p>
        <div className="card overflow-hidden !p-0"><div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th className="w-10">#</th><th>{t('Capability')}</th><th>{t('How it is shown')}</th><th className="text-right">{t('Open')}</th></tr></thead>
          <tbody>{COVERAGE.map((c) => (
            <tr key={c.n}><td className="tabular-nums font-bold text-gold-600">{c.n}</td><td className="font-semibold text-brand">{c.cap}</td><td className="text-stone-700">{c.how}</td>
              <td className="text-right"><Link className="btn-alt btn-sm" to={c.to}>{t('View')}<Icon name="arrow" size={12} /></Link></td></tr>))}</tbody>
        </table></div></div>
        <p className="mt-2 text-xs text-stone-500">{t('Honest limit: bank verification is simulated unless a bank API is configured, and no real bank agreement exists for this prototype. A real deployment would use an authorised bank API or the RBI Account Aggregator framework. That route is not built.')}</p>
      </section>

      <p className="text-sm text-stone-600">{t('Sample receipt images:')} <a className="font-semibold underline" href="/api/demo/samples/sample-fdr-matching.png">{t('matching')}</a> · <a className="font-semibold underline" href="/api/demo/samples/sample-fdr-mismatch.png">{t('problem document')}</a></p>
    </div>
  );
}
