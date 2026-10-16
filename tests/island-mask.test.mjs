import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandMask, ringArea } from '../src/scripts/hero/island-mask.ts';

const square = (x, z, s) => new Float32Array([x, z, x + s, z, x + s, z + s, x, z + s]);

test('garden islands count, stepping stones and long sandbars do not', () => {
  const pine = square(100, 100, 12);   // 144 m²
  const stone = square(300, 300, 3);   // 9 m²
  const bar = square(500, 500, 120);   // 14 400 m²
  assert.equal(ringArea(pine), 144);
  const island = islandMask([pine, stone, bar]);
  assert.equal(island(106, 106), true);
  assert.equal(island(99, 106), false);
  assert.equal(island(301, 301), false);
  assert.equal(island(560, 560), false);
});

test('islands across spatial cell boundaries are found from every cell', () => {
  const island = islandMask([square(120, 120, 20)]);
  assert.equal(island(125, 125), true);
  assert.equal(island(135, 135), true);
  assert.equal(island(141, 141), false);
});
