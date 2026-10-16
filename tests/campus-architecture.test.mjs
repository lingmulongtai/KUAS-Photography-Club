import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CampusBuilder, campusArchitecture } from '../src/scripts/hero/campus-architecture.ts';

const builder=new CampusBuilder(32.5);
const geometry=campusArchitecture(32.5);
const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
function ray(a,b) {
  const p=new THREE.Vector3(...builder.point(a)),q=new THREE.Vector3(...builder.point(b));
  return new THREE.Raycaster(p,q.clone().sub(p).normalize(),.01,p.distanceTo(q)-.01).intersectObject(mesh);
}
test('North entrance is open at ground level and its central lightwell is open to the sky',()=>{
  assert.equal(ray([8,1,-90],[8,1,-50]).length,0);
  assert.equal(ray([8,30,-70],[8,1,-70]).length,0);
  assert.ok(ray([8,3.9,-65],[8,3.9,-54]).length,'upper pedestrian bridge is present');
});
test('measured academic wings have finite unit normals and actual roof relief',()=>{
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
  for(let i=0;i<p.count;i++){
    assert.ok(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i)));
    assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
  }
  assert.ok(ray([-40,25,-68],[-40,0,-68]).length);
  assert.equal(ray([20,1,-49],[20,20,-49]).length,0,'space between the wings remains open');
  assert.ok(p.count<150000,'retain a bounded static mesh for mobile');
});
