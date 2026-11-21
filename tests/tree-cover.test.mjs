import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeTreeCover } from '../src/scripts/hero/tree-cover.ts';

const asset = file => readFileSync(new URL('../public/kyoto/' + file, import.meta.url));
const bytes = gunzipSync(asset('tree-cover.bin'));

test('tree cover spans the entire travel area and distinguishes off-spot forests from fields, rivers and streets', () => {
  const { box, width, height, cells } = decodeTreeCover(bytes);
  assert.deepEqual(box, JSON.parse(asset('terrain.json')).outer.box);
  const cell = (x,z) => cells[Math.floor((z - box[1]) * height / (box[3] - box[1])) * width
    + Math.floor((x - box[0]) * width / (box[2] - box[0]))];
  for (const [x,z] of [[-21771,4171],[-26062,-7145],[-6253,-13024],[4153,-4593],[5705,14489]]) {
    assert.equal(cell(x,z),15, `wooded hillside at ${x},${z}`);
  }
  assert.equal(cell(800,12100),16, 'Ogura cropland');
  assert.equal(cell(-9975,17750),16, 'Yodo river channel');
  assert.equal(cell(-283,5173),0, 'Takeda station');
  assert.equal(cell(0,0),0, 'Shijo Karasuma junction');
  assert.ok(cells.includes(7), 'a partially wooded cell retains fractional cover');
  assert.ok(asset('tree-cover.bin').length < 1024 * 1024);
});

test('a truncated or mismatched tree cover grid cannot be sampled', () => {
  for (const data of [new Uint8Array(4), new Uint8Array(24), bytes.subarray(0,bytes.length-1)]) {
    assert.throws(() => decodeTreeCover(data), /tree cover/);
  }
});
