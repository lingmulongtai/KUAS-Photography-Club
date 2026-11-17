import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'dist/client');
const origin = 'https://kuas-photography-club.vercel.app';
const index = readFileSync(join(root, 'sitemap-index.xml'), 'utf8');
const sitemapUrls = [...index.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
assert.ok(sitemapUrls.length > 0, 'Sitemap index must reference a sitemap');
const urls = new Set();
for (const mapUrl of sitemapUrls) {
  assert.equal(new URL(mapUrl).origin, origin);
  const xml = readFileSync(join(root, new URL(mapUrl).pathname), 'utf8');
  for (const [,url] of xml.matchAll(/<loc>(.*?)<\/loc>/g)) {
    assert.equal(new URL(url).origin, origin);
    assert.ok(!/\/(?:admin(?:\/|$)|api(?:\/|$)|404|admin-build)/.test(new URL(url).pathname), `Non-public sitemap URL: ${url}`);
    assert.ok(!urls.has(url), `Duplicate sitemap URL: ${url}`);
    urls.add(url);
    assert.ok(existsSync(join(root, new URL(url).pathname, 'index.html')), `Missing sitemap target: ${url}`);
  }
}
function verify(dir) {
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) { verify(path); continue; }
    if (!file.name.endsWith('.html')) continue;
    const html = readFileSync(path, 'utf8');
    if (/<meta name="robots" content="noindex/.test(html)) continue;
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    assert.ok(canonical && urls.has(canonical), `Public page missing from sitemap: ${path} (${canonical})`);
    for (const [, href] of html.matchAll(/<link rel="alternate" hreflang="[^"]+" href="([^"]+)"/g)) {
      assert.ok(urls.has(href), `Language alternate missing: ${href}`);
    }
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(json, `Missing structured data: ${path}`);
    const graph = JSON.parse(json)['@graph'];
    assert.equal(graph[0]['@type'], 'Organization');
    assert.equal(graph[1]['@type'], 'WebSite');
    assert.equal(graph[1].url, origin + '/');
  }
}
verify(root);
assert.ok(readFileSync(join(root, 'robots.txt'), 'utf8').includes(`Sitemap: ${origin}/sitemap-index.xml`));
assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /<title>京都先端科学大学写真部 \| KUAS Photography Club<\/title>/);
console.log(`SEO build verified: ${urls.size} public sitemap URLs, canonical/hreflang targets and JSON-LD.`);

const home = readFileSync(join(root, 'index.html'), 'utf8');
const mainHeading = home.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '');
assert.equal(mainHeading, '京都先端科学大学写真部', 'Homepage must clearly identify the club in its main heading');
assert.match(home, /<meta name="description" content="京都先端科学大学写真部（KUAS Photography Club）/);
assert.match(home, /name="google-site-verification"/);

// The campus guide remains discoverable, bilingual and clearly student-run.
for (const route of ['campus-guide/index.html', 'en/campus-guide/index.html']) {
  const guide = readFileSync(join(root, route), 'utf8');
  assert.match(guide, /hreflang="ja" href="https:\/\/kuas-photography-club.vercel.app\/campus-guide\/"/);
  assert.match(guide, /hreflang="en" href="https:\/\/kuas-photography-club.vercel.app\/en\/campus-guide\/"/);
  assert.equal([...guide.matchAll(/<input[^>]+type="checkbox"/g)].length, 5);
  assert.match(guide, /type="reset"/);
  assert.ok(!guide.includes('type="submit"'));
  assert.equal([...guide.matchAll(/<h1\b/g)].length, 1);
  assert.ok(guide.includes(route.startsWith('en/') ? 'not the university administration' : '大学当局の公式案内ではありません'));
}
