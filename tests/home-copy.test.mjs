import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bilingualHome } from '../src/lib/home-copy.ts';

const page = (title, body) => '<!doctype html><html><head><title>' + title + '</title></head><body>' + body + '</body></html>';

test('translations preserve native scripts and controls and keep rich copy inside the JSON payload', () => {
  const ja = page('日本語', '<script type="module" src="/scene.js"></script><label>季節<select><option>秋</option></select></label><p>京都<br>写真部</p>');
  const en = page('English', '<label>Season<select><option>Autumn</option></select></label><p>&lt;/script&gt; Club</p>');
  for (const [primary, other, lang] of [[ja, en, 'ja'], [en, ja, 'en']]) {
    const html = bilingualHome(primary, other, lang);
    const raw = html.match(/id="home-copy">([\s\S]*?)<\/script>/)[1];
    const copy = JSON.parse(raw);
    assert.deepEqual(copy.title, ['日本語', 'English']);
    assert.ok(copy.elements.flat().some(([key, a, b]) => key === 0 && a === '季節' && b === 'Season'));
    assert.equal(copy.elements.flat().filter(([key]) => key === '#html').length, 1);
    assert.ok(!raw.includes('<'));
    assert.equal((html.match(/<select>/g) || []).length, 1);
    assert.equal(html.includes('<script type="module" src="/scene.js"></script>'), lang === 'ja');
  }
});

test('a layout mismatch cannot replace the live canvas', () => {
  assert.throws(() => bilingualHome(page('JA', '<section><canvas></canvas></section>'),
    page('EN', '<section><p>Scenery</p></section>'), 'ja'), /interactive home elements/);
});
