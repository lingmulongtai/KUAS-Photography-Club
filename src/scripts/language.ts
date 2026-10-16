import { LANGUAGE_KEY, languagePath, preferredLanguage, supportsLanguagePreference } from '../lib/i18n';

// Browser language stays on the device. An explicit choice takes precedence.
let saved: string | null = null;
let storageAvailable = true;
try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { storageAvailable = false; }
const requested = new URLSearchParams(location.search).get('lang');
const explicit = requested === 'ja' || requested === 'en' ? requested : null;
if (explicit) {
  saved = explicit;
  try { localStorage.setItem(LANGUAGE_KEY, explicit); } catch { storageAvailable = false; }
}
const current = document.documentElement.lang === 'en' ? 'en' : 'ja';
const preferred = preferredLanguage(saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
if (current === 'ja' && preferred === 'en' && supportsLanguagePreference(location.pathname)) {
  location.replace(languagePath(location.pathname, 'en') + location.search + location.hash);
}

document.querySelectorAll<HTMLAnchorElement>('[data-language]').forEach(link => {
  link.addEventListener('click', () => {
    try { localStorage.setItem(LANGUAGE_KEY, link.dataset.language!); } catch {
      // Keep manual switching usable even when all browser storage is blocked.
      const target = new URL(link.href);
      target.searchParams.set('lang', link.dataset.language!);
      link.href = target.href;
    }
  });
});

if (!storageAvailable && explicit) {
  document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach(link => {
    const target = new URL(link.href);
    if (target.origin !== location.origin) return;
    target.searchParams.set('lang', explicit);
    link.href = target.href;
  });
}
