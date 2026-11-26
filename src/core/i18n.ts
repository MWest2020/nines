// Strings come from locale files only. t() looks a key up in the chosen locale, falls back to
// English, and fills {placeholders}. A missing key renders as the key itself so it is visible;
// the content validator makes sure that never ships.

import type { LocaleId, LocaleMap } from '../content/types';

export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

export function interpolate(template: string, params: Params = {}): string {
  return template.replace(/\{([a-z0-9_]+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function createTranslator(locales: Record<LocaleId, LocaleMap>, locale: LocaleId): Translate {
  return (key, params) => {
    const template = locales[locale][key] ?? locales.en[key] ?? key;
    return interpolate(template, params);
  };
}

/** The first visit picks Dutch for a Dutch device and English otherwise; the toggle overrides it. */
export function defaultLocale(languages: readonly string[]): LocaleId {
  return languages.some((l) => l.toLowerCase().startsWith('nl')) ? 'nl' : 'en';
}
