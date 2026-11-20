import * as THREE from 'three';

/** Tiles share the original vertices, so culling works for both the eye and the sun without cracks. */
export function terrainTiles(positions: Float32Array, segments: number, material: THREE.Material) {
  const n = segments + 1, step = 64;
  const position = new THREE.BufferAttribute(positions, 3);
  const indices = new Uint32Array(6 * segments * segments);
  const index = new THREE.BufferAttribute(indices, 1);
  const mesh = new THREE.Group();
  const tiles: { geometry: THREE.BufferGeometry; x0: number; x1: number; z0: number; z1: number }[] = [];
  let next = 0;
  for (let z0 = 0; z0 < segments; z0 += step) for (let x0 = 0; x0 < segments; x0 += step) {
    const z1 = Math.min(z0 + step, segments), x1 = Math.min(x0 + step, segments);
    const start = next;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
      indices[next++] = a; indices[next++] = c; indices[next++] = b;
      indices[next++] = b; indices[next++] = c; indices[next++] = d;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position);
    geometry.setIndex(index);
    geometry.setDrawRange(start, next - start);
    geometry.boundingBox = new THREE.Box3();
    geometry.boundingSphere = new THREE.Sphere();
    tiles.push({ geometry, x0, x1, z0, z1 });
    mesh.add(new THREE.Mesh(geometry, material));
  }
  function setPositions(p: Float32Array) {
    position.array = p;
    position.needsUpdate = true;
    for (const { geometry, x0, x1, z0, z1 } of tiles) {
      let low = Infinity, high = -Infinity;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const h = p[3 * (z * n + x) + 1];
        low = Math.min(low, h); high = Math.max(high, h);
      }
      // The warped lattice is monotone in x and z. The highest ridge can be inside the tile.
      const first = 3 * (z0 * n + x0), last = 3 * (z1 * n + x1);
      const bounds = geometry.boundingBox!;
      bounds.min.set(p[first], low, p[first + 2]);
      bounds.max.set(p[last], high, p[last + 2]);
      bounds.getBoundingSphere(geometry.boundingSphere!);
    }
  }
  setPositions(positions);
  return { mesh, position, setPositions };
}
