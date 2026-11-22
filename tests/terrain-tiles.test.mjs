import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { terrainTiles } from '../src/scripts/hero/terrain-tiles.ts';

test('culled terrain tiles share every original triangle and follow a recentered interior ridge', () => {
  const segments = 67, n = segments + 1;
  const p = new Float32Array(n * n * 3);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) p.set([x, 0, z], 3 * (z * n + x));
  const { mesh, setPositions, setDistant } = terrainTiles(p, segments, new THREE.MeshBasicMaterial());
  const near=mesh.children.filter(tile=>tile.visible);
  assert.equal(near.length, 4);
  const all = new Set();
  for (const tile of near) {
    const { geometry } = tile, { start, count } = geometry.drawRange;
    assert.equal(geometry.getAttribute('position'), mesh.children[0].geometry.getAttribute('position'));
    const idx = geometry.index.array;
    for (let i = start; i < start + count; i += 6) {
      const a = idx[i];
      assert.deepEqual(Array.from(idx.slice(i, i + 6)), [a,a+n,a+1,a+1,a+n,a+n+1]);
      assert.ok(!all.has(a)); all.add(a);
    }
  }
  assert.equal(all.size, segments ** 2);
  const next = p.slice(); next[3 * (20 * n + 30) + 1] = 200;
  setPositions(next);
  assert.ok(mesh.children[0].geometry.boundingSphere.containsPoint(new THREE.Vector3(30,200,20)));
  assert.equal(near[3].geometry.boundingBox.max.y, 0);
  setDistant(true);
  const far=mesh.children.filter(tile=>tile.visible);
  assert.equal(far.length,1);
  assert.equal(far[0].geometry.getAttribute('position'),near[0].geometry.getAttribute('position'));
  const coarse=far[0].geometry.index.array;
  assert.equal(coarse.length,6*Math.ceil(segments/4)**2);
  assert.ok(coarse.includes(n*n-1),'include the final irregular row and column');
  setDistant(false);
  assert.deepEqual(mesh.children.filter(tile=>tile.visible),near);
});
