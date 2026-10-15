import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forestCells, woodland, seasonalWoodland } from '../src/scripts/hero/forest-layout.ts';

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

test('regional canopy adds nearby coverage within a bounded budget and preserves distant cells',()=>{
  const center={x:-8550,z:-1400};
  const far=c=>Math.hypot(c.x-center.x,c.z-center.z)>=650;
  const pc=[...forestCells(center,1,true)],mobile=[...forestCells(center,.55,true)];
  assert.ok(pc.length<80000);
  assert.ok(mobile.length<pc.length/2);
  for(const quality of [1,.55]) {
    const base=[...forestCells(center,quality)],detail=[...forestCells(center,quality,true)];
    assert.deepEqual(detail.filter(far),base.filter(far));
    assert.ok(detail.filter(c=>!far(c)).length>base.filter(c=>!far(c)).length*2);
    assert.equal(new Set(detail.map(c=>`${c.x},${c.z}`)).size,detail.length);
  }
});

test('regional seasonal canopy accepts muted wooded slopes and rejects flat ground, pale roofs and blue water',()=>{
  for(const c of [[.38,.32,.22],[80/255,82/255,84/255],[65/255,74/255,71/255],[57/255,68/255,69/255],[.3,.3,.3]]) {
    assert.equal(seasonalWoodland(c,.8),true);
    assert.equal(seasonalWoodland(c,.99),false);
  }
  for(const c of [[.1,.25,.36],[.78,.8,.75],[.02,.02,.02],[.7,.3,.2]]) assert.equal(seasonalWoodland(c,.8),false);
});
