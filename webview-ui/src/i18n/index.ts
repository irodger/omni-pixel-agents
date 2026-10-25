import { useEffect, useSyncExternalStore } from 'react';

import type { Language } from './catalog.js';
import { translate } from './catalog.js';
export type { Language } from './catalog.js';
export { localeName, translate } from './catalog.js';

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem('opa.language');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* Optional browser preference. */
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('ru') ? 'ru' : 'en';
}
let language: Language = initialLanguage();
const listeners = new Set<() => void>();
export function t(key: string, values: Record<string, string | number> = {}): string {
  return translate(key, language, values);
}
export function setLanguage(next: Language): void {
  language = next;
  try {
    localStorage.setItem('opa.language', next);
  } catch {
    /* Still switch in memory. */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  const locale = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => language,
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return { language: locale, setLanguage, t };
}
