import { HOME_LANGUAGE_SWITCH_HASH, LANGUAGE_KEY, languagePath, supportsLanguagePreference } from '../lib/i18n';

// Browser language stays on the device. An explicit choice takes precedence.
let saved: string | null = null;
let storageAvailable = true;
try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { storageAvailable = false; }
const current = document.documentElement.lang === 'en' ? 'en' : 'ja';
const switchingHome = location.hash === HOME_LANGUAGE_SWITCH_HASH && languagePath(location.pathname, 'ja') === '/';
const requested = switchingHome ? current : new URLSearchParams(location.search).get('lang');
const explicit = requested === 'ja' || requested === 'en' ? requested : null;
if (explicit) {
  saved = explicit;
  try { localStorage.setItem(LANGUAGE_KEY, explicit); } catch { storageAvailable = false; }
}
if (switchingHome) {
  const target = new URL(location.href);
  target.hash = '';
  if (storageAvailable) target.searchParams.delete('lang');
  else target.searchParams.set('lang', current);
  history.replaceState(history.state, '', target);
}
// Keep each locale URL stable on first visit, including search-engine rendering.
// Only an explicit, saved visitor choice may redirect the Japanese page.
const preferred = saved === 'en' ? 'en' : 'ja';
if (current === 'ja' && preferred === 'en' && !document.documentElement.classList.contains('screenshot-preview') && supportsLanguagePreference(location.pathname)) {
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
