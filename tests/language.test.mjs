import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredLanguage, languagePath, supportsLanguagePreference, ENGLISH_PAGES, HOME_LANGUAGE_SWITCH_HASH, LANGUAGE_KEY } from '../src/lib/i18n.ts';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

test('explicit preference wins; the first supported browser language selects the first visit', () => {
  assert.equal(preferredLanguage('ja', ['en-US']), 'ja');
  assert.equal(preferredLanguage('en', ['ja-JP']), 'en');
  assert.equal(preferredLanguage(null, ['ja-JP', 'en-US']), 'ja');
  assert.equal(preferredLanguage(null, ['en-GB', 'ja']), 'en');
  assert.equal(preferredLanguage('invalid', ['fr-FR', 'ja']), 'ja');
  assert.equal(preferredLanguage(null, ['fr-FR']), 'en');
  assert.equal(preferredLanguage(null, []), 'en');
});

test('language pairs round trip and guidelines retain their existing English URL', () => {
  for (const page of ENGLISH_PAGES) {
    const ja = page ? `/${page}/` : '/';
    const en = page ? `/en/${page}/` : '/en/';
    assert.equal(languagePath(ja, 'en'), en);
    assert.equal(languagePath(en, 'ja'), ja);
    assert.equal(languagePath(en, 'en'), en);
  }
  assert.equal(languagePath('/guidelines/', 'en'), '/guidelines/en/');
  assert.equal(languagePath('/guidelines/en/', 'ja'), '/guidelines/');
  assert.equal(supportsLanguagePreference('/admin/'), false);
  assert.equal(supportsLanguagePreference('/guidelines/ko/'), false);
  assert.equal(languagePath('/trips/spots/gion/', 'en'), '/en/trips/');
});

const source = readFileSync(new URL('../src/scripts/language.ts', import.meta.url), 'utf8').replace(/^import [^\n]+;\s*/gm, '');
const languageScript = stripTypeScriptTypes(source);

function visit(href, { lang = 'ja', saved = null, storage = true, preview = false, links = [] } = {}) {
  const document = {
    documentElement: { lang, classList: { contains: name => preview && name === 'screenshot-preview' } },
    getElementById: () => null,
    querySelectorAll: selector => selector === 'a[href^="/"]' ? links : [],
  };
  const location = new URL(href, 'https://club.example');
  let redirected = null;
  location.replace = url => { redirected = url; };
  const history = {
    state: { entry: 1 },
    replaceState(state, _title, url) {
      assert.equal(state, this.state);
      location.href = url.href;
    },
  };
  const localStorage = storage ? {
    getItem: () => saved,
    setItem(key, value) { assert.equal(key, LANGUAGE_KEY); saved = value; },
  } : undefined;
  const navigator = { languages: ['en-US'], language: 'en-US' };
  runInNewContext(languageScript, { document, location, history, localStorage, navigator, URL, URLSearchParams,
    HOME_LANGUAGE_SWITCH_HASH, LANGUAGE_KEY, languagePath, preferredLanguage, supportsLanguagePreference });
  return { redirected, saved, location };
}

test('first visits keep the requested locale; only an explicit preference redirects', () => {
  assert.equal(visit('/', { preview: true }).redirected, null);
  assert.equal(visit('/').redirected, null);
  assert.equal(visit('/', { saved: 'en' }).redirected, '/en/');
  assert.equal(visit('/', { saved: 'ja' }).redirected, null);
  assert.equal(visit('/', { preview: true, saved: 'en' }).redirected, null);
});

test('either home switch selects the destination once, even when opened in another tab', () => {
  for (const [path, lang, previous] of [['/', 'ja', 'en'], ['/en/', 'en', 'ja']]) {
    const href = path + '?view=inariRidge&lang=' + previous + HOME_LANGUAGE_SWITCH_HASH;
    const result = visit(href, { lang, saved: previous });
    assert.equal(result.redirected, null);
    assert.equal(result.saved, lang);
    assert.equal(result.location.search, '?view=inariRidge');
    assert.equal(result.location.hash, '');

    const blocked = visit(href, { lang, storage: false });
    assert.equal(blocked.redirected, null);
    assert.equal(blocked.location.search, '?view=inariRidge&lang=' + lang);
    assert.equal(blocked.location.hash, '');
  }
  const otherPage = visit('/about/' + HOME_LANGUAGE_SWITCH_HASH);
  assert.equal(otherPage.saved, null);
  assert.equal(otherPage.location.hash, HOME_LANGUAGE_SWITCH_HASH);
});

test('with storage blocked, content links carry the current language and the switch carries its destination', () => {
  function link(path, language) {
    return {
      path, dataset: { language },
      get href() { return new URL(this.path, 'https://club.example').href; },
      setAttribute(name, value) { assert.equal(name, 'href'); this.path = value; },
    };
  }
  const content = link('/en/trips/?page=2#photos'), toggle = link('/#switch-language', 'ja');
  visit('/en/?lang=en', { lang: 'en', storage: false, links: [content, toggle] });
  assert.equal(content.path, '/en/trips/?page=2&lang=en#photos');
  assert.equal(toggle.path, '/?lang=ja#switch-language');
});
