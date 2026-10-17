import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {heianShrine,HEIAN_CENTER,replacesHeianFootprint} from '../src/scripts/hero/heian-shrine.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';
import {readFile} from 'node:fs/promises';
import {SPOTS} from '../src/data/spots.ts';
import {toLocal} from '../src/scripts/hero/geo.ts';

test('Heian court and gate stay open between the actual halls',()=>{
  const parts=heianShrine(),material=new THREE.MeshBasicMaterial();const meshes=parts.map(p=>new THREE.Mesh(p.geo,material));
  const vertical=(x,z)=>new THREE.Raycaster(new THREE.Vector3(x,40,z),new THREE.Vector3(0,-1,0)).intersectObjects(meshes);
  assert.equal(vertical(0,30).length,0,'the main court is not filled with a generic building');
  for(const [x,z,h] of [[0,-52,15],[0,-91,12],[.22,65.93,18],[-57,-20,15],[57,-20,15]])assert.ok(vertical(x,z)[0]?.point.y>=h);
  const passage=new THREE.Raycaster(new THREE.Vector3(.22,3,90),new THREE.Vector3(0,0,-1),0,35).intersectObjects(meshes);
  assert.equal(passage.length,0,'walk through Otenmon below its upper room');
  const bounds=new THREE.Box3();let triangles=0;
  for(const p of parts){p.geo.computeBoundingBox();bounds.union(p.geo.boundingBox);triangles+=(p.geo.index?.count??p.geo.getAttribute('position').count)/3;p.geo.dispose();}
  assert.ok(bounds.min.z<-100&&bounds.max.z>73);assert.ok(triangles<20000);
  const spot=SPOTS.find(s=>s.id==='heian'),center=toLocal(spot.lat,spot.lon);
  assert.ok(Math.hypot(center.x-HEIAN_CENTER.x,center.z-HEIAN_CENTER.z)<.1,'map pin and orbit frame the precinct');material.dispose();
});

test('replacement removes the fused shrine roof without removing nearby offices',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});
  const data=await loadBuildings();
  const removed=data.polys.filter(p=>replacesHeianFootprint(p.ring));
  assert.ok(removed.length>=2&&removed.length<=3,'main fused roof and north sanctuary');
  assert.ok(removed.some(p=>p.ring.some((v,i)=>i%2===0&&Math.abs(v-2025.06)<2)));
  const nearby=data.polys.filter(p=>p.ring[0]>2000&&p.ring[0]<2210&&p.ring[1]>-1500&&p.ring[1]<-1200);
  assert.ok(nearby.filter(p=>!replacesHeianFootprint(p.ring)).length>=5);
});
