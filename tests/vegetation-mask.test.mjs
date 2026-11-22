import {readFileSync} from 'node:fs';
import {landmarkClearings} from '../src/scripts/hero/landmark-clearings.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {toLocal} from '../src/scripts/hero/geo.ts';
import {todaijiClearing} from '../src/scripts/hero/todaiji-grounds.ts';
import { createBuildingMask } from '../src/scripts/hero/vegetation-mask.ts';

test('tree exclusions follow rotated footprints, polygon edges and spatial cell boundaries', () => {
  const hit = createBuildingMask([{x:128,z:0,w:30,d:10,angle:Math.PI/2,h:12,ground:0,kind:0}], [{ring:new Float32Array([300,0,330,0,330,30,300,30]),h:10,ground:0,kind:1}]);
  assert.equal(hit(128,14),true);
  assert.equal(hit(142,0),false);
  assert.equal(hit(315,15),true);
  assert.equal(hit(297,15),true);
  assert.equal(hit(290,15),false);
  assert.equal(hit(10000,10000),false);
});

test('the Todaiji gate, approach and cloister lawns remain clear within the wooded park',()=>{
  const {x,z}=toLocal(34.68579835,135.83987561);
  for(const [dx,dz] of [[18,4],[0,70],[1,-145],[60,-250],[0,-355]])assert.ok(todaijiClearing(x+dx,z+dz));
  for(const [dx,dz] of [[22,70],[-90,-150],[50,-355],[-10,125]])assert.equal(todaijiClearing(x+dx,z+dz),false);
});

test('both cable station platforms and the Niji transfer entrance stay clear while the adjacent slope stays wooded',()=>{
  const sites=JSON.parse(readFileSync(new URL('../public/kansai/landmarks/index.json',import.meta.url))).filter(r=>r.approaches);
  const hit=landmarkClearings(sites);
  for(const site of sites){const {x,z}=toLocal(site.lat,site.lon);assert.ok(hit(x,z));}
  const upper=sites.find(s=>s.id==='maya-cable-niji'),{x,z}=toLocal(upper.lat,upper.lon);
  const a=324.9*Math.PI/180,at=(across,up)=>hit(x+across*Math.cos(a)+up*Math.sin(a),z+across*Math.sin(a)-up*Math.cos(a));
  assert.ok(at(-12,6));
  assert.equal(at(-30,6),false);
  assert.equal(at(17,8),false);
});
