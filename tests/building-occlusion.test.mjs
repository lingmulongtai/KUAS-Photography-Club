import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOcclusion } from '../src/scripts/hero/building-occlusion.ts';

// 64 texels over 640 m: 10 m texels, rows running from north (minZ) to south
const box = [0, 0, 640, 640];
const at = (tex, x, z) => tex.image.data[Math.floor(z / 10) * 64 + Math.floor(x / 10)];

test('footprints fill the texels they cover and leave open ground at zero', () => {
  const tex = buildOcclusion({ boxes: [{ x: 105, z: 205, w: 30, d: 10, angle: 0, h: 9, ground: 0, kind: 0 }], polys: [] }, box, 64);
  assert.equal(tex.image.width, 64);
  assert.equal(at(tex, 95, 205), 255);
  assert.equal(at(tex, 115, 205), 255);
  assert.equal(at(tex, 105, 225), 0);
  assert.equal(at(tex, 300, 300), 0);
  // a footprint covering half a texel's samples counts half
  const half = buildOcclusion({ boxes: [{ x: 305, z: 302.5, w: 10, d: 5, angle: 0, h: 9, ground: 0, kind: 0 }], polys: [] }, box, 64);
  assert.ok(at(half, 305, 305) > 100 && at(half, 305, 305) < 160);
});

test('rotated boxes follow the building angle and polygons their outline', () => {
  // 60 × 6 m turned a quarter turn: long side north-south
  const tex = buildOcclusion({
    boxes: [{ x: 405, z: 405, w: 60, d: 6, angle: Math.PI / 2, h: 9, ground: 0, kind: 0 }],
    polys: [{ ring: new Float32Array([100, 500, 160, 500, 100, 560]), h: 12, ground: 0, kind: 1 }],
  }, box, 64);
  assert.equal(at(tex, 405, 385), 255);
  assert.equal(at(tex, 425, 405), 0);
  assert.equal(at(tex, 105, 505), 255);
  assert.equal(at(tex, 155, 555), 0);
  assert.ok(tex.image.data.every((v) => v >= 0 && v <= 255));
});
