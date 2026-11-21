import type { Box } from './geo';

function hash(x: number, z: number, salt: number) {
  let n = Math.imul(x, 0x1f1f1f1f) ^ Math.imul(z, 0x6c8e9cf5) ^ salt;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Each coarser cell retains one of its four children at the child's exact world position. */
export function* forestCells(eye: { x: number; z: number }, quality: number, bounds: Box) {
  const fine = quality > .75 ? 8 : 12;
  const ranges = [680, 1450, 3200, 6200, 12000, 60000];
  const canopyLod = [1, 1, 2, 2, 3, 4];
  for (let level = 0; level < ranges.length; level++) {
    const step = fine * 2 ** level;
    const reach = ranges[level] * 1.1;
    const x0 = Math.floor(Math.max(eye.x - reach, bounds[0]) / step);
    const z0 = Math.floor(Math.max(eye.z - reach, bounds[1]) / step);
    const x1 = Math.ceil(Math.min(eye.x + reach, bounds[2]) / step);
    const z1 = Math.ceil(Math.min(eye.z + reach, bounds[3]) / step);
    for (let i = x0; i < x1; i++) for (let j = z0; j < z1; j++) {
      let ix = i, iz = j;
      for (let depth = level; depth > 0; depth--) {
        const child = hash(ix, iz, depth) & 3;
        ix = 2 * ix + (child & 1);
        iz = 2 * iz + (child >>> 1);
      }
      const jitter = hash(ix, iz, 41);
      const x = (ix + .1 + (jitter & 65535) / 65536 * .8) * fine;
      const z = (iz + .1 + (jitter >>> 16) / 65536 * .8) * fine;
      if (x < bounds[0] || x >= bounds[2] || z < bounds[1] || z >= bounds[3]) continue;
      const distance = Math.hypot(x - eye.x, z - eye.z);
      // Stagger the transition across a stand so an entire ring never changes at once.
      const transition = .9 + (hash(ix, iz, 89) / 2 ** 32) * .2;
      if (distance >= ranges[level] * transition || (level && distance < ranges[level - 1] * transition)) continue;
      const lod = distance < (quality > .75 ? 240 : 160) ? 0 : canopyLod[level];
      yield { x, z, lod, level, seed: hash(ix, iz, 173) / 2 ** 32 };
    }
  }
}

/** Raw sRGB aerial colours: accept mixed canopy, reject pale roofs and blue water. */
export function woodland(c: number[]) {
  const [r, g, b] = c;
  return g > r * .98 && g > b * 1.06 && g - Math.min(r, b) > .025 && (r + g + b) / 3 < .62;
}

/** Leafless / autumn canopy can be brown or neutral in the regional photo.
 * Restrict this fallback to sloping ground; buildings, roads and water are excluded separately.
 */
export function seasonalWoodland(c:number[],normalY:number) {
  const [r,g,b]=c,mean=(r+g+b)/3;
  return normalY<.97 && mean>.08&&mean<.52 && g>r*.82&&g>b*.92&&r>b*.8 && Math.max(...c)-Math.min(...c)<.22;
}
