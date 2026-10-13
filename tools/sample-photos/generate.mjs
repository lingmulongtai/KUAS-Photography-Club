// Renders the painted placeholder photos listed in manifest.json into public/photos/samples/.
// Not part of the site build. Needs Playwright with a Chromium browser:
//   npx playwright install chromium && node tools/sample-photos/generate.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const painters = readFileSync(join(here, 'painters.js'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: painters });

for (const [slug, shots] of Object.entries(manifest)) {
  const dir = join(root, 'public', 'photos', 'samples', slug);
  mkdirSync(dir, { recursive: true });
  for (const [i, shot] of shots.entries()) {
    const url = await page.evaluate(({ kind, seed, rest }) => window.renderSample(kind, seed, rest), {
      kind: shot.kind,
      seed: shot.seed,
      rest: shot,
    });
    const file = join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', file.replace(root + '/', ''));
  }
}
await browser.close();
