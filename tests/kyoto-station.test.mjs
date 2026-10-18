import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {kyotoStation,replacesKyotoStation} from '../src/scripts/hero/kyoto-station.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('Kyoto Station has an open atrium and a grand stair rising west',()=>{
  const p=kyotoStation(),material=new THREE.MeshBasicMaterial(),meshes=p.map(part=>new THREE.Mesh(part.geo,material));
  const ray=(x,z)=>new THREE.Raycaster(new THREE.Vector3(x,70,z),new THREE.Vector3(0,-1,0)).intersectObjects(meshes)[0];
  assert.ok(ray(14,2).point.y<1,'atrium is not a full-height solid block');
  assert.ok(ray(-121,2).point.y>ray(-51,2).point.y+20,'stairs rise to the west');
  assert.ok(ray(-200,2).point.y>59,'western wing keeps its skyline');
  let triangles=0;const bounds=new THREE.Box3();
  for(const {geo} of p){geo.computeBoundingBox();bounds.union(geo.boundingBox);triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;
    assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));geo.dispose();}
  assert.ok(bounds.max.y<61&&bounds.max.x-bounds.min.x<481);assert.ok(triangles<22000);material.dispose();
});

test('only the station main block is replaced; platform roofs are retained',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});const data=await loadBuildings();
  assert.equal(data.polys.filter(p=>replacesKyotoStation(p.ring)).length,1);
  assert.ok(data.polys.some(p=>p.ring[0]>-250&&p.ring[0]<180&&p.ring[1]>2080&&p.ring[1]<2140&&!replacesKyotoStation(p.ring)));
});
