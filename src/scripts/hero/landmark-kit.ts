import * as THREE from 'three';
import { toLocal } from './geo';
import {
  addLight, addStrut, pushQuad, pushTri,
  type GroundFn, type LandmarkBuilder, type LocalSite, type RGB, type Vec3,
} from './landmark-builder';

export type XZ = { x: number; z: number };

/** OSM outline ([lat, lon, …], closed) in viewer metres, without the repeated last point. */
export function ringOf(flat: readonly number[]): XZ[] {
  const ring: XZ[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push(toLocal(flat[i], flat[i + 1]));
  const a = ring[0], z = ring[ring.length - 1];
  if (ring.length > 1 && Math.hypot(a.x - z.x, a.z - z.z) < 1e-3) ring.pop();
  return ring;
}

export function centroid(ring: readonly XZ[]): XZ {
  let x = 0, z = 0, area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const c = p.x * q.z - q.x * p.z;
    area += c;
    x += (p.x + q.x) * c;
    z += (p.z + q.z) * c;
  }
  return area ? { x: x / (3 * area), z: z / (3 * area) } : ring[0];
}

/** A frame on the ground at (x, z) whose local +x points along `angle` (radians from east towards south). */
export function frame(x: number, z: number, y: number, angle: number): LocalSite {
  return { ox: x, oy: y, oz: z, c: Math.cos(angle), s: Math.sin(angle) };
}

/** World point into a frame's local horizontal coordinates. */
export function toFrame(f: LocalSite, p: XZ): XZ {
  const dx = p.x - f.ox, dz = p.z - f.oz;
  return { x: dx * f.c + dz * f.s, z: -dx * f.s + dz * f.c };
}

/** The direction of the longest edge of an outline, folded into [0, π/2). */
export function dominantAngle(ring: readonly XZ[]) {
  let best = 0, length = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    if (l > length) { length = l; best = Math.atan2(q.z - p.z, q.x - p.x); }
  }
  const quarter = Math.PI / 2;
  return ((best % quarter) + quarter) % quarter;
}

/** Bounds of an outline in a frame's local coordinates. */
export function localBounds(f: LocalSite, ring: readonly XZ[]) {
  const pts = ring.map(p => toFrame(f, p));
  return {
    x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)),
    z0: Math.min(...pts.map(p => p.z)), z1: Math.max(...pts.map(p => p.z)),
  };
}

function signedArea(ring: readonly XZ[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Pull an outline inwards (negative grows it) along each vertex's bisector. */
export function inset(ring: readonly XZ[], d: number): XZ[] {
  const ccw = signedArea(ring) > 0 ? 1 : -1;
  return ring.map((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    const e1 = norm2(p.x - a.x, p.z - a.z), e2 = norm2(c.x - p.x, c.z - p.z);
    // Inward normals of the two edges in the x/z plane (+z south).
    const n1 = { x: -e1.z * ccw, z: e1.x * ccw }, n2 = { x: -e2.z * ccw, z: e2.x * ccw };
    const m = norm2(n1.x + n2.x, n1.z + n2.z);
    const k = d / Math.max(.35, m.x * n1.x + m.z * n1.z);
    return { x: p.x + m.x * k, z: p.z + m.z * k };
  });
}

function norm2(x: number, z: number) {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

export interface PrismOpts {
  topRgb?: RGB; emit?: number; glass?: number; style?: number; topStyle?: number; topEmit?: number;
  top?: boolean; bottom?: boolean;
}

/** Vertical walls and a flat top over a world outline between heights y0 and y1. */
export function prism(b: LandmarkBuilder, ring: readonly XZ[], y0: number, y1: number, rgb: RGB, opts: PrismOpts = {}) {
  const ccw = signedArea(ring) > 0 ? 1 : -1;
  const em = opts.emit ?? 0, gl = opts.glass ?? 0, st = opts.style ?? (gl > .4 ? 1 : 0);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const e = norm2(q.x - p.x, q.z - p.z);
    const n: Vec3 = [e.z * ccw, 0, -e.x * ccw];
    const a: Vec3 = [p.x, y0, p.z], c: Vec3 = [q.x, y0, q.z], d: Vec3 = [q.x, y1, q.z], f: Vec3 = [p.x, y1, p.z];
    if (ccw > 0) pushQuad(b, c, a, f, d, n, rgb, em, gl, st);
    else pushQuad(b, a, c, d, f, n, rgb, em, gl, st);
  }
  if (opts.top === false && !opts.bottom) return;
  const contour = ring.map(p => new THREE.Vector2(p.x, p.z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const topRgb = opts.topRgb ?? rgb;
  for (const [i, j, k] of tris) {
    const A = ring[i], B = ring[j], C = ring[k];
    // Order counter-clockwise when seen from above (+y): with +z south that is a negative x/z cross.
    const cross = (B.x - A.x) * (C.z - A.z) - (B.z - A.z) * (C.x - A.x);
    const [P, Q] = cross < 0 ? [B, C] : [C, B];
    if (opts.top !== false) {
      pushTri(b, [A.x, y1, A.z], [P.x, y1, P.z], [Q.x, y1, Q.z], [0, 1, 0], topRgb, opts.topEmit ?? em * .2, gl * .2, opts.topStyle ?? 0);
    }
    if (opts.bottom) pushTri(b, [A.x, y0, A.z], [Q.x, y0, Q.z], [P.x, y0, P.z], [0, -1, 0], rgb, 0, 0, 0);
  }
}

/** A box in a frame, spanning [x0, x1] × [y0, y1] × [z0, z1] in local metres. */
export function block(b: LandmarkBuilder, f: LocalSite, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
  rgb: RGB, opts: PrismOpts = {}) {
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({
    x: f.ox + x * f.c - z * f.s, z: f.oz + x * f.s + z * f.c,
  }));
  prism(b, corners, f.oy + y0, f.oy + y1, rgb, opts);
}

/** Local frame point to world. */
export function at(f: LocalSite, x: number, y: number, z: number): Vec3 {
  return [f.ox + x * f.c - z * f.s, f.oy + y, f.oz + x * f.s + z * f.c];
}

export interface CoasterWay { layer: number; points: readonly number[] }

/**
 * Coaster track from OSM centrelines. OSM gives only `layer`, so heights are spread along the
 * connected network: every node starts at its ways' layer height and is relaxed towards its
 * neighbours, which turns steps between ways into ramps and drops. Stations (layer −1) stay low.
 */
export function coaster(b: LandmarkBuilder, ground: GroundFn, ways: readonly CoasterWay[], opts: {
  peak: number; rail: RGB; spine: RGB; support: RGB; gauge?: number; glow?: RGB; supportEvery?: number;
}) {
  const key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
  type Node = { p: XZ; h: number; pinned: boolean; next: Set<Node> };
  const nodes = new Map<string, Node>();
  const layerHeight = (layer: number) => layer < 0 ? 1.6 : [5, .42, .7, 1][Math.min(layer, 3)] * (layer ? opts.peak : 1);
  const paths: Node[][] = [];
  for (const way of ways) {
    const path: Node[] = [];
    for (let i = 0; i < way.points.length; i += 2) {
      const k = key(way.points[i], way.points[i + 1]);
      let n = nodes.get(k);
      const h = layerHeight(way.layer);
      if (!n) nodes.set(k, n = { p: toLocal(way.points[i], way.points[i + 1]), h, pinned: way.layer < 0, next: new Set() });
      else { n.h = Math.max(n.h, h); n.pinned ||= way.layer < 0; }
      const prev = path[path.length - 1];
      if (prev && prev !== n) { prev.next.add(n); n.next.add(prev); }
      path.push(n);
    }
    paths.push(path);
  }
  for (let it = 0; it < 40; it++) {
    for (const n of nodes.values()) {
      if (n.pinned || !n.next.size) continue;
      let sum = 0, w = 0;
      for (const m of n.next) {
        const d = Math.max(4, Math.hypot(m.p.x - n.p.x, m.p.z - n.p.z));
        sum += m.h / d; w += 1 / d;
      }
      n.h = n.h * .45 + (sum / w) * .55;
    }
  }
  const gauge = opts.gauge ?? .62;
  const every = opts.supportEvery ?? 13;
  for (const path of paths) {
    if (path.length < 2) continue;
    // Resample at ~2 m with linear height between nodes, then smooth the centreline.
    const pts: Vec3[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], c = path[i + 1];
      const len = Math.hypot(c.p.x - a.p.x, c.p.z - a.p.z);
      const steps = Math.max(1, Math.ceil(len / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = a.p.x + (c.p.x - a.p.x) * t, z = a.p.z + (c.p.z - a.p.z) * t;
        pts.push([x, ground(x, z) + a.h + (c.h - a.h) * t, z]);
      }
    }
    const last = path[path.length - 1];
    pts.push([last.p.x, ground(last.p.x, last.p.z) + last.h, last.p.z]);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        for (let c = 0; c < 3; c++) pts[i][c] = pts[i][c] * .5 + (pts[i - 1][c] + pts[i + 1][c]) * .25;
      }
    }
    let travelled = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[2] - a[2];
      const len = Math.hypot(dx, dz) || 1;
      const side: Vec3 = [-dz / len * gauge, 0, dx / len * gauge];
      // Two running rails above a box-section spine, as on a steel coaster.
      for (const s of [-1, 1]) {
        addStrut(b, [a[0] + side[0] * s, a[1] + .55, a[2] + side[2] * s], [c[0] + side[0] * s, c[1] + .55, c[2] + side[2] * s],
          .11, .11, 5, opts.rail, opts.glow ? .5 : 0, .3, opts.glow ? 3 : 0);
      }
      addStrut(b, a, c, .32, .32, 6, opts.spine, 0, .2, 0);
      travelled += Math.hypot(len, c[1] - a[1]);
      if (travelled >= every) {
        travelled = 0;
        const g = ground(a[0], a[2]);
        if (a[1] - g > 2.5) {
          addStrut(b, [a[0], g, a[2]], [a[0], a[1] - .2, a[2]], .42, .3, 6, opts.support);
          if (opts.glow) addLight(b, [a[0], a[1] + .8, a[2]], opts.glow, 1.1);
        }
      }
    }
  }
}

/** Crenellated parapet along a local rectangle's edges. */
export function battlements(b: LandmarkBuilder, f: LocalSite, x0: number, x1: number, z0: number, z1: number, y: number,
  rgb: RGB, merlon = 1.1, height = 1.2) {
  const edges: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  for (const [ax, az, cx, cz] of edges) {
    const len = Math.hypot(cx - ax, cz - az), n = Math.max(1, Math.floor(len / (merlon * 2)));
    for (let i = 0; i < n; i++) {
      const t0 = (i * 2 + .5) / (n * 2), t1 = (i * 2 + 1.5) / (n * 2);
      const px0 = ax + (cx - ax) * t0, pz0 = az + (cz - az) * t0, px1 = ax + (cx - ax) * t1, pz1 = az + (cz - az) * t1;
      const w = .45;
      block(b, f, Math.min(px0, px1) - (az === cz ? 0 : w), Math.max(px0, px1) + (az === cz ? 0 : w), y, y + height,
        Math.min(pz0, pz1) - (az === cz ? w : 0), Math.max(pz0, pz1) + (az === cz ? w : 0), rgb, { style: 4 });
    }
  }
}

/** Point in a world outline (even-odd). */
export function inRing(ring: readonly XZ[], x: number, z: number) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if ((a.z > z) !== (c.z > z) && x < (c.x - a.x) * (z - a.z) / (c.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}
