import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {templeHall} from '../src/scripts/hero/compound-models.ts';

for(const [name,w,d,h,doubleRoof] of [['Kondo',44.56,29.11,24.9,true],['Kodo',45.72,26.12,17.7,false],['Jikido',39.75,30.42,18.2,false]])
test(`${name} has closed curved roofs and a bounded measured silhouette`,()=>{
  const parts=templeHall(w,d,h,doubleRoof),bounds=new THREE.Box3();let triangles=0;
  for(const {geo} of parts){geo.computeBoundingBox();bounds.union(geo.boundingBox);
    assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;}
  assert.ok(Math.abs(bounds.max.y-(h+.14))<.001,'ridge height');
  assert.ok(Math.abs(bounds.max.x-bounds.min.x-w)<.001,'roof footprint');
  const material=new THREE.MeshBasicMaterial();const meshes=parts.map(p=>new THREE.Mesh(p.geo,material));
  const hits=new THREE.Raycaster(new THREE.Vector3(0,60,0),new THREE.Vector3(0,-1,0)).intersectObjects(meshes);
  assert.ok(hits[0]?.point.y>=h);assert.ok(hits[0]?.face.normal.y>0);assert.ok(triangles<5000);
  parts.forEach(p=>p.geo.dispose());material.dispose();
});
