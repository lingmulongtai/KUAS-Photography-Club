import type { HomeCopy } from '../lib/home-copy';
import { HOME_LANGUAGE_SWITCH_HASH, languagePath, type SiteLanguage } from '../lib/i18n';

// Preserve the text node next to an inline control (the hero also holds a reference to its camera hint).
function setTextSlot(el: Element, index: number, value: string) {
  const elements = Array.from(el.children).filter(child => !child.matches('script, style, noscript'));
  const end = elements[index] ?? null;
  let node = index === 0 ? el.firstChild : elements[index - 1]?.nextSibling;
  let text: Text | undefined;
  while (node && node !== end) {
    const next = node.nextSibling;
    if (node instanceof Text) {
      if (text) node.remove();
      else text = node;
    }
    node = next;
  }
  if (text) text.data = value;
  else el.insertBefore(document.createTextNode(value), end);
}

export function mountHomeLanguage(source: Element, remember: (lang: SiteLanguage) => boolean, carryInLinks: (lang: SiteLanguage) => void) {
  const toggle = document.querySelector<HTMLAnchorElement>('.site-header .language-switch')!;
  // Only parse the translations if the visitor actually switches languages.
  let copy: HomeCopy | undefined;
  function show(lang: SiteLanguage, navigation: 'push' | 'replace' | 'pop') {
    const stored = remember(lang);
    const url = new URL(location.href);
    url.pathname = languagePath('/', lang);
    if (stored) url.searchParams.delete('lang');
    else url.searchParams.set('lang', lang);
    if (url.hash === HOME_LANGUAGE_SWITCH_HASH) url.hash = '';
    if (navigation === 'push') history.pushState(history.state, '', url);
    else if (url.href !== location.href) history.replaceState(history.state, '', url);
    if (lang === document.documentElement.lang) return;

    copy ??= JSON.parse(source.textContent!) as HomeCopy;
    const side = lang === 'ja' ? 1 : 2;
    document.dispatchEvent(new Event('home:before-language'));
    document.documentElement.lang = lang;
    document.title = copy.title[side - 1];
    for (const el of document.querySelectorAll<HTMLElement>('[data-home-copy]')) {
      for (const field of copy.elements[Number(el.dataset.homeCopy)]) {
        const [key] = field, value = field[side];
        if (typeof key === 'number') setTextSlot(el, key, value!);
        else if (key === '#html') el.innerHTML = value!; // Build-time checked inline formatting.
        else if (value === null) el.removeAttribute(key);
        else el.setAttribute(key, value);
      }
    }
    document.dispatchEvent(new Event('home:language'));
    if (!stored) carryInLinks(lang);
  }
  toggle.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        (toggle.target && toggle.target !== '_self')) return;
    event.preventDefault();
    show(toggle.dataset.language === 'en' ? 'en' : 'ja', 'push');
  });
  window.addEventListener('popstate', () => {
    const lang = location.pathname === '/' ? 'ja' : 'en';
    if (lang !== document.documentElement.lang && languagePath(location.pathname, 'ja') === '/') show(lang, 'pop');
  });
  return show;
}
