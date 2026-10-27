import { loadBinary } from './data.ts';
import type { LineFeature } from './lines-data.ts';

/** Road tunnels from tunnels.json.gz (see tools/kyoto-data/build_tunnels.py): x0, z0, x1, z1 … metres. */
export type TunnelLine = ArrayLike<number>;

/** How far a road may sit from a tunnel's centre line and still be that tunnel (both are simplified). */
const REACH = 4;
/** Only roads running along a tunnel are cut; a road crossing the mountain above one keeps its surface. */
const PARALLEL = 0.85;
/** Sample spacing along a road, metres. */
const STEP = 2;
/** Shorter stretches are noise from simplification, not a tunnel. */
const MIN_RUN = 6;
const CELL = 64;

let cache: Promise<TunnelLine[]> | undefined;

/** Loaded once for the core and every region; without the file roads are kept as they were. */
export function loadTunnels() {
  cache ??= loadBinary('tunnels.json.gz')
    .then(bytes => (JSON.parse(new TextDecoder().decode(bytes)) as { lines: number[][] }).lines)
    .catch(error => {
      console.warn('Tunnel data unavailable; roads keep their surface course', error);
      return [];
    });
  return cache;
}

/** Lines as the scene draws them: roads without the stretches inside tunnels. */
export async function withoutTunnels(lines: Promise<LineFeature[]>) {
  const [l, t] = await Promise.all([lines, loadTunnels()]);
  return cutTunnels(l, t);
}

/**
 * Remove the stretches of every road that run inside a tunnel, so they are not draped over the
 * hill above it. The road on either side of the portals stays; other features are untouched and
 * keep their order.
 */
export function cutTunnels(lines: LineFeature[], tunnels: TunnelLine[], roadKind = 0) {
  if (!tunnels.length) return lines;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096;
  const segs: number[] = [];
  for (const t of tunnels) {
    for (let i = 0; i + 3 < t.length; i += 2) {
      const ax = t[i], az = t[i + 1], bx = t[i + 2], bz = t[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len === 0) continue;
      const s = segs.length / 6;
      segs.push(ax, az, bx, bz, (bx - ax) / len, (bz - az) / len);
      for (let cx = Math.floor((Math.min(ax, bx) - REACH) / CELL); cx <= Math.floor((Math.max(ax, bx) + REACH) / CELL); cx++)
        for (let cz = Math.floor((Math.min(az, bz) - REACH) / CELL); cz <= Math.floor((Math.max(az, bz) + REACH) / CELL); cz++) {
          const cell = grid.get(key(cx, cz));
          if (cell) cell.push(s); else grid.set(key(cx, cz), [s]);
        }
    }
  }
  const inside = (x: number, z: number, ux: number, uz: number) => {
    const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return false;
    for (const s of cell) {
      const o = s * 6, ax = segs[o], az = segs[o + 1], dx = segs[o + 2] - ax, dz = segs[o + 3] - az;
      if (Math.abs(ux * segs[o + 4] + uz * segs[o + 5]) < PARALLEL) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= REACH) return true;
    }
    return false;
  };

  const near = (p: Float32Array) => {
    for (let i = 0; i + 3 < p.length; i += 2)
      for (let cx = Math.floor(Math.min(p[i], p[i + 2]) / CELL); cx <= Math.floor(Math.max(p[i], p[i + 2]) / CELL); cx++)
        for (let cz = Math.floor(Math.min(p[i + 1], p[i + 3]) / CELL); cz <= Math.floor(Math.max(p[i + 1], p[i + 3]) / CELL); cz++)
          if (grid.has(key(cx, cz))) return true;
    return false;
  };

  const out: LineFeature[] = [];
  for (const f of lines) {
    if (f.kind !== roadKind || !near(f.pts)) { out.push(f); continue; }
    const p = f.pts;
    // sample the road at its vertices and every STEP metres between them
    const xs: number[] = [], zs: number[] = [], ins: boolean[] = [], vertex: boolean[] = [], dist: number[] = [];
    let along = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, len = Math.hypot(dx, dz);
      if (len === 0) continue;
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = xs.length ? 1 : 0; k <= n; k++) {
        const x = ax + dx * k / n, z = az + dz * k / n;
        xs.push(x); zs.push(z); ins.push(inside(x, z, dx / len, dz / len));
        vertex.push(k === 0 || k === n); dist.push(along + len * k / n);
      }
      along += len;
    }
    if (!ins.includes(true)) { out.push(f); continue; }
    // ignore runs too short to be a tunnel, in either direction
    for (let a = 0; a < ins.length;) {
      let b = a;
      while (b + 1 < ins.length && ins[b + 1] === ins[a]) b++;
      if (ins[a] && dist[b] - dist[a] < MIN_RUN) for (let k = a; k <= b; k++) ins[k] = false;
      a = b + 1;
    }
    let piece: number[] = [];
    const flush = () => {
      if (piece.length >= 4) out.push({ kind: f.kind, attr: f.attr, pts: new Float32Array(piece) });
      piece = [];
    };
    for (let k = 0; k < xs.length; k++) {
      if (ins[k]) { flush(); continue; }
      // keep the road's own vertices and the samples next to a portal, drop the rest
      if (vertex[k] || ins[k - 1] || ins[k + 1]) piece.push(xs[k], zs[k]);
    }
    flush();
  }
  return out;
}
