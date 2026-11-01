import { Link, useParams } from 'react-router-dom';
import { api, dmy, dt } from '../api';
import { Icon, LanguagePicker, useLoad } from '../ui';
import { t } from '../i18n';

/** Public page opened by the QR code on a release / refund order. No sign-in. Shows only minimal details. */
export default function VerifyOrder() {
  const { orderNo } = useParams();
  const { data, error } = useLoad(() => api(`/public/orders/${orderNo}`), [orderNo]);
  const bad = data?.verdict === 'TAMPERED';
  return (
    <div className="min-h-screen bg-paper px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link to="/login" className="flex items-center gap-2 text-brand"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-gold"><Icon name="shield" size={20} /></span><b className="text-xl">JaanchSetu</b></Link>
          <LanguagePicker />
        </div>
        <h1 className="h-page mb-1">{t('Check a release / refund order')}</h1>
        <p className="mb-4 text-sm text-stone-600">{t('Order')} <b className="font-mono">{orderNo}</b></p>

        {error && (
          <div role="alert" className="card !border-red-300"><div className="flex items-start gap-3"><Icon name="alert" size={22} className="mt-0.5 text-red-700" />
            <div><b className="text-red-800">{t('No such order')}</b><p className="text-sm text-stone-700">{error}</p><p className="mt-2 text-xs text-stone-500">{t('Check the order number on the document, or scan the QR code again.')}</p></div></div></div>)}

        {!data && !error && <div className="card text-sm text-stone-600">{t('Checking…')}</div>}

        {data && (
          <>
            <div role="status" className={`card ${bad ? '!border-red-400 !bg-red-50' : '!border-brand'}`}>
              <div className="flex items-start gap-3">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${bad ? 'bg-red-600 text-white' : 'bg-brand text-gold'}`}><Icon name={bad ? 'alert' : 'shield'} size={22} /></span>
                <div>
                  <h2 className={`text-lg font-extrabold ${bad ? 'text-red-800' : 'text-brand'}`}>{bad ? t('This order does NOT match the audit trail') : t('This order matches the audit trail')}</h2>
                  <p className="text-sm text-stone-700">{bad ? t('Something in this order, or in the log it is tied to, has changed since it was issued. Do not rely on it.') : t('Nothing in it has changed since it was issued, and the audit-trail entry it is tied to is intact.')}</p>
                </div>
              </div>
              {bad && data.reasons?.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-red-900">{data.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
            </div>

            <dl className="card mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="lbl">{t('Institution')}</dt><dd className="font-semibold">{data.institution}</dd></div>
              <div><dt className="lbl">{t('FDR number')}</dt><dd className="font-mono font-semibold">{data.fdrNumberMasked}</dd></div>
              <div><dt className="lbl">{t('Decision')}</dt><dd className="font-semibold">{t('Approved')}{data.approvedOn ? ` · ${dmy(data.approvedOn)}` : ''}</dd></div>
              <div><dt className="lbl">{t('Issued')}</dt><dd className="font-semibold">{dt(data.issuedAt)}</dd></div>
              <div><dt className="lbl">{t('Audit-trail entry')}</dt><dd className="font-semibold">#{data.auditEntry}</dd></div>
              <div><dt className="lbl">{t('Whole audit trail intact')}</dt><dd className={`font-semibold ${data.chainIntact ? '' : 'text-red-700'}`}>{data.chainIntact ? t('Yes') : t('No')}</dd></div>
            </dl>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900"><Icon name="info" size={14} className="mt-0.5 shrink-0" />{t(data.notice)}</p>
          </>)}
        <p className="mt-6 text-center text-xs text-stone-600">{t('Prototype for SIH 2026. Not an official AICTE system. No real bank integration.')}</p>
      </div>
    </div>
  );
}
