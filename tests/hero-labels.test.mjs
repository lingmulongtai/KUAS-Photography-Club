import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SPOTS } from '../src/data/spots.ts';
import { REGIONAL_PLACES, EXTRA_LANDMARKS, VIEWS } from '../src/scripts/hero/views.ts';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const Module = require('node:module');

async function loadLabelsModule() {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `export { ALL_PINS, LABELS, isSightlineBlocked } from './src/scripts/hero/labels.ts';`,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const mod = new Module(import.meta.url);
  mod.filename = import.meta.filename;
  mod.paths = require.resolve.paths('three') ?? [];
  mod._compile(result.outputFiles[0].text, import.meta.filename);
  return mod.exports;
}

test('ALL_PINS covers core spots, regional outings and extra landmarks with valid destinations and unique IDs', async () => {
  const { ALL_PINS, LABELS } = await loadLabelsModule();
  assert.equal(LABELS.length, SPOTS.length);
  assert.equal(ALL_PINS.length, SPOTS.length + REGIONAL_PLACES.length + EXTRA_LANDMARKS.length);
  const ids = new Set(ALL_PINS.map((p) => p.id));
  assert.equal(ids.size, ALL_PINS.length, 'all 3D pin IDs are unique');

  for (const pin of ALL_PINS) {
    assert.ok(pin.ja.length > 0 && pin.en.length > 0, `bilingual labels present for ${pin.id}`);
    assert.ok(pin.above >= 10 && pin.above <= 160, `sane anchor elevation for ${pin.id}`);
    if (pin.destination !== 'campus') {
      assert.ok(pin.destination in VIEWS, `destination ${pin.destination} exists in VIEWS`);
    }
  }

  // Representative pins span Kyoto, Shiga, Osaka, Nara and Hyogo.
  for (const expected of ['tower', 'kuas', 'region-biwako-fireworks', 'region-setagawa', 'hikone', 'hiei', 'region-osaka-castle', 'region-expo-2025', 'region-nara-park', 'todaiji', 'kasuga', 'region-meriken', 'region-aquarium', 'region-nanzenji']) {
    assert.ok(ids.has(expected), `expected 3D pin ${expected} is registered`);
  }
});

test('isSightlineBlocked clears hillside landmarks up close while still hiding pins behind real ridges', async () => {
  const { isSightlineBlocked } = await loadLabelsModule();
  // Sloping hillside rising toward a temple at x=400 (ground=120, above=40): should NOT self-occlude!
  const gentleSlope = (x) => 40 + (Math.max(0, Math.min(400, x)) / 400) * 80 + (x > 340 ? 6 : 0);
  assert.equal(
    isSightlineBlocked({ x: 0, y: 150, z: 0 }, { x: 400, y: 120, z: 0 }, 40, gentleSlope),
    false,
    'nearby hillside temple roof remains visible',
  );

  // Genuine 350 m mountain ridge midway between camera (x=0, y=180) and valley city (x=4000, y=60): MUST occlude!
  const ridge = (x) => (x > 1600 && x < 2400 ? 420 : 60);
  assert.equal(
    isSightlineBlocked({ x: 0, y: 180, z: 0 }, { x: 4000, y: 60, z: 0 }, 40, ridge),
    true,
    'pin hidden behind a mountain ridge is occluded',
  );

  // Very close landmark (< 160 m) never falsely self-occludes.
  assert.equal(
    isSightlineBlocked({ x: 0, y: 100, z: 0 }, { x: 120, y: 80, z: 0 }, 24, () => 110),
    false,
  );
});
