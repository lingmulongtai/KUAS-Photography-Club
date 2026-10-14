import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forestCells, woodland } from '../src/scripts/hero/forest-layout.ts';

test('forest coverage surrounds a viewpoint and has a bounded lightweight population', () => {
  const center = {x: -8550, z: -1400};
  const pc = [...forestCells(center,1)], mobile = [...forestCells(center,.55)];
  assert.ok(pc.length < 100000);
  assert.ok(mobile.length < pc.length / 2);
  for (const cells of [pc,mobile]) {
    assert.ok(cells.some(c=>Math.hypot(c.x-center.x,c.z-center.z)>9500));
    const quadrants = new Set(cells.filter(c=>c.lod===0).map(c=>`${c.x>center.x},${c.z>center.z}`));
    assert.equal(quadrants.size,4);
    assert.ok(cells.every(c=>Math.hypot(c.x-center.x,c.z-center.z)>=32));
  }
  assert.deepEqual([...forestCells(center,.55)].slice(0,8),mobile.slice(0,8));
});
test('forest mask accepts mixed green canopy and rejects roofs and water', () => {
  assert.equal(woodland([.35,.37,.27]),true);
  assert.equal(woodland([.22,.34,.19]),true);
  assert.equal(woodland([.78,.8,.75]),false);
  assert.equal(woodland([.1,.25,.36]),false);
  assert.equal(woodland([.3,.3,.3]),false);
});
