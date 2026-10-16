import * as THREE from 'three';
import type { BoxBuilding, PolyBuilding } from './buildings-data';
import type { Box } from './geo';

/**
 * Building footprints rasterised once into a single-channel texture with mipmaps. Sampled at a
 * coarse mip level it gives how built-up the neighbourhood is, which the ground and the lower
 * walls use as ambient occlusion: alleys between dense houses fall into shade instead of
 * showing the sunlit roofs that the aerial photo carries under the 3D buildings.
 */
export function buildOcclusion(data: { boxes: BoxBuilding[]; polys: PolyBuilding[] }, box: Box, size: number) {
  const [minX, minZ, maxX, maxZ] = box;
  // coverage counted on a 2×2 grid of samples per texel (0..4)
  const hits = new Uint8Array(size * size);
  const sub = 2 * size;
  const mx = (maxX - minX) / sub;
  const mz = (maxZ - minZ) / sub;
  /** Mark the samples inside a footprint, given its bounds and a point test in metres. */
  const fill = (x0: number, z0: number, x1: number, z1: number, inside: (x: number, z: number) => boolean) => {
    const i0 = Math.max(0, Math.ceil((x0 - minX) / mx - .5)), i1 = Math.min(sub - 1, Math.floor((x1 - minX) / mx - .5));
    const j0 = Math.max(0, Math.ceil((z0 - minZ) / mz - .5)), j1 = Math.min(sub - 1, Math.floor((z1 - minZ) / mz - .5));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + (j + .5) * mz;
      for (let i = i0; i <= i1; i++) {
        if (inside(minX + (i + .5) * mx, z)) hits[(j >> 1) * size + (i >> 1)]++;
      }
    }
  };
  for (const b of data.boxes) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const hw = b.w / 2, hd = b.d / 2;
    const r = Math.abs(hw * c) + Math.abs(hd * s), q = Math.abs(hw * s) + Math.abs(hd * c);
    fill(b.x - r, b.z - q, b.x + r, b.z + q, (x, z) => {
      const dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c + dz * s) <= hw && Math.abs(-dx * s + dz * c) <= hd;
    });
  }
  for (const { ring } of data.polys) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    fill(x0, z0, x1, z1, (x, z) => {
      let inside = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
        if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
      }
      return inside;
    });
  }
  const red = new Uint8Array(size * size);
  for (let i = 0; i < red.length; i++) red[i] = Math.min(4, hits[i]) * 63.75;
  // rows run from north (minZ) to south, which is v = 0 → 1 in the shader: no flip
  const texture = new THREE.DataTexture(red, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * GLSL to read the occlusion: declares uBuilt / uBuiltBox and builtAt(p, metres), the share of
 * the ground within about `metres` that is covered by buildings (0 open, 1 inside a footprint).
 * Uses explicit levels, so it is safe inside branches.
 */
export const BUILT_GLSL = /* glsl */ `
uniform sampler2D uBuilt;
uniform vec4 uBuiltBox;
uniform float uBuiltOn;
uniform float uBuiltTexel;
float builtAt(vec2 p, float metres){
  vec2 uv = (p - uBuiltBox.xy) / (uBuiltBox.zw - uBuiltBox.xy);
  float edge = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  return textureLod(uBuilt, uv, max(log2(metres / uBuiltTexel), 0.)).r * edge * uBuiltOn;
}
`;
