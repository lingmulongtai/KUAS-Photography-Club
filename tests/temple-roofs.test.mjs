import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { goldenPavilion, kiyomizuHall, shishinden } from '../src/scripts/hero/temple-models.ts';

for (const [name, build, z, roofY] of [
  ['Shishinden', shishinden, 2, 16],
  ['Kiyomizu main hall', kiyomizuHall, -11, 24.5],
  ['Golden Pavilion', goldenPavilion, .6, 11],
]) test(`${name} has an upward-facing surface across the roof centre`, () => {
  const parts=build();
  const material=new THREE.MeshBasicMaterial();
  const meshes=parts.map(({geo})=>new THREE.Mesh(geo,material));
  for(const x of [-.5,0,.5]) {
    const ray=new THREE.Raycaster(new THREE.Vector3(x,50,z),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObjects(meshes)[0];
    assert.ok(hit && hit.point.y>=roofY-.01, `${name}: open roof at ${x},${z}`);
    assert.ok(hit.face.normal.y>0);
  }
  parts.forEach(({geo})=>geo.dispose());
  material.dispose();
});
