import { LANGUAGE_KEY, languagePath, preferredLanguage, supportsLanguagePreference } from '../lib/i18n';

// Browser language stays on the device. An explicit choice takes precedence.
let saved: string | null = null;
try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { /* Storage may be blocked. */ }
const current = document.documentElement.lang === 'en' ? 'en' : 'ja';
const preferred = preferredLanguage(saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
if (current === 'ja' && preferred === 'en' && supportsLanguagePreference(location.pathname)) {
  location.replace(languagePath(location.pathname, 'en') + location.search + location.hash);
}

document.querySelectorAll<HTMLAnchorElement>('[data-language]').forEach(link => {
  link.addEventListener('click', () => {
    try { localStorage.setItem(LANGUAGE_KEY, link.dataset.language!); } catch { /* Links still work. */ }
  });
});
