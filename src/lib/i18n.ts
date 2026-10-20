export type SiteLanguage = 'ja' | 'en';
export const LANGUAGE_KEY = 'kuas-site-language';
export const ENGLISH_PAGES = ['', 'about', 'join', 'contact', 'schedule', 'trips', 'learn',
  'learn/shutter-speed', 'learn/aperture', 'learn/focal-length', 'learn/darkroom'] as const;

export function preferredLanguage(saved: string | null, languages: readonly string[]): SiteLanguage {
  if (saved === 'ja' || saved === 'en') return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base === 'ja' || base === 'en') return base;
  }
  return 'en';
}

export function languagePath(path: string, lang: SiteLanguage): string {
  const clean = path.replace(/^\/en(?=\/|$)/, '').replace(/^\/+|\/+$/g, '');
  if (clean === 'guidelines' || clean === 'guidelines/en') return lang === 'ja' ? '/guidelines/' : '/guidelines/en/';
  if (lang === 'ja') return clean ? `/${clean}/` : '/';
  if (ENGLISH_PAGES.some(page => page === clean)) return clean ? `/en/${clean}/` : '/en/';
  if (clean.startsWith('trips/')) return '/en/trips/';
  return '/en/';
}

export function supportsLanguagePreference(path: string): boolean {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return ENGLISH_PAGES.some(page => page === clean) || clean === 'guidelines';
}

/** The language of the page a browser script is running on (from <html lang>). */
export function pageLanguage(): SiteLanguage {
  return typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'ja';
}
