import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toLocal } from '../src/scripts/hero/geo.ts';

const file = name => new URL('../public/kyoto/' + name, import.meta.url);
const { aerialBasin: atlas, aerialCity: city } = JSON.parse(await readFile(file('terrain.json'), 'utf8'));
const inside = (box, x, z) => x > box[0] && x < box[2] && z > box[1] && z < box[3];

test('resident photos cover the south and both sides of the Yagi approach before entering a detail region', () => {
  const boxes = Object.fromEntries(atlas.sheets.map(s => [s.id, s.box]));
  const stations = [
    ['katsura', 34.9793, 135.7039], ['south', 34.9459699, 135.7615435],
    ['kameoka', 35.0167, 135.5826], ['sonobe', 35.1023071, 135.4833287]
  ];
  for (const [name, lat, lon] of stations) {
    const { x, z } = toLocal(lat, lon);
    assert.ok(inside(boxes[name], x, z), name);
  }
  assert.ok(inside(boxes.kameoka, -21900, -7100) && inside(boxes.sonobe, -21900, -7100));
  assert.ok(inside(boxes.south, -9000, 19000) && inside(boxes.south, 4600, 6200));
  assert.deepEqual(boxes.city, city.box);
});

test('atlas variants keep the same ground registration and fit the advertised GPU limits', async () => {
  for (const [variant, limit] of [[atlas, 4096], [atlas.compact, 4096], [atlas.mobile, 2048]]) {
    assert.deepEqual(variant.sheets.map(s => [s.id, s.box]), atlas.sheets.map(s => [s.id, s.box]));
    assert.ok(Math.max(...variant.size) <= limit);
    const bytes = await readFile(file(variant.file));
    assert.equal(bytes.length, variant.bytes);
    assert.equal(bytes.toString('ascii', 8, 16), 'WEBPVP8 ');
    assert.deepEqual([bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff], variant.size);
    const rects = [];
    for (const sheet of variant.sheets) {
      const [l, b, r, t] = sheet.uv;
      assert.ok(0 <= l && l < r && r <= 1 && 0 <= b && b < t && t <= 1);
      assert.ok(rects.every(([x, y, xx, yy]) => xx <= l || r <= x || yy <= b || t <= y));
      rects.push(sheet.uv);
      if (sheet.id === 'city' && variant !== atlas.mobile) {
        assert.deepEqual([(r - l) * variant.size[0], (t - b) * variant.size[1]], city.size);
      }
    }
  }
});
