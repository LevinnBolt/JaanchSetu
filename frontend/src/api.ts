import { localeOf } from './i18n';
const TOKEN = 'sakshi_token';
export const getToken = () => localStorage.getItem(TOKEN);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN));

export class ApiError extends Error {}

async function parse(res: Response) {
  if (res.status === 401 && getToken()) {
    setToken(null);
    location.href = '/login';
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const m = body?.message;
    throw new ApiError(Array.isArray(m) ? m.join(' ') : m || `Request failed (${res.status})`);
  }
  return body;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  return parse(await fetch('/api' + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body }));
}

/** Download a file through the authorised API (the token is needed, so a plain link would not work). */
export async function download(path: string, filename: string, open = false) {
  const res = await fetch('/api' + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError('Download failed');
  const url = URL.createObjectURL(await res.blob());
  if (open) window.open(url, '_blank');
  else { const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : '₹' + n.toLocaleString('en-IN'));
export const dmy = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T00:00:00Z' : s).toLocaleDateString(localeOf(), { day: '2-digit', month: 'short', year: 'numeric', timeZone: s && s.length === 10 ? 'UTC' : undefined }) : '—');
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(localeOf(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
