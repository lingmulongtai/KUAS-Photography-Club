#!/usr/bin/env node
/*
 * Saves the photo of each post listed in src/data/instagram-posts.json to public/instagram/,
 * so the site shows the club's Instagram posts from its own files in every browser.
 * Instagram's own embed is blocked by tracking protection, ad blockers and some in-app browsers.
 *
 *   npm run instagram            fetch photos the list has but public/instagram/ lacks
 *   npm run instagram -- --prune also delete photos of posts no longer listed
 *
 * Each photo comes from the post's public media link and is cropped to 4:5 at 480×600.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const list = new URL('src/data/instagram-posts.json', root);
const dir = new URL('public/instagram/', root);
const posts = JSON.parse(await readFile(list, 'utf8'));

const shortcode = (url) => /^https:\/\/www\.instagram\.com\/(?:p|reel)\/([\w-]+)\/$/.exec(url)?.[1];

await mkdir(dir, { recursive: true });
let fetched = 0;
for (const post of posts) {
  const code = shortcode(post.url);
  if (!code) throw new Error(`Not an Instagram post link (https://www.instagram.com/p/…/): ${post.url}`);
  const file = new URL(`${code}.webp`, dir);
  if (existsSync(file)) continue;
  const res = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`);
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(`Could not download ${post.url} (${res.status}). Is the post public?`);
  const photo = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(480, 600, { fit: 'cover', position: 'attention' }).webp({ quality: 78 }).toBuffer();
  await writeFile(file, photo);
  fetched++;
  console.log(`saved public/instagram/${code}.webp`);
}

if (process.argv.includes('--prune')) {
  const keep = new Set(posts.map((p) => `${shortcode(p.url)}.webp`));
  for (const name of await readdir(dir)) {
    if (name.endsWith('.webp') && !keep.has(name)) {
      await rm(new URL(name, dir));
      console.log(`removed public/instagram/${name}`);
    }
  }
}
console.log(fetched ? `${fetched} photo(s) saved.` : 'All listed photos are already saved.');
