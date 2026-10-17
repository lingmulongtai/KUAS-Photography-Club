import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {imperialPalace} from '../src/scripts/hero/imperial-palace.ts';

test('Imperial Palace retains separated low halls and open gardens within its walls',()=>{
  const sites=imperialPalace();let triangles=0;
  assert.ok(sites.seiryoden.x<241&&sites.seiryoden.z<-2278);
  assert.ok(sites.gakumonjo.z<sites.kogosho.z&&sites.otsunegoten.z<sites.gakumonjo.z);
  assert.ok(sites.northResidence.z<sites.otsunegoten.z);
  for(const [name,site] of Object.entries(sites)){
    const bounds=new THREE.Box3();
    for(const {geo} of site.parts){geo.computeBoundingBox();bounds.union(geo.boundingBox);triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;
      assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));geo.dispose();}
    assert.ok(bounds.max.y<=11,`${name} is low-rise`);
    assert.ok(bounds.max.x-bounds.min.x<70&&bounds.max.z-bounds.min.z<80,'do not fill the compound with a single block');
  }
  assert.ok(triangles<28000);
  assert.ok(Math.abs(sites.kenreimon.z+2186.1)<.01);
  assert.ok(sites.sakuheimon.z<-2620);
});
