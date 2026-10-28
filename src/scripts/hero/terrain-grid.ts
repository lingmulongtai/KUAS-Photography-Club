import type { Heightfield } from './heightfield';
import type { KamoChannel } from './kamo-channel';

/** Vertex positions of the warped grid, with each column calculated only once. */
export function terrainPositions(hf: Heightfield, center: { x: number; z: number }, segments: number, channel?: KamoChannel) {
  const [minX, minZ, maxX, maxZ] = hf.bounds;
  const n = segments + 1;
  const warp = (u: number, c: number, lo: number, hi: number) => {
    const s = Math.pow(Math.abs(u), 2.1);
    return u < 0 ? c - (c - lo) * s : c + (hi - c) * s;
  };
  const xs = new Float64Array(n), clampedX = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = warp((i / segments) * 2 - 1, center.x, minX, maxX);
    if (i === 0) x -= 20000;
    if (i === segments) x += 20000;
    xs[i] = x;
    clampedX[i] = Math.min(Math.max(x, minX), maxX);
  }
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    let z = warp((j / segments) * 2 - 1, center.z, minZ, maxZ);
    if (j === 0) z -= 20000;
    if (j === segments) z += 20000;
    const cz = Math.min(Math.max(z, minZ), maxZ);
    for (let i = 0; i < n; i++) {
      const x = xs[i], cx = clampedX[i], k = (j * n + i) * 3;
      pos[k] = x;
      const ground = hf.height(cx, cz);
      pos[k + 1] = (channel ? channel.bed(cx, cz, ground) : ground) - (cx !== x || cz !== z ? 60 : 0);
      pos[k + 2] = z;
    }
  }
  return pos;
}
