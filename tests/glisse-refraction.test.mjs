import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glassMap } from '../src/scripts/hero/glisse-refraction.ts';

test('Glisse displacement bends opposite edges toward the centre', () => {
  const map = glassMap(80, 24, 12);
  assert.ok(map);
  const pixel = (x, y) => [...map.field.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4)];
  assert.deepEqual(pixel(40, 12), [128, 128, 128, 255]);
  assert.ok(pixel(1, 12)[0] > 128);
  assert.ok(pixel(78, 12)[0] < 128);
  assert.ok(pixel(40, 1)[1] > 128);
  assert.ok(pixel(40, 22)[1] < 128);
  assert.ok(Number.isFinite(map.scale) && map.scale > 0);
});

test('map generation is bounded and handles invalid sizes safely', () => {
  assert.equal(glassMap(0, 24, 12), null);
  assert.equal(glassMap(Infinity, 24, 12), null);
  assert.equal(glassMap(1000, 1000, 12), null);
  const small = glassMap(36, 24, 999);
  assert.ok(small);
  assert.equal(small.field.length, 36 * 24 * 4);
  assert.equal(small.shine.length, small.field.length);
});
