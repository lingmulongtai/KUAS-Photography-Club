import * as THREE from 'three';
import { pushQuad, pushTri, type GroundFn, type LandmarkBuilder, type LocalSite, type RGB, type Vec3 } from './landmark-builder';
import { at, block, frame, type XZ } from './landmark-kit';

/** Gable roof over a local rectangle, ridge along local x, eaves overhanging by `eave`. */
export function gable(b: LandmarkBuilder, f: LocalSite, x0: number, x1: number, z0: number, z1: number, y: number, rise: number,
  rgb: RGB, gableRgb: RGB, eave = .5, style = 4) {
  const zc = (z0 + z1) / 2;
  const e0 = at(f, x0 - eave, y, z0 - eave), e1 = at(f, x1 + eave, y, z0 - eave);
  const e2 = at(f, x1 + eave, y, z1 + eave), e3 = at(f, x0 - eave, y, z1 + eave);
  const r0 = at(f, x0 - eave, y + rise, zc), r1 = at(f, x1 + eave, y + rise, zc);
  const slope = rise / ((z1 - z0) / 2 + eave);
  // Local roof normal (0, 1, ±slope) normalised, then turned into the frame.
  const roofNormal = (sz: number): Vec3 => {
    const l = Math.hypot(1, slope);
    return [-(sz * slope / l) * f.s, 1 / l, (sz * slope / l) * f.c];
  };
  pushQuad(b, e1, e0, r0, r1, roofNormal(-1), rgb, .05, .05, style);
  pushQuad(b, e3, e2, r1, r0, roofNormal(1), rgb, .05, .05, style);
  const apex = y + rise * (1 - eave / ((z1 - z0) / 2 + eave));
  const g0 = at(f, x0, y, z0), g1 = at(f, x0, y, z1), gt = at(f, x0, apex, zc);
  const h0 = at(f, x1, y, z0), h1 = at(f, x1, y, z1), ht = at(f, x1, apex, zc);
  pushTri(b, g0, g1, gt, [-f.c, 0, -f.s], gableRgb, .1, 0, 0);
  pushTri(b, h1, h0, ht, [f.c, 0, f.s], gableRgb, .1, 0, 0);
}

export interface Facade {
  width: [number, number]; height: [number, number]; depth: number;
  walls: readonly RGB[]; roof?: 'flat' | 'gable' | 'snow'; roofRgb?: RGB; trim?: RGB;
  storey?: number; glow?: number; gap?: number;
}

const SHOPFRONT: RGB = [.20, .18, .16];
const PANE: RGB = [.19, .17, .15];

/**
 * A row of themed buildings facing a street polyline on one side (`side` ±1: right/left of travel),
 * set back by `setback`. Widths, heights and colours vary per building from a seeded stream.
 * Returns the footprint centres so callers can keep generic survey buildings out from under them.
 */
export function facadeRow(b: LandmarkBuilder, ground: GroundFn, line: readonly XZ[], side: number, setback: number,
  style: Facade, random: () => number, skip: (x: number, z: number) => boolean = () => false) {
  const centres: XZ[] = [];
  const glow = style.glow ?? .35;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], c = line[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 4) continue;
    const angle = Math.atan2(c.z - a.z, c.x - a.x);
    // In a frame turned by `angle`, local +z is to the right of travel.
    const nx = -Math.sin(angle) * side, nz = Math.cos(angle) * side;
    let t = random() * 2;
    while (t < len - 3) {
      const w = Math.min(style.width[0] + random() * (style.width[1] - style.width[0]), len - t);
      if (w < 3.5) break;
      const mid = t + w / 2;
      t += w + (style.gap ?? .3);
      const px = a.x + (c.x - a.x) * mid / len, pz = a.z + (c.z - a.z) * mid / len;
      const cx = px + nx * (setback + style.depth / 2), cz = pz + nz * (setback + style.depth / 2);
      if (skip(cx, cz)) continue;
      const f = frame(cx, cz, ground(cx, cz) - .3, angle);
      const h = style.height[0] + random() * (style.height[1] - style.height[0]);
      const wall = style.walls[Math.floor(random() * style.walls.length)];
      const trim = style.trim ?? [wall[0] * .7, wall[1] * .7, wall[2] * .7] as RGB;
      const hd = style.depth / 2, hw = w / 2;
      // The street is on the local −z side when side = +1.
      const front = -side * hd, out = -side;
      // Flat-roofed blocks take the cladding shader's storey joints on every side; cottages stay matte.
      const gabled = style.roof === 'gable' || style.roof === 'snow';
      block(b, f, -hw, hw, 0, h, -hd, hd, wall, { topRgb: style.roofRgb ?? trim, style: gabled ? 4 : 0, emit: glow });
      const skin = (depth: number) => out < 0 ? [front - depth, front] as const : [front, front + depth] as const;
      const [s0, s1] = skin(.12);
      block(b, f, -hw + .4, hw - .4, .2, 3.4, s0, s1, SHOPFRONT, { glass: .6, style: 2, emit: glow * 2.2, top: false });
      // A canopy over the shopfront.
      const [c0, c1] = skin(1.4);
      block(b, f, -hw + .3, hw - .3, 3.5, 3.75, c0, c1, trim, { style: 4 });
      const storey = style.storey ?? 3.4;
      const panes = Math.max(1, Math.floor((w - 1) / 2.3));
      for (let y = 4.4; y < h - 1.8; y += storey) {
        for (let k = 0; k < panes; k++) {
          const x = -hw + (k + .5) * w / panes;
          block(b, f, x - .5, x + .5, y, y + Math.min(2, storey - .9), s0, s1, PANE,
            { glass: .6, style: 2, emit: glow * (random() < .55 ? 1.8 : .25), top: false });
        }
      }
      const [k0, k1] = skin(.45);
      block(b, f, -hw - .2, hw + .2, h - .6, h, k0, k1, trim, { style: 4 });
      if (style.roof === 'gable' || style.roof === 'snow') {
        const rise = Math.min(hd * 1.6, 4.5 + random() * 3);
        gable(b, f, -hw, hw, -hd, hd, h, rise, style.roof === 'snow' ? [.74, .76, .79] : style.roofRgb ?? [.30, .26, .24], wall, .45);
        if (random() < .7) block(b, f, hw * .3, hw * .3 + 1, h + rise * .45, h + rise + 1.2, -.6, .6, [.30, .27, .25], { style: 4 });
      }
      centres.push({ x: cx, z: cz });
    }
  }
  return centres;
}

/** Distance from a point to a polyline. */
export function lineDistance(line: readonly XZ[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], c = line[i + 1];
    const dx = c.x - a.x, dz = c.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** Water surface over a world outline at height y. */
export function water(b: LandmarkBuilder, ring: readonly XZ[], y: number, rgb: RGB = [.05, .20, .28]) {
  const contour = ring.map(p => new THREE.Vector2(p.x, p.z));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = ring[i], B = ring[j], C = ring[k];
    const cross = (B.x - A.x) * (C.z - A.z) - (B.z - A.z) * (C.x - A.x);
    const [P, Q] = cross < 0 ? [B, C] : [C, B];
    pushTri(b, [A.x, y, A.z], [P.x, y, P.z], [Q.x, y, Q.z], [0, 1, 0], rgb, .14, .96, 5);
  }
}
