import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredLanguage, languagePath, supportsLanguagePreference, ENGLISH_PAGES } from '../src/lib/i18n.ts';

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
