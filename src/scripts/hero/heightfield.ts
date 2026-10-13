import type { Box } from './geo';
import { loadGrid, type GridMeta, type TerrainMeta } from './data';

class Grid {
  constructor(
    readonly meta: GridMeta,
    readonly h: Float32Array,
  ) {}

  /** Bilinear height at (x, z), or NaN outside the grid. */
  sample(x: number, z: number) {
    const { box, step, nx, nz } = this.meta;
    const fx = (x - box[0]) / step;
    const fz = (z - box[1]) / step;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return NaN;
    const i = Math.min(Math.floor(fx), nx - 2);
    const j = Math.min(Math.floor(fz), nz - 2);
    const tx = fx - i;
    const tz = fz - j;
    const o = j * nx + i;
    const a = this.h[o];
    const b = this.h[o + 1];
    const c = this.h[o + nx];
    const d = this.h[o + nx + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Ground elevation for the whole scene: the 10 m grid around Higashiyama blended into the
 * 30 m grid of the whole basin over a 300 m band at the edge of the detailed area.
 */
export class Heightfield {
  constructor(
    private far: Grid,
    private near: Grid,
  ) {}

  get bounds(): Box {
    return this.far.meta.box;
  }

  height(x: number, z: number) {
    const f = this.far.sample(x, z);
    const far = Number.isNaN(f) ? 0 : f;
    const b = this.near.meta.box;
    const edge = Math.min(x - b[0], b[2] - x, z - b[1], b[3] - z);
    if (edge <= 0) return far;
    const n = this.near.sample(x, z);
    if (Number.isNaN(n)) return far;
    const w = smooth(0, 300, edge);
    return far + (n - far) * w;
  }

  /** Unit normal from central differences, `e` metres apart. */
  normal(x: number, z: number, e = 15, out = { x: 0, y: 1, z: 0 }) {
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -dx / (2 * e);
    const nz = -dz / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    out.x = nx / l;
    out.y = 1 / l;
    out.z = nz / l;
    return out;
  }
}

export async function loadHeightfield(meta: TerrainMeta) {
  const [far, near] = await Promise.all([loadGrid(meta.far), loadGrid(meta.near)]);
  return new Heightfield(new Grid(meta.far, far), new Grid(meta.near, near));
}
