import { useSyncExternalStore } from 'react';
import hi from './i18n/hi';
import ta from './i18n/ta';
import mr from './i18n/mr';

/**
 * Interface languages. Every screen text goes through t('English text'); a language file maps that English text to
 * the translation. Anything not translated (long help text, messages that come from the server) falls back to English.
 * To add a language: create src/i18n/<code>.ts, import it here and add one line to LANGS.
 */
export interface Lang { code: string; native: string; english: string; locale: string; /** true = partly translated, needs a native speaker's review */ beta?: boolean }
export const LANGS: Lang[] = [
  { code: 'en', native: 'English', english: 'English', locale: 'en-GB' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', locale: 'hi-IN' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', locale: 'ta-IN' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', locale: 'mr-IN' },
];
const DICT: Record<string, Record<string, string>> = { hi, ta, mr };
const STORE = 'jaanchsetu_lang';

const read = (): string => {
  try { const v = localStorage.getItem(STORE); if (v && LANGS.some((l) => l.code === v)) return v; } catch { /* storage blocked */ }
  return 'en';
};
let current = read();
const subs = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function setLang(code: string) {
  if (!LANGS.some((l) => l.code === code) || code === current) return;
  current = code;
  try { localStorage.setItem(STORE, code); } catch { /* the choice just won't be remembered */ }
  document.documentElement.lang = code;
  subs.forEach((f) => f());
}
export const getLang = () => current;
export const useLang = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
export const localeOf = () => LANGS.find((l) => l.code === current)?.locale || 'en-GB';

/** Wrap a { key: English } lookup so reading a value gives the translation (works with Object.entries too). */
export const translated = <T extends Record<string, string>>(o: T): T =>
  new Proxy(o, { get: (target, k) => { const v = (target as Record<string | symbol, unknown>)[k]; return typeof v === 'string' ? t(v) : v; } });

/** Translate. `vars` fills {placeholders}. Missing translations show the English text. */
/** Phrases looked up in a non-English language that have no translation yet (read by the test sweep: window.__i18nMissing). */
const missing = new Set<string>();
if (typeof window !== 'undefined') (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;

export function t(text: string, vars?: Record<string, string | number>): string {
  if (current !== 'en' && !DICT[current]?.[text] && /[A-Za-z]{3,}/.test(text)) missing.add(text);
  let out = (current !== 'en' && DICT[current]?.[text]) || text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
