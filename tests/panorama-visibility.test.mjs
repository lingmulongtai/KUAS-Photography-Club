import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { panoramaVisibility } from '../src/scripts/hero/panorama-visibility.ts';
import { createPanoramaCity } from '../src/scripts/hero/panorama-city.ts';

const eye = { x: 1000, y: 10, z: 0 };
// Seen from the east, these triangles wind toward the viewer.
function wall(x, bottom, top, left, right) {
  return [x,bottom,left, x,top,left, x,top,right, x,bottom,left, x,top,right, x,bottom,right];
}
const plane = (...positions) => ({ positions: new Float32Array(positions.flat()) });

test('only strictly occluded faces disappear; foreground, gaps, and grazing silhouettes survive', () => {
  const blocker = plane(wall(500,-60,60,-120,120));
  const behind = plane(wall(0,-4,5,-49,-40)), front = plane(wall(650,-4,5,-49,-40));
  const corner = plane(wall(0,-4,5,-260,-235));
  const edgeOn = plane([0,10,350, 100,10,350, 0,10,370]);
  const [visible, covered, closer, partial, grazing] = panoramaVisibility([blocker,behind,front,corner,edgeOn],eye);
  assert.equal(visible.indices.length, 6);
  assert.equal(covered.indices.length, 0);
  assert.equal(closer.indices.length, 6);
  assert.equal(partial.indices.length, 6);
  assert.equal(grazing.indices.length, 3);
  blocker.info = new Float32Array(24).fill(800);
  assert.equal(panoramaVisibility([blocker, behind],eye)[1].indices.length, 6);
});

test('fixed-eye batches keep the original corner index and house number', () => {
  const positions = new Float32Array([.5,0,-.5, .5,1,-.5, .5,1,.5, -.5,0,.5, -.5,1,.5, -.5,1,-.5]);
  const source = {
    shape: { positions, normals: new Float32Array(18), roles: new Float32Array(6),
      indices: new Uint16Array([0,1,2,3,4,5]), stepped: false, overview: false },
    pos: new Float32Array([0,0,-200, 0,0,200]), size: new Float32Array([12,8,7, 12,8,7]),
    rot: new Float32Array([0,Math.PI]), meta: new Float32Array(8),
  };
  const [{ batches }] = panoramaVisibility([source],eye);
  assert.deepEqual(batches.map(b => [Array.from(b.houses), Array.from(b.indices)]), [[[0],[0,1,2]],[[1],[3,4,5]]]);
});

test('a delayed visibility result only substitutes the matching colour mesh during the draw', () => {
  const previous = globalThis.Worker, jobs = [];
  globalThis.Worker = class {
    constructor() { jobs.push(this); }
    postMessage(input) { this.input = input; }
    terminate() {}
  };
  try {
    const root = new THREE.Group(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(wall(500,-6,6,-12,12),3));
    geometry.setAttribute('aInfo', new THREE.Float32BufferAttribute(new Float32Array(24),4));
    geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(new Float32Array(12),2));
    const source = new THREE.Mesh(geometry, new THREE.ShaderMaterial());
    root.add(source);
    const cache = createPanoramaCity([root], eye);
    const direct = () => { assert.ok(source.visible); assert.equal(cache.group.visible,false); };
    cache.render(eye, direct);
    assert.equal(jobs.length, 1);
    jobs[0].onmessage({ data: [{ indices: new Uint32Array([0,1,2]) }] });
    cache.render({...eye,x:999}, direct);
    assert.throws(() => cache.render(eye, () => {
      assert.equal(source.visible,false); assert.ok(cache.group.visible);
      const [copy] = cache.group.children;
      assert.equal(copy.material,source.material);
      assert.equal(copy.geometry.getAttribute('position'),geometry.getAttribute('position'));
      throw Error('interrupted render');
    }), /interrupted render/);
    direct();
    source.layers.disable(0); cache.render(eye,direct);
    source.layers.enable(0); cache.render(eye,direct);
    assert.equal(jobs.length, 2);
  } finally {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  }
});
