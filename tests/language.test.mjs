import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredLanguage, languagePath, supportsLanguagePreference, ENGLISH_PAGES, LANGUAGE_KEY } from '../src/lib/i18n.ts';
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

test('the deployment thumbnail keeps the Japanese home while regular browsers use their language', () => {
  const source=readFileSync(new URL('../src/scripts/language.ts',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
  const script=stripTypeScriptTypes(source);
  const redirectFor=(preview)=>{
    let redirected=null;
    const document={documentElement:{lang:'ja',classList:{contains:name=>preview && name==='screenshot-preview'}},querySelectorAll:()=>[]};
    const location={search:'',hash:'',pathname:'/',replace:url=>{redirected=url;}};
    runInNewContext(script,{document,location,navigator:{languages:['en-US'],language:'en-US'},localStorage:{getItem:()=>null},
      URLSearchParams,LANGUAGE_KEY,languagePath,preferredLanguage,supportsLanguagePreference});
    return redirected;
  };
  assert.equal(redirectFor(true),null);
  assert.equal(redirectFor(false),'/en/');
});
