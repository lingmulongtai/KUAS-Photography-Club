import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const posts = JSON.parse(readFileSync(new URL('src/data/instagram-posts.json', root), 'utf8'));
const code = (url) => /^https:\/\/www\.instagram\.com\/(?:p|reel)\/([\w-]+)\/$/.exec(url)?.[1];

test('every listed post links to Instagram and describes its photo in both languages', () => {
  assert.ok(posts.length >= 3 && posts.length % 3 === 0, 'the grid shows whole rows of three');
  for (const post of posts) {
    assert.ok(code(post.url), `post link: ${post.url}`);
    assert.ok(post.ja?.trim() && post.en?.trim(), `alt text for ${post.url}`);
  }
  assert.equal(new Set(posts.map((p) => code(p.url))).size, posts.length, 'no post listed twice');
});

test('the site serves its own copy of each listed photo, and only those', () => {
  const saved = readdirSync(new URL('public/instagram/', root)).filter((name) => name.endsWith('.webp'));
  for (const post of posts) assert.ok(existsSync(new URL(`public/instagram/${code(post.url)}.webp`, root)), `run npm run instagram for ${post.url}`);
  assert.deepEqual(saved.sort(), posts.map((p) => `${code(p.url)}.webp`).sort(), 'run npm run instagram -- --prune');
});
