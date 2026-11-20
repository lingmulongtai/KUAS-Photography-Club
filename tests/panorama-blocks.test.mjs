import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panoramaHouses } from '../src/scripts/hero/panorama-blocks.ts';

const house = (x, z, props = {}) => ({ b: { x, z, w: 12, d: 7, h: 8, ground: 0, kind: 4, angle: 0, ...props }, y: 50, seed: x / 100 });
const unprotected = () => false;

test('a distant row shares a footprint while keeping its measured roof profile and source houses', () => {
  const houses = [house(7, 8), house(20, 8, { h: 9 })];
  const original = structuredClone(houses);
  const [row, ...rest] = panoramaHouses(houses, unprotected);
  assert.equal(rest.length, 0);
  assert.deepEqual([row.b.x, row.b.z, row.b.w, row.b.d, row.b.h], [13.5, 8, 25, 7, 8.5]);
  assert.equal(row.roofSource, houses[0].b);
  assert.deepEqual(houses, original);
  assert.equal(panoramaHouses([house(7, 8, {angle: Math.PI/2}), house(7, 21, {angle: Math.PI/2})], unprotected).length, 1);
});

test('streets, diagonal gaps, protected facades and distinct skylines stay open in the block view', () => {
  const first = house(7, 8);
  for (const neighbour of [house(23, 8), house(20, 14), house(20, 8, {h: 15}), house(20, 8, {kind: 20}),
    house(20, 8, {angle: .7}), {...house(20, 8), y: 53}]) {
    assert.deepEqual(panoramaHouses([first, neighbour], unprotected), [first, neighbour]);
  }
  assert.equal(panoramaHouses([first, house(20, 8)], b => b === first.b).length, 2);
});
