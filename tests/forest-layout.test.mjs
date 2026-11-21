import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forestCells, woodland, seasonalWoodland } from '../src/scripts/hero/forest-layout.ts';

const basin = [-35000,-20000,14000,36000];
test('forest coverage surrounds a viewpoint and has a bounded lightweight population', () => {
  const center = {x: -8550, z: -1400};
  const pc = [...forestCells(center,1,basin)], mobile = [...forestCells(center,.55,basin)];
  assert.ok(pc.length < 150000);
  assert.ok(mobile.length < pc.length / 2);
  for (const cells of [pc,mobile]) {
    assert.ok(cells.some(c=>Math.hypot(c.x-center.x,c.z-center.z)>35000));
    const quadrants = new Set(cells.filter(c=>c.lod===0).map(c=>`${c.x>center.x},${c.z>center.z}`));
    assert.equal(quadrants.size,4);
    assert.ok(cells.some(c=>Math.hypot(c.x-center.x,c.z-center.z)<15),'no circular clearing follows the camera');
    assert.ok(cells.every(c=>c.x>=basin[0] && c.z>=basin[1] && c.x<basin[2] && c.z<basin[3]));
    assert.equal(new Set(cells.map(c=>`${c.x},${c.z}`)).size,cells.length);
  }
  assert.deepEqual([...forestCells(center,.55,basin)].slice(0,8),mobile.slice(0,8));
});
test('forest mask accepts mixed green canopy and rejects roofs and water', () => {
  assert.equal(woodland([.35,.37,.27]),true);
  assert.equal(woodland([.22,.34,.19]),true);
  assert.equal(woodland([.78,.8,.75]),false);
  assert.equal(woodland([.1,.25,.36]),false);
  assert.equal(woodland([.3,.3,.3]),false);
});

test('approaching an off-spot stand adds neighbours around its existing world-anchored trees',()=>{
  const patch=[-26200,-7300,-25900,-7000];
  const near={x:-26050,z:-7150};
  for(const quality of [1,.55]) {
    const close=[...forestCells(near,quality,patch)];
    const keys=new Set(close.map(c=>`${c.x},${c.z},${c.seed}`));
    for(const offset of [1050,2200,4900,9600,23000]) {
      const far=[...forestCells({x:near.x+offset,z:near.z},quality,patch)];
      for(const c of far)assert.ok(keys.has(`${c.x},${c.z},${c.seed}`));
      assert.ok(close.length>2*far.length);
    }
  }
});

test('regional seasonal canopy accepts muted wooded slopes and rejects flat ground, pale roofs and blue water',()=>{
  for(const c of [[.38,.32,.22],[80/255,82/255,84/255],[65/255,74/255,71/255],[57/255,68/255,69/255],[.3,.3,.3]]) {
    assert.equal(seasonalWoodland(c,.8),true);
    assert.equal(seasonalWoodland(c,.99),false);
  }
  for(const c of [[.1,.25,.36],[.78,.8,.75],[.02,.02,.02],[.7,.3,.2]]) assert.equal(seasonalWoodland(c,.8),false);
});
