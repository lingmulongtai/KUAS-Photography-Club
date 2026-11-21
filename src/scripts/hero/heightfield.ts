import type { Box } from './geo';
import { loadGrid, type GridMeta, type TerrainMeta } from './data.ts';

class Grid {
  readonly meta:GridMeta;
  readonly h:Float32Array;
  constructor(meta:GridMeta,h:Float32Array) {this.meta=meta;this.h=h;}

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

type GridData = Pick<Grid, 'meta' | 'h'>;
type HeightfieldData = [GridData, GridData, GridData?, GridData?, GridData?];

/**
 * Ground elevation for the whole scene: the 10 m grid around Higashiyama blended into the
 * 30 m grid of the whole basin over a 300 m band at the edge of the detailed area.
 */
export class Heightfield {
  private far:Grid;
  private near:Grid;
  private regional?:Grid;
  private outer?:Grid;
  private campus?:Grid;
  private layers: { grid: Grid; margin: number }[] = [];
  constructor(far:Grid,near:Grid,regional?:Grid,outer?:Grid,campus?:Grid) {
    this.far=far;this.near=near;this.regional=regional;this.outer=outer;this.campus=campus;
    if (outer) this.layers.push({ grid: far, margin: 300 });
    this.layers.push({ grid: near, margin: 300 });
    if (regional) this.layers.push({ grid: regional, margin: 120 });
    if (campus) this.layers.push({ grid: campus, margin: 80 });
  }

  /** Structured cloning copies the elevation arrays to the worker without detaching the live terrain. */
  snapshot(): HeightfieldData {
    return [this.far, this.near, this.regional, this.outer, this.campus];
  }

  static fromSnapshot([far, near, regional, outer, campus]: HeightfieldData) {
    const grid = ({ meta, h }: GridData) => new Grid(meta, h);
    return new Heightfield(grid(far), grid(near), regional && grid(regional), outer && grid(outer), campus && grid(campus));
  }

  get bounds(): Box {
    return (this.outer ?? this.far).meta.box;
  }

  height(x: number, z: number) {
    return this.sampleLayers(x, z, this.layers.length - 1);
  }

  private sampleLayers(x: number, z: number, top: number): number {
    // A road in the interior of a detailed grid needs one bilinear sample.
    // Only its transition band needs the lower layers to contribute.
    for (let i = top; i >= 0; i--) {
      const { grid, margin } = this.layers[i];
      const b = grid.meta.box;
      if (x <= b[0] || x >= b[2] || z <= b[1] || z >= b[3]) continue;
      const height = grid.sample(x, z);
      if (Number.isNaN(height)) continue;
      const edge = Math.min(x - b[0], b[2] - x, z - b[1], b[3] - z);
      if (edge >= margin) return height;
      const base = this.sampleLayers(x, z, i - 1);
      const t = edge / margin;
      return base + (height - base) * (t * t * (3 - 2 * t));
    }
    const base = (this.outer ?? this.far).sample(x, z);
    return Number.isNaN(base) ? 0 : base;
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
  const [far, near, regional, outer, campus] = await Promise.all([loadGrid(meta.far), loadGrid(meta.near),
    meta.arashiyama ? loadGrid(meta.arashiyama.elevation).catch(error=>{
      console.warn('Arashiyama elevation unavailable; using basin terrain',error);
      return null;
    }) : null, meta.outer ? loadGrid(meta.outer).catch(error=>{
      console.warn('Outer elevation unavailable; retaining Kyoto basin',error);return null;
    }) : null,meta.kameokaCampus?loadGrid(meta.kameokaCampus.elevation).catch(error=>{
      console.warn('Kameoka campus elevation unavailable; retaining outer terrain',error);return null;
    }):null]);
  return new Heightfield(new Grid(meta.far, far), new Grid(meta.near, near),
    regional && meta.arashiyama ? new Grid(meta.arashiyama.elevation,regional) : undefined,
    outer && meta.outer ? new Grid(meta.outer,outer) : undefined,
    campus&&meta.kameokaCampus?new Grid(meta.kameokaCampus.elevation,campus):undefined);
}
