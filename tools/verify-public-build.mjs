import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';

const output = resolve(process.argv[2] ?? 'dist/client');
const html = [];
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) walk(path);
    else if (item.name.endsWith('.html')) html.push([relative(output, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]);
  }
}
walk(output);
assert.ok(html.length > 20, 'A complete prerendered site is required');
const byPath = new Map(html);
for (const route of ['index.html', 'about/index.html', 'join/index.html', 'schedule/index.html', 'trips/index.html',
  'contact/index.html', 'guidelines/index.html', 'guidelines/en/index.html', 'learn/index.html',
  'en/index.html', 'en/about/index.html', 'en/join/index.html', 'en/schedule/index.html', 'en/trips/index.html', 'en/contact/index.html']) {
  assert.ok(byPath.has(route), `Missing public route ${route}`);
}
const sampleSlugs = readdirSync('src/content/trips').filter(file => {
  const data = parse(readFileSync(join('src/content/trips', file), 'utf8').split('---')[1]);
  return data.sample || data.draft;
}).map(file => file.replace(/\.md$/, ''));
for (const slug of sampleSlugs) assert.ok(!existsSync(join(output, 'trips', slug, 'index.html')), `Sample route published: ${slug}`);
for (const [path, source] of html) {
  assert.ok(!/名前を入れてください|ここは仮の文章です|実際の手続きに合わせて|55名|55人|月に2回|月2回/.test(source), `Unverified copy: ${path}`);
  for (const slug of sampleSlugs) assert.ok(!source.includes(`/trips/${slug}/`), `Sample link or payload in ${path}: ${slug}`);
  const labelledErrorDemo = path === '404.html' && source.includes('学習用図解');
  if (!path.startsWith('learn/') && !labelledErrorDemo) assert.ok(!source.includes('/photos/samples/'), `Learning-only illustration exposed as public photography: ${path}`);
  // Verify every local HTML navigation target, including language switches.
  for (const match of source.matchAll(/\shref="(\/[^"?#]*)[^"\s]*"/g)) {
    const href = decodeURIComponent(match[1]);
    if (/\.[a-z0-9]+$/i.test(href)) continue;
    assert.ok(existsSync(join(output, href, 'index.html')), `Broken local page in ${path}: ${href}`);
  }
}
for (const path of ['schedule/index.html', 'en/schedule/index.html']) {
  const source = byPath.get(path);
  assert.ok(source.includes('2026-10-23'), `Missing confirmed cancellation: ${path}`);
  assert.ok(!/<li[^>]*data-date="2026-(?:10-(?:24|30|31)|11-(?:14|20|28))"/.test(source), `Sample event published: ${path}`);
  assert.ok(!/k-meeting[^>]*data-date="2026-10-23"/.test(source), `Cancelled meeting generated: ${path}`);
}
for (const id of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'ko', 'pt', 'zh-CN']) {
  assert.ok(!existsSync(join(output, 'guidelines', id, 'index.html')), `Historical translation published: ${id}`);
}
assert.match(byPath.get('en/join/index.html'), /JPY 1,000/);
assert.match(byPath.get('join/index.html'), /1,000円/);
assert.match(byPath.get('en/join/index.html'), /chat alone does not complete membership/);
for (const path of ['index.html', 'about/index.html', 'en/index.html', 'en/about/index.html']) {
  const source = byPath.get(path);
  const section = source.match(/<section\b[^>]*aria-labelledby="insta-title"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(section, `Missing Instagram section: ${path}`);
  const iframe = section.match(/<iframe\b[^>]*>/)?.[0];
  assert.ok(iframe, `Missing official Instagram embed: ${path}`);
  assert.match(iframe, /src="https:\/\/www\.instagram\.com\/kuas_photographyclub\/embed\/"/);
  assert.match(iframe, /loading="lazy"/);
  assert.match(iframe, path.startsWith('en/') ? /title="[^"]*Instagram profile and posts"/ : /title="[^"]*プロフィールと投稿"/);
  // The profile remains reachable when Instagram or scripts are blocked.
  assert.match(section.replace(/<iframe\b[\s\S]*?<\/iframe>/g, ''), /<a\b[^>]*href="https:\/\/www\.instagram\.com\/kuas_photographyclub"/);
}
console.log(`Public output verified: ${html.length} HTML files, ${sampleSlugs.length} sample trip routes excluded, local links intact.`);
