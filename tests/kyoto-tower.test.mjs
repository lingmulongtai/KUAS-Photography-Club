import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {kyotoTower} from '../src/scripts/hero/kyoto-tower.ts';

test('tower retains the official overall height with bounded, finite geometry', () => {
  const parts=kyotoTower(), bounds=new THREE.Box3();
  let triangles=0;
  for(const {geo} of parts) {
    geo.computeBoundingBox(); bounds.union(geo.boundingBox);
    triangles+=(geo.index?.count??geo.attributes.position.count)/3;
    for(const name of ['position','normal']) {
      assert.ok([...geo.attributes[name].array].every(Number.isFinite),name);
    }
  }
  assert.equal(bounds.min.y,0);
  assert.ok(Math.abs(bounds.max.y-131)<.01);
  assert.ok(triangles<32000,`tower triangle budget: ${triangles}`);
  for(const {geo} of parts) geo.dispose();
});

test('both observation levels and roof lounge expose glass between structural ribs', () => {
  const parts=kyotoTower();
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const meshes=parts.map(({geo})=>new THREE.Mesh(geo,material));
  for(const y of [99.1,101.1,35.5]) for(let side=0;side<4;side++) {
    const a=Math.PI/36+side*Math.PI/2;
    const ray=new THREE.Raycaster(new THREE.Vector3(Math.sin(a)*30,y,Math.cos(a)*30),
      new THREE.Vector3(-Math.sin(a),0,-Math.cos(a)));
    const hit=ray.intersectObjects(meshes)[0];
    assert.ok(hit,`visible surface at ${y}`);
    const color=parts[meshes.indexOf(hit.object)].color;
    assert.ok(color[0]<.04&&color[2]>color[0]*2,`glass must face the viewer at ${y}, side ${side}`);
  }
  material.dispose();
  for(const {geo} of parts) geo.dispose();
});
