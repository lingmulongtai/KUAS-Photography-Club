import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { languagePath } from '../src/lib/i18n.ts';
const source = readFileSync(new URL('../src/components/CampusGuide.astro', import.meta.url), 'utf8');
test('campus guides have a reciprocal Japanese/English route', () => {
  assert.equal(languagePath('/campus-guide/', 'en'), '/en/campus-guide/');
  assert.equal(languagePath('/en/campus-guide/', 'ja'), '/campus-guide/');
});
test('guide labels its publisher, exercise status and official campus sources', () => {
  for (const required of ['大学当局の公式案内ではありません', 'not the university administration', '開催予定の撮影会', 'not announced club events', 'https://www.kuas.ac.jp/campus/uzumasa/', 'https://www.kuas.ac.jp/campus/kameoka/', 'https://www.kuas.ac.jp/campus/access/']) assert.ok(source.includes(required), required);
  assert.ok(!source.includes('photos/samples/'), 'Never present learning illustrations as actual campus photographs');
});
test('the self-checklist does not submit visitor information', () => {
  assert.match(source, /type="checkbox"/);
  assert.match(source, /type="reset"/);
  assert.ok(!source.includes('type="submit"'));
  assert.ok(!source.includes('<script'));
  assert.ok(!source.includes('action='));
});
