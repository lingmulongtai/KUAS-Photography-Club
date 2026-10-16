import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ryoanji } from '../src/scripts/hero/temple-models.ts';

test('Ryoan-ji has a closed hall, bounded southern garden and fifteen stones',()=>{
  const parts=ryoanji(), bounds=new THREE.Box3();
  let triangles=0;
  for(const {geo} of parts) {
    geo.computeBoundingBox();bounds.union(geo.boundingBox);
    triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;
    assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));
  }
  assert.equal(parts.filter(({geo})=>geo.type==='IcosahedronGeometry').length,15);
  assert.ok(triangles<3000);
  assert.ok(bounds.max.x-bounds.min.x<=29);
  assert.ok(bounds.min.z>=-16 && bounds.max.z<22);
  const material=new THREE.MeshBasicMaterial();
  const hit=new THREE.Raycaster(new THREE.Vector3(0,50,-1),new THREE.Vector3(0,-1,0))
    .intersectObjects(parts.map(({geo})=>new THREE.Mesh(geo,material)))[0];
  assert.ok(hit.point.y>10);
  parts.forEach(({geo})=>geo.dispose());material.dispose();
});
