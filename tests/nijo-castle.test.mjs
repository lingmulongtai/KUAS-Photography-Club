import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {nijoCastle,replacesNinomaru} from '../src/scripts/hero/nijo-castle.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('Ninomaru halls step northwest while leaving the west garden outside the roofs',()=>{
  const sites=nijoCastle();let triangles=0;
  const names=['tozamurai','shikidai','ohiroma','sotetsu','kuroshoin','shiroshoin'];
  for(let i=1;i<names.length;i++){
    assert.ok(sites[`ninomaru-${names[i]}`].x<sites[`ninomaru-${names[i-1]}`].x);
    assert.ok(sites[`ninomaru-${names[i]}`].z<sites[`ninomaru-${names[i-1]}`].z);
  }
  for(const site of Object.values(sites))for(const {geo} of site.parts){
    geo.computeBoundingBox();assert.ok(geo.boundingBox.max.y<20);assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));
    triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;geo.dispose();
  }
  assert.ok(triangles<15000);
});

test('the actual fused Ninomaru footprint is replaced exactly once',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});const data=await loadBuildings();
  assert.equal(data.polys.filter(p=>replacesNinomaru(p.ring)).length,1);
});
