import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {nijoCastle,replacesNinomaru,replacesNijoBox,replacesNijoFootprint} from '../src/scripts/hero/nijo-castle.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('Ninomaru halls step northwest while leaving the west garden outside the roofs',()=>{
  const sites=nijoCastle();let triangles=0;
  const names=['tozamurai','shikidai','ohiroma','sotetsu','kuroshoin','shiroshoin'];
  for(let i=1;i<names.length;i++){
    assert.ok(sites[`ninomaru-${names[i]}`].x<sites[`ninomaru-${names[i-1]}`].x);
    assert.ok(sites[`ninomaru-${names[i]}`].z<sites[`ninomaru-${names[i-1]}`].z);
  }
  for(const site of Object.values(sites))for(const {geo} of site.parts){
    const ray=new THREE.Raycaster(new THREE.Vector3(-1076-site.x,100,-1177-site.z),new THREE.Vector3(0,-1,0));
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
    assert.equal(ray.intersectObject(new THREE.Mesh(geo,material)).length,0,'Honmaru court stays open to the sky');material.dispose();
    geo.computeBoundingBox();assert.ok(geo.boundingBox.max.y<20);assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));
    triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;geo.dispose();
  }
  assert.ok(triangles<28000);
  assert.equal(Object.keys(sites).filter(n=>n.endsWith('Turret')).length,2,'only the two surviving turrets');
  assert.equal(Object.keys(sites).some(n=>/keep|tenshu/i.test(n)),false);
});

test('the actual fused Ninomaru footprint is replaced exactly once',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});const data=await loadBuildings();
  assert.equal(data.polys.filter(p=>replacesNinomaru(p.ring)).length,1);
  const count=data.polys.filter(p=>replacesNijoFootprint(p.ring)).length+data.boxes.filter(b=>replacesNijoBox(b.x,b.z)).length;
  assert.ok(count>=7&&count<=8,`actual castle replacements: ${count}`);
  assert.equal(replacesNijoBox(-1150,-1220),false,'do not clear unrelated storehouses');
});
