/**
 * A stylised map of the Kyoto basin, seen from Higashiyama looking west-south-west
 * (roughly the view from Shogunzuka). 1 unit ≈ 10 m.
 * Axes: +x east, +y up, +z south. Origin ≈ Shijo-Karasuma.
 */

export const CITY = { minX: -430, maxX: 200, minZ: -360, maxZ: 340, block: 12 };

export const VIEW = {
  camera: { x: 252, y: 34, z: 32 },
  target: { x: -150, y: 2, z: 120 },
};

export const LANDMARKS = {
  kyotoTower: { x: 2, z: 186 },
  kyotoStation: { x: 4, z: 204, w: 46, d: 6, h: 6 },
  toji: { x: -118, z: 236 },
  yasaka: { x: 192, z: 58 },
  campus: { x: -330, z: -20 },
  daimonji: { x: -478, z: -150, size: 20 },
  gosho: { minX: -12, maxX: 26, minZ: -190, maxZ: -96 },
  nijo: { minX: -82, maxX: -50, minZ: -74, maxZ: -48 },
};

/** Avenues that get taller buildings and moving traffic (x = const or z = const). */
export const AVENUES = {
  northSouth: [-150, -78, -42, 0, 66, 108],
  eastWest: [-160, -96, -40, 0, 60, 132, 228],
};

export const RIVER_HALF_WIDTH = 2.6;
export const riverX = (z: number) => 136 + 5 * Math.sin(z * 0.009) + 2 * Math.sin(z * 0.023 + 1.2);

/* ---------- deterministic noise for the terrain ---------- */

function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x: number, y: number, octaves = 5) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x, y);
    const nx = 0.8 * x - 0.6 * y;
    const ny = 0.6 * x + 0.8 * y;
    x = nx * 2.03 + 11.7;
    y = ny * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const bump = (x: number, z: number, cx: number, cz: number, r: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

/** Ground height in units. Flat in the basin, mountains to the east, north and west. */
export function heightAt(x: number, z: number) {
  const ridge = fbm(x * 0.006 + 3.1, z * 0.006 - 1.7);
  const fine = fbm(x * 0.03, z * 0.03, 3);

  // Higashiyama: low, wooded, close to the city
  const east = smooth(185, 300, x) * (16 + 22 * ridge + 10 * bump(x, z, 300, -120, 70));
  // Kitayama
  const north = smooth(-360, -520, z) * (30 + 45 * ridge);
  // Nishiyama, Arashiyama and Atago
  const west = smooth(-440, -580, x) * (34 + 46 * ridge + 55 * bump(x, z, -720, -160, 160));
  // far hills to the south
  const south = smooth(900, 1300, z) * (14 + 20 * ridge);

  let h = Math.max(east, north, west, south);
  h += Math.max(east, north, west) * (fine - 0.5) * 0.35;
  return h;
}

export function isRiver(x: number, z: number) {
  return Math.abs(x - riverX(z)) < RIVER_HALF_WIDTH + 2.5;
}

export function inRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0) {
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
}
