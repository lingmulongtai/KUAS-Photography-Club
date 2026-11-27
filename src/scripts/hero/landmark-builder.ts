import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import { toLocal } from './geo';

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];
export type GroundFn = (x: number, z: number) => number;

export type MaskShape =
  | { kind: 'circle'; x: number; z: number; r2: number }
  | { kind: 'obb'; x: number; z: number; c: number; s: number; hx: number; hz: number };

export function makeCircleMask(lat: number, lon: number, radius: number): MaskShape {
  const p = toLocal(lat, lon);
  return { kind: 'circle', x: p.x, z: p.z, r2: radius * radius };
}

export function makeObbMask(lat: number, lon: number, rotY: number, halfX: number, halfZ: number): MaskShape {
  const p = toLocal(lat, lon);
  return { kind: 'obb', x: p.x, z: p.z, c: Math.cos(rotY), s: Math.sin(rotY), hx: halfX, hz: halfZ };
}

export function inMaskShapes(masks: readonly MaskShape[], x: number, z: number): boolean {
  for (const m of masks) {
    const dx = x - m.x;
    const dz = z - m.z;
    if (m.kind === 'circle') {
      if (dx * dx + dz * dz < m.r2) return true;
    } else {
      const lx = dx * m.c + dz * m.s;
      const lz = -dx * m.s + dz * m.c;
      if (Math.abs(lx) < m.hx && Math.abs(lz) < m.hz) return true;
    }
  }
  return false;
}

/**
 * Shared vertex/light accumulator for high-detail Kansai architectural landmarks.
 * Material styles (aStyle):
 *   0: structural steel / stone / plaster / concrete cladding
 *   1: precision skyscraper curtain-wall glass (mullions, floor spandrels, varied office/hotel night glow)
 *   2: luminous sky-atrium / observatory / warm hall glazing
 *   3: architectural neon / LED / Ferris wheel crimson / golden ornament accents
 *   4: matte sculpted surfaces (traditional kawara roof tiles, cliff crag, greenery, theme-park facades)
 *   5: shimmering reflective park water (lagoons, ponds, reflecting basins)
 */
export interface LandmarkBuilder {
  pos: number[];
  nrm: number[];
  col: number[];
  emit: number[];
  glass: number[];
  style: number[];
  lightPos: number[];
  lightCol: number[];
  lightSize: number[];
  lightPhase: number[]; // 0: steady architectural accent, >=1: pulsing red aviation beacon
}

export function createLandmarkBuilder(): LandmarkBuilder {
  return {
    pos: [],
    nrm: [],
    col: [],
    emit: [],
    glass: [],
    style: [],
    lightPos: [],
    lightCol: [],
    lightSize: [],
    lightPhase: [],
  };
}

export interface LocalSite {
  ox: number;
  oy: number;
  oz: number;
  c: number;
  s: number;
}

export function makeSite(lat: number, lon: number, ground: GroundFn, rotY: number, sink = 2.0): LocalSite {
  const p = toLocal(lat, lon);
  return { ox: p.x, oy: ground(p.x, p.z) - sink, oz: p.z, c: Math.cos(rotY), s: Math.sin(rotY) };
}

export function sitePt(st: LocalSite, lx: number, ly: number, lz: number): Vec3 {
  return [st.ox + lx * st.c - lz * st.s, st.oy + ly, st.oz + lx * st.s + lz * st.c];
}

export function siteNrm(st: LocalSite, nx: number, ny: number, nz: number): Vec3 {
  const x = nx * st.c - nz * st.s;
  const z = nx * st.s + nz * st.c;
  const inv = 1 / (Math.hypot(x, ny, z) || 1);
  return [x * inv, ny * inv, z * inv];
}

export function pushTri(
  b: LandmarkBuilder,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  n: Vec3,
  rgb: RGB,
  em = 0,
  gl = 0,
  st = 0,
) {
  for (const v of [p0, p1, p2]) {
    b.pos.push(v[0], v[1], v[2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.col.push(rgb[0], rgb[1], rgb[2]);
    b.emit.push(em);
    b.glass.push(gl);
    b.style.push(st);
  }
}

export function pushQuad(
  b: LandmarkBuilder,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  n: Vec3,
  rgb: RGB,
  em = 0,
  gl = 0,
  st = 0,
) {
  pushTri(b, p0, p1, p2, n, rgb, em, gl, st);
  pushTri(b, p0, p2, p3, n, rgb, em, gl, st);
}

export interface BoxOpts {
  topRgb?: RGB;
  bottomRgb?: RGB;
  emit?: number;
  topEmit?: number;
  glass?: number;
  style?: number;
  topStyle?: number;
  includeBottom?: boolean;
}

export function addBox(
  b: LandmarkBuilder,
  site: LocalSite,
  lx: number,
  ly0: number,
  lz: number,
  sx: number,
  sy: number,
  sz: number,
  rgb: RGB,
  opts?: BoxOpts,
) {
  const hx = sx * 0.5, hz = sz * 0.5;
  const b00 = sitePt(site, lx - hx, ly0, lz - hz);
  const b10 = sitePt(site, lx + hx, ly0, lz - hz);
  const b11 = sitePt(site, lx + hx, ly0, lz + hz);
  const b01 = sitePt(site, lx - hx, ly0, lz + hz);
  const t00 = sitePt(site, lx - hx, ly0 + sy, lz - hz);
  const t10 = sitePt(site, lx + hx, ly0 + sy, lz - hz);
  const t11 = sitePt(site, lx + hx, ly0 + sy, lz + hz);
  const t01 = sitePt(site, lx - hx, ly0 + sy, lz + hz);
  const em = opts?.emit ?? 0;
  const topEm = opts?.topEmit ?? em * 0.20;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? (gl > 0.4 ? 1 : 0);
  const topSt = opts?.topStyle ?? (st === 2 || st === 3 || st === 4 ? st : 0);
  const topRgb = opts?.topRgb ?? rgb;
  const sideTint: RGB = [rgb[0] * 0.94, rgb[1] * 0.94, rgb[2] * 0.94];

  pushQuad(b, t00, t01, t11, t10, [0, 1, 0], topRgb, topEm, gl * 0.18, topSt);
  pushQuad(b, b01, b11, t11, t01, siteNrm(site, 0, 0, 1), rgb, em, gl, st);
  pushQuad(b, b10, b00, t00, t10, siteNrm(site, 0, 0, -1), rgb, em, gl, st);
  pushQuad(b, b11, b10, t10, t11, siteNrm(site, 1, 0, 0), sideTint, em, gl, st);
  pushQuad(b, b00, b01, t01, t00, siteNrm(site, -1, 0, 0), sideTint, em, gl, st);
  if (opts?.includeBottom) {
    const botRgb = opts.bottomRgb ?? [rgb[0] * 0.65, rgb[1] * 0.65, rgb[2] * 0.65];
    pushQuad(b, b00, b10, b11, b01, [0, -1, 0], botRgb, em * 0.15, 0, st === 4 ? 4 : 0);
  }
}

export function addFrustum(
  b: LandmarkBuilder,
  site: LocalSite,
  lx: number,
  ly0: number,
  lz: number,
  rBottom: number,
  rTop: number,
  h: number,
  sides: number,
  rgb: RGB,
  opts?: {
    phase?: number;
    topRgb?: RGB;
    bottomRgb?: RGB;
    emit?: number;
    topEmit?: number;
    glass?: number;
    style?: number;
    capTop?: boolean;
    capBottom?: boolean;
  },
) {
  const phase = opts?.phase ?? 0;
  const em = opts?.emit ?? 0;
  const topEm = opts?.topEmit ?? em * 0.25;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? (gl > 0.4 ? 1 : 0);
  const topRgb = opts?.topRgb ?? rgb;
  const botRgb = opts?.bottomRgb ?? [rgb[0] * 0.68, rgb[1] * 0.68, rgb[2] * 0.68];
  const slopeY = (rBottom - rTop) / (h || 1);

  const botPts: Vec3[] = [];
  const topPts: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    botPts.push(sitePt(site, lx + ca * rBottom, ly0, lz + sa * rBottom));
    topPts.push(sitePt(site, lx + ca * rTop, ly0 + h, lz + sa * rTop));
  }
  const topCenter = sitePt(site, lx, ly0 + h, lz);
  const botCenter = sitePt(site, lx, ly0, lz);

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const midA = phase + ((i + 0.5) / sides) * Math.PI * 2;
    const n = siteNrm(site, Math.cos(midA), slopeY, Math.sin(midA));
    pushQuad(b, botPts[j], botPts[i], topPts[i], topPts[j], n, rgb, em, gl, st);
    if (opts?.capTop !== false && rTop > 1e-4) {
      pushTri(b, topCenter, topPts[j], topPts[i], [0, 1, 0], topRgb, topEm, gl * 0.2, st === 2 || st === 3 || st === 4 ? st : 0);
    }
    if (opts?.capBottom && rBottom > 1e-4) {
      pushTri(b, botCenter, botPts[i], botPts[j], [0, -1, 0], botRgb, em * 0.15, 0, st === 4 ? 4 : 0);
    }
  }
}

/** Smooth sphere or dome (Universal Globe, Discovery Restaurant dome, Tsutenkaku crown cap). */
export function addDome(
  b: LandmarkBuilder,
  site: LocalSite,
  lx: number,
  lyCenter: number,
  lz: number,
  rx: number,
  ry: number,
  rz: number,
  rings: number,
  sides: number,
  rgb: RGB,
  opts?: { latMin?: number; latMax?: number; emit?: number; glass?: number; style?: number },
) {
  const latMin = opts?.latMin ?? 0;
  const latMax = opts?.latMax ?? Math.PI * 0.5;
  const em = opts?.emit ?? 0;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? 4;
  for (let r = 0; r < rings; r++) {
    const p0 = latMin + ((latMax - latMin) * r) / rings;
    const p1 = latMin + ((latMax - latMin) * (r + 1)) / rings;
    const cp0 = Math.cos(p0), sp0 = Math.sin(p0);
    const cp1 = Math.cos(p1), sp1 = Math.sin(p1);
    const pm = (p0 + p1) * 0.5;
    const cpm = Math.cos(pm), spm = Math.sin(pm);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const am = ((i + 0.5) / sides) * Math.PI * 2;
      const q00 = sitePt(site, lx + Math.cos(a0) * cp0 * rx, lyCenter + sp0 * ry, lz + Math.sin(a0) * cp0 * rz);
      const q10 = sitePt(site, lx + Math.cos(a1) * cp0 * rx, lyCenter + sp0 * ry, lz + Math.sin(a1) * cp0 * rz);
      const q11 = sitePt(site, lx + Math.cos(a1) * cp1 * rx, lyCenter + sp1 * ry, lz + Math.sin(a1) * cp1 * rz);
      const q01 = sitePt(site, lx + Math.cos(a0) * cp1 * rx, lyCenter + sp1 * ry, lz + Math.sin(a0) * cp1 * rz);
      const n = siteNrm(site, (Math.cos(am) * cpm) / (rx || 1), spm / (ry || 1), (Math.sin(am) * cpm) / (rz || 1));
      pushQuad(b, q10, q00, q01, q11, n, rgb, em, gl, st);
    }
  }
}

export function addAnnulusRing(
  b: LandmarkBuilder,
  site: LocalSite,
  lx: number,
  ly0: number,
  lz: number,
  rInner: number,
  rOuter: number,
  h: number,
  sides: number,
  rgb: RGB,
  opts?: {
    topRgb?: RGB;
    innerRgb?: RGB;
    emit?: number;
    innerEmit?: number;
    topEmit?: number;
    glass?: number;
    style?: number;
    innerStyle?: number;
  },
) {
  const em = opts?.emit ?? 0;
  const innerEm = opts?.innerEmit ?? em;
  const topEm = opts?.topEmit ?? em * 0.35;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? (gl > 0.4 ? 1 : 0);
  const inSt = opts?.innerStyle ?? st;
  const topRgb = opts?.topRgb ?? rgb;
  const innerRgb = opts?.innerRgb ?? rgb;
  const botRgb: RGB = [rgb[0] * 0.62, rgb[1] * 0.62, rgb[2] * 0.62];

  const bi: Vec3[] = [], bo: Vec3[] = [], ti: Vec3[] = [], to: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    bi.push(sitePt(site, lx + ca * rInner, ly0, lz + sa * rInner));
    bo.push(sitePt(site, lx + ca * rOuter, ly0, lz + sa * rOuter));
    ti.push(sitePt(site, lx + ca * rInner, ly0 + h, lz + sa * rInner));
    to.push(sitePt(site, lx + ca * rOuter, ly0 + h, lz + sa * rOuter));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const midA = ((i + 0.5) / sides) * Math.PI * 2;
    const nOut = siteNrm(site, Math.cos(midA), 0, Math.sin(midA));
    const nIn: Vec3 = [-nOut[0], 0, -nOut[2]];
    pushQuad(b, bo[j], bo[i], to[i], to[j], nOut, rgb, em, gl, st);
    pushQuad(b, bi[i], bi[j], ti[j], ti[i], nIn, innerRgb, innerEm, gl, inSt);
    pushQuad(b, ti[i], ti[j], to[j], to[i], [0, 1, 0], topRgb, topEm, gl * 0.15, st === 3 || st === 4 ? st : 0);
    pushQuad(b, bi[j], bi[i], bo[i], bo[j], [0, -1, 0], botRgb, 0, 0, 0);
  }
}

export function addRectWithCircularAperture(
  b: LandmarkBuilder,
  site: LocalSite,
  ly0: number,
  h: number,
  halfW: number,
  halfD: number,
  rInner: number,
  segsPerSide: number,
  outerRgb: RGB,
  innerRgb: RGB,
  topRgb: RGB,
  opts?: {
    emit?: number;
    innerEmit?: number;
    glass?: number;
    innerGlass?: number;
    style?: number;
    innerStyle?: number;
    bottomRgb?: RGB;
  },
) {
  const outer2D: [number, number][] = [];
  const pushEdge = (x0: number, z0: number, x1: number, z1: number) => {
    for (let k = 0; k < segsPerSide; k++) {
      const t = k / segsPerSide;
      outer2D.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
    }
  };
  pushEdge(halfW, halfD, -halfW, halfD);
  pushEdge(-halfW, halfD, -halfW, -halfD);
  pushEdge(-halfW, -halfD, halfW, -halfD);
  pushEdge(halfW, -halfD, halfW, halfD);

  const count = outer2D.length;
  const bo: Vec3[] = [], to: Vec3[] = [], bi: Vec3[] = [], ti: Vec3[] = [];
  for (const [ox, oz] of outer2D) {
    const len = Math.hypot(ox, oz) || 1;
    const ix = (ox / len) * rInner;
    const iz = (oz / len) * rInner;
    bo.push(sitePt(site, ox, ly0, oz));
    to.push(sitePt(site, ox, ly0 + h, oz));
    bi.push(sitePt(site, ix, ly0, iz));
    ti.push(sitePt(site, ix, ly0 + h, iz));
  }

  const em = opts?.emit ?? 0.5;
  const inEm = opts?.innerEmit ?? 0.9;
  const gl = opts?.glass ?? 0.85;
  const inGl = opts?.innerGlass ?? 0.92;
  const st = opts?.style ?? 1;
  const inSt = opts?.innerStyle ?? 2;
  const botRgb = opts?.bottomRgb ?? [0.22, 0.25, 0.29];

  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const [ox0, oz0] = outer2D[i];
    const [ox1, oz1] = outer2D[j];
    const edx = ox1 - ox0, edz = oz1 - oz0;
    const nOut = siteNrm(site, edz, 0, -edx);
    const midX = (ox0 + ox1) * 0.5, midZ = (oz0 + oz1) * 0.5;
    const nIn = siteNrm(site, -midX, 0, -midZ);

    pushQuad(b, bo[j], bo[i], to[i], to[j], nOut, outerRgb, em, gl, st);
    pushQuad(b, bi[i], bi[j], ti[j], ti[i], nIn, innerRgb, inEm, inGl, inSt);
    pushQuad(b, ti[i], ti[j], to[j], to[i], [0, 1, 0], topRgb, em * 0.18, gl * 0.15, 0);
    pushQuad(b, bi[j], bi[i], bo[i], bo[j], [0, -1, 0], botRgb, 0.08, 0, 0);
  }
}

export function addStrut(
  b: LandmarkBuilder,
  a: Vec3,
  c: Vec3,
  radiusA: number,
  radiusC: number,
  sides: number,
  rgb: RGB,
  em = 0,
  gl = 0,
  st = 0,
) {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const ax = dx / len, ay = dy / len, az = dz / len;
  const refX = Math.abs(ay) > 0.9 ? 1 : 0;
  const refY = Math.abs(ay) > 0.9 ? 0 : 1;
  let ux = refY * az;
  let uy = -refX * az;
  let uz = refX * ay - refY * ax;
  const uInv = 1 / (Math.hypot(ux, uy, uz) || 1);
  ux *= uInv; uy *= uInv; uz *= uInv;
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;

  const ringA: Vec3[] = [];
  const ringC: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const nx = ux * ca + vx * sa;
    const ny = uy * ca + vy * sa;
    const nz = uz * ca + vz * sa;
    ringA.push([a[0] + nx * radiusA, a[1] + ny * radiusA, a[2] + nz * radiusA]);
    ringC.push([c[0] + nx * radiusC, c[1] + ny * radiusC, c[2] + nz * radiusC]);
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const ang = ((i + 0.5) / sides) * Math.PI * 2 + Math.PI / sides;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const n: Vec3 = [ux * ca + vx * sa, uy * ca + vy * sa, uz * ca + vz * sa];
    pushQuad(b, ringA[i], ringA[j], ringC[j], ringC[i], n, rgb, em, gl, st);
  }
}

/** Smooth continuous 3D tube along control points using Catmull-Rom interpolation and parallel transport. */
export function addTubeSpline(
  b: LandmarkBuilder,
  pts: readonly Vec3[],
  radius: number,
  sides: number,
  subdivsPerSeg: number,
  rgb: RGB,
  opts?: { emit?: number; glass?: number; style?: number; closed?: boolean },
) {
  if (pts.length < 2) return;
  const closed = !!opts?.closed;
  const em = opts?.emit ?? 0;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? 0;
  const sampled: Vec3[] = [];
  const nPts = pts.length;
  const segs = closed ? nPts : nPts - 1;
  const at = (idx: number) => pts[closed ? ((idx % nPts) + nPts) % nPts : Math.max(0, Math.min(nPts - 1, idx))];

  for (let s = 0; s < segs; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    const steps = Math.max(1, subdivsPerSeg);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const z = 0.5 * (2 * p1[2] + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);
      sampled.push([x, y, z]);
    }
  }
  if (!closed) sampled.push(pts[nPts - 1]);
  const m = sampled.length;
  if (m < 2) return;

  const tangents: Vec3[] = [];
  for (let i = 0; i < m; i++) {
    const prev = sampled[closed ? (i - 1 + m) % m : Math.max(0, i - 1)];
    const next = sampled[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1], dz = next[2] - prev[2];
    const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
    tangents.push([dx * inv, dy * inv, dz * inv]);
  }

  // Initial perpendicular basis (u, v) via parallel transport so rings never twist abruptly.
  let [tx, ty, tz] = tangents[0];
  let ux = Math.abs(ty) > 0.9 ? 1 : 0;
  let uy = Math.abs(ty) > 0.9 ? 0 : 1;
  let uz = 0;
  let dotTU = tx * ux + ty * uy + tz * uz;
  ux -= tx * dotTU; uy -= ty * dotTU; uz -= tz * dotTU;
  let uInv = 1 / (Math.hypot(ux, uy, uz) || 1);
  ux *= uInv; uy *= uInv; uz *= uInv;

  const rings: Vec3[][] = [];
  const ringNrms: Vec3[][] = [];
  for (let i = 0; i < m; i++) {
    [tx, ty, tz] = tangents[i];
    dotTU = tx * ux + ty * uy + tz * uz;
    ux -= tx * dotTU; uy -= ty * dotTU; uz -= tz * dotTU;
    uInv = 1 / (Math.hypot(ux, uy, uz) || 1);
    ux *= uInv; uy *= uInv; uz *= uInv;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    const ring: Vec3[] = [];
    const nrms: Vec3[] = [];
    const c = sampled[i];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = ux * ca + vx * sa;
      const ny = uy * ca + vy * sa;
      const nz = uz * ca + vz * sa;
      ring.push([c[0] + nx * radius, c[1] + ny * radius, c[2] + nz * radius]);
      nrms.push([nx, ny, nz]);
    }
    rings.push(ring);
    ringNrms.push(nrms);
  }
  const segCount = closed ? m : m - 1;
  for (let i = 0; i < segCount; i++) {
    const ni = (i + 1) % m;
    for (let k = 0; k < sides; k++) {
      const nk = (k + 1) % sides;
      const n0 = ringNrms[i][k], n1 = ringNrms[i][nk];
      const nx = n0[0] + n1[0], ny = n0[1] + n1[1], nz = n0[2] + n1[2];
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      pushQuad(b, rings[i][k], rings[i][nk], rings[ni][nk], rings[ni][k], [nx * inv, ny * inv, nz * inv], rgb, em, gl, st);
    }
  }
}

/**
 * Authentic Japanese irimoya (入母屋造) hip-and-gable tile roof with gentle concave swoop,
 * overhanging white-edged eaves, main ridge beam, and optional gilded shibi (鴟尾) roof finials.
 */
export function addIrimoyaRoof(
  b: LandmarkBuilder,
  site: LocalSite,
  lx: number,
  lyEave: number,
  lz: number,
  eaveW: number,
  eaveD: number,
  roofH: number,
  tileRgb: RGB,
  opts?: {
    ridgeRatio?: number;
    gableRatio?: number;
    whiteTrim?: RGB;
    shibiRgb?: RGB;
    emit?: number;
    shibiSize?: number;
  },
) {
  const hw = eaveW * 0.5;
  const hd = eaveD * 0.5;
  const ridgeHalfW = hw * (opts?.ridgeRatio ?? 0.56);
  const midY = lyEave + roofH * 0.42;
  const topY = lyEave + roofH;
  const midHW = hw * 0.72;
  const midHD = hd * 0.52;
  const gableHalfW = ridgeHalfW;
  const gableHD = hd * (opts?.gableRatio ?? 0.46);
  const trim = opts?.whiteTrim ?? [0.88, 0.86, 0.80];
  const em = opts?.emit ?? 0.08;

  // Helper to push a sloped quad with automatically computed outward normal.
  const pushSloped = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, rgb: RGB, st = 4, emit = em) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= inv; ny *= inv; nz *= inv;
    if (ny < 0) {
      pushQuad(b, p0, p3, p2, p1, [-nx, -ny, -nz], rgb, emit, 0.08, st);
    } else {
      pushQuad(b, p0, p1, p2, p3, [nx, ny, nz], rgb, emit, 0.08, st);
    }
  };

  // Lower flared skirt (eave -> mid inflection, gentle swoop!)
  const e00 = sitePt(site, lx - hw, lyEave, lz - hd);
  const e10 = sitePt(site, lx + hw, lyEave, lz - hd);
  const e11 = sitePt(site, lx + hw, lyEave, lz + hd);
  const e01 = sitePt(site, lx - hw, lyEave, lz + hd);
  const m00 = sitePt(site, lx - midHW, midY, lz - midHD);
  const m10 = sitePt(site, lx + midHW, midY, lz - midHD);
  const m11 = sitePt(site, lx + midHW, midY, lz + midHD);
  const m01 = sitePt(site, lx - midHW, midY, lz + midHD);

  // Under-eave timber soffit
  pushQuad(b, e00, e10, e11, e01, [0, -1, 0], [0.42, 0.28, 0.20], em * 0.6, 0, 4);
  // 4 lower hip slopes
  pushSloped(e01, e11, m11, m01, tileRgb);
  pushSloped(e10, e00, m00, m10, tileRgb);
  pushSloped(e11, e10, m10, m11, tileRgb);
  pushSloped(e00, e01, m01, m00, tileRgb);

  // Upper gable roof slopes (mid -> ridge)
  const rW = sitePt(site, lx - ridgeHalfW, topY, lz);
  const rE = sitePt(site, lx + ridgeHalfW, topY, lz);
  const g01 = sitePt(site, lx - gableHalfW, midY, lz + gableHD);
  const g11 = sitePt(site, lx + gableHalfW, midY, lz + gableHD);
  const g00 = sitePt(site, lx - gableHalfW, midY, lz - gableHD);
  const g10 = sitePt(site, lx + gableHalfW, midY, lz - gableHD);

  pushSloped(m01, m11, rE, rW, tileRgb);
  pushSloped(m10, m00, rW, rE, tileRgb);
  // Recessed white-plaster / timber gable end triangles (破風) on East & West ends
  pushTri(b, g11, g10, rE, siteNrm(site, 1, 0, 0), trim, em * 1.4, 0, 4);
  pushTri(b, g00, g01, rW, siteNrm(site, -1, 0, 0), trim, em * 1.4, 0, 4);
  // Crisp overhanging gable bargeboards
  addStrut(b, g11, rE, 0.28, 0.28, 4, trim, em, 0, 4);
  addStrut(b, g10, rE, 0.28, 0.28, 4, trim, em, 0, 4);
  addStrut(b, g01, rW, 0.28, 0.28, 4, trim, em, 0, 4);
  addStrut(b, g00, rW, 0.28, 0.28, 4, trim, em, 0, 4);
  // Heavy tiled main ridge beam (大棟) with white plaster mortar band
  addBox(b, site, lx, topY - 0.35, lz, ridgeHalfW * 2 + 0.8, 0.85, 0.9, [tileRgb[0] * 0.9, tileRgb[1] * 0.9, tileRgb[2] * 0.92], { style: 4, emit: em });
  addBox(b, site, lx, topY - 0.15, lz, ridgeHalfW * 2 + 0.5, 0.26, 0.98, trim, { style: 4, emit: em * 1.3 });

  // Optional golden shibi (鴟尾) fish-tail ridge finials crowning both ends of the main ridge!
  if (opts?.shibiRgb && (opts.shibiSize ?? 1.4) > 0) {
    const s = opts.shibiSize ?? 1.4;
    for (const dir of [-1, 1]) {
      const sx = lx + dir * (ridgeHalfW + 0.2);
      addBox(b, site, sx, topY + 0.35, lz, s * 0.72, s * 1.35, s * 0.42, opts.shibiRgb, { emit: 0.55, style: 3 });
      addBox(b, site, sx - dir * s * 0.28, topY + 0.35 + s * 0.85, lz, s * 0.55, s * 0.55, s * 0.38, opts.shibiRgb, { emit: 0.55, style: 3 });
    }
  }
}

/** Triangulated reflective park water surface (USJ Lagoon, Black Lake, Heijo East Garden Pond, Umekita Plaza basin). */
export function addWaterPolygon(
  b: LandmarkBuilder,
  outerFlat: readonly number[],
  y: number,
  rgb: RGB = [0.06, 0.20, 0.28],
  holesFlat: readonly (readonly number[])[] = [],
) {
  const toVec2 = (flat: readonly number[]) => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return out;
  };
  const contour = toVec2(outerFlat);
  const holes = holesFlat.map(toVec2);
  const allPts = [contour, ...holes].flat();
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const [i0, i1, i2] of tris) {
    const a = allPts[i0], pB = allPts[i1], pC = allPts[i2];
    const cross = (pB.x - a.x) * (pC.y - a.y) - (pB.y - a.y) * (pC.x - a.x);
    const p1 = cross > 0 ? pC : pB;
    const p2 = cross > 0 ? pB : pC;
    pushTri(b, [a.x, y, a.y], [p1.x, y, p1.y], [p2.x, y, p2.y], [0, 1, 0], rgb, 0.14, 0.96, 5);
  }
}

export function addLight(b: LandmarkBuilder, p: Vec3, rgb: RGB, size: number, phase = 0) {
  b.lightPos.push(p[0], p[1], p[2]);
  b.lightCol.push(rgb[0], rgb[1], rgb[2]);
  b.lightSize.push(size);
  b.lightPhase.push(phase);
}

/** Compile accumulated geometry & architectural lights into one GPU-batched Three.js group. */
export function finalizeLandmarkGroup(b: LandmarkBuilder, env: Env, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(b.emit, 1));
  geo.setAttribute('aGlass', new THREE.Float32BufferAttribute(b.glass, 1));
  geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(b.style, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEmit;
      attribute float aGlass;
      attribute float aStyle;
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vStyle;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vEmit = aEmit;
        vGlass = aGlass;
        vStyle = aStyle;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vStyle;
      void main(){
        // Hoist screen derivatives and sunShadow in uniform control flow for ANGLE/D3D11 safety.
        vec3 n = normalize(vNormal);
        float sh = sunShadow(vWorld, n);
        float fp = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
        vec3 fwWorld = fwidth(vWorld);

        vec3 col = pow(vColor, vec3(2.2));
        float st = floor(vStyle + .5);
        float win = 1.;
        float nightPattern = 1.;
        float warmRoom = .45;

        if (st == 5.) {
          // Shimmering park lagoon / imperial pond / reflecting basin water
          vec2 q = vWorld.xz;
          float t = uTime * .45;
          float w1 = vnoise(q * .16 + vec2(t, t * .6));
          float w2 = vnoise(q * .38 - vec2(t * .8, t * 1.1) + 7.3);
          float eps = max(.35, fp * .4);
          float wx = vnoise((q + vec2(eps, 0.)) * .16 + vec2(t, t * .6)) - w1;
          float wz = vnoise((q + vec2(0., eps)) * .16 + vec2(t, t * .6)) - w1;
          vec3 wn = normalize(vec3(wx / eps * .045, 1., wz / eps * .045));
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 r = reflect(v, wn);
          r.y = clamp(abs(r.y) + .02, .02, 1.);
          vec3 rn = normalize(r);
          float fres = .05 + .88 * pow(1. - clamp(dot(-v, wn), 0., 1.), 4.4);
          vec3 ambient = skyLight(vec3(0., 1., 0.)) + uSunLight * max(uSunDir.y, 0.) * sh;
          vec3 waterCol = mix(col * ambient * .9, skyColor(rn), fres);
          waterCol += uSunLight * sh * (pow(max(dot(rn, uSunDir), 0.), 160.) * .55 + pow(max(dot(rn, uSunDir), 0.), 24.) * .06);
          waterCol += uMoonLight * (pow(max(dot(rn, uMoonDir), 0.), 140.) * 2.4);
          vec3 waterEmit = vec3(.95, .72, .38) * (.04 + .06 * w2) * vEmit * uCity * cityLightShimmer(vWorld);
          gl_FragColor = vec4(applyHaze(waterCol, waterEmit, vWorld), 1.);
          return;
        }

        if (st == 1.) {
          // High-precision skyscraper curtain-wall glass with crisp aluminum mullions, spandrel ribbons,
          // subtle per-floor reflection tint variation, and rich warm/cool office & hotel night windows.
          float along = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
          float fY = fract(vWorld.y / 4.0);
          float fX = fract(along / 2.8);
          float fwY = fwWorld.y / 4.0;
          float fwX = (abs(n.x) > abs(n.z) ? fwWorld.z : fwWorld.x) / 2.8;
          float tY = smoothstep(.18, .46, fwY);
          float tX = smoothstep(.18, .46, fwX);
          float bandY = mix(smoothstep(.13 - fwY, .13 + fwY, fY) * (1. - smoothstep(.87 - fwY, .87 + fwY, fY)), .74, tY);
          float bandX = mix(smoothstep(.06 - fwX, .06 + fwX, fX) * (1. - smoothstep(.94 - fwX, .94 + fwX, fX)), .84, tX);
          float macro = .5 + .5 * cos(6.28318 * vWorld.y / 12.0) * exp(-pow(fwY * .33, 2.) * 7.);
          win = mix(bandY * bandX, .58 + .26 * macro, tY * .75);
          float floorVar = hash12(vec2(floor(vWorld.y / 4.0), floor(along / 12.0)));
          vec3 mullionCol = vec3(.22, .25, .29);
          col = mix(mullionCol, col * (.38 + .14 * floorVar), win);
          vec2 id = vec2(floor(along / 4.4), floor(vWorld.y / 4.0));
          float rHash = hash12(id * vec2(1.9, 3.1) + 7.1);
          float fHash = hash12(vec2(id.y * 2.3, 4.7));
          float roomOn = step(.48, rHash) * step(.30, fHash);
          warmRoom = step(.58, hash12(id + 19.3));
          nightPattern = mix(roomOn * bandY * bandX, (.24 + .18 * macro), smoothstep(.6, 2.8, fp * .2));
        } else if (st == 0. && abs(n.y) < .5) {
          // Architectural cladding / stone & metal facade joints
          float grid = smoothstep(.04, .10, min(fract(vWorld.y / 4.2), 1. - fract(vWorld.y / 4.2)));
          col *= .86 + .14 * grid;
          nightPattern = .35;
        } else if (st == 4.) {
          // Matte sculpted surfaces: subtle kawara tile flutes on sloped Japanese roofs, quiet texture elsewhere
          if (n.y > .25 && n.y < .92) {
            float along = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
            float tile = .5 + .5 * sin(along * 7.5);
            float tileFade = 1. - smoothstep(.35, 1.4, fp);
            col *= 1. + (tile - .5) * .12 * tileFade;
          } else {
            float grain = (vnoise(vWorld.xz * .22 + vWorld.y * .18) - .5) * .08 * (1. - smoothstep(1.2, 5.0, fp));
            col *= 1. + grain;
          }
          nightPattern = .78;
        }

        vec3 lit = shade(seasonalSurface(col, n, vWorld), n, vWorld, sh);
        if (vGlass > .05) {
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 r = reflect(v, n);
          r.y = clamp(r.y + .06, -.05, 1.);
          vec3 rn = normalize(r);
          float fres = .06 + .36 * pow(1. - clamp(dot(-v, n), 0., 1.), 3.2);
          lit += skyColor(rn) * fres * vGlass * win;
          lit += uSunLight * sh * pow(max(dot(rn, uSunDir), 0.), 64.) * .48 * vGlass * win;
        }
        vec3 emitTint = st == 3. ? pow(vColor, vec3(1.5)) * .62
                      : st == 2. ? mix(vec3(.56, .78, .98), vec3(1.0, .82, .52), step(.6, vColor.r - vColor.b))
                      : st == 4. ? mix(vec3(1.0, .74, .42), pow(vColor, vec3(1.4)), .35)
                      : mix(vec3(.68, .82, .98), vec3(.98, .76, .46), warmRoom);
        float emitScale = st == 3. ? .64 : st == 2. ? .40 : st == 4. ? .32 : .30;
        vec3 emit = emitTint * vEmit * nightPattern * emitScale * uCity * cityLightShimmer(vWorld);
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `${name}-meshes`;
  mesh.frustumCulled = false;
  group.add(mesh);

  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.lightPos, 3));
  lGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.lightCol, 3));
  lGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(b.lightSize, 1));
  lGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(b.lightPhase, 1));
  lGeo.computeBoundingSphere();

  const lMat = new THREE.ShaderMaterial({
    uniforms: env,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uCity;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vec4 mv = viewMatrix * wp;
        float dist = max(25., -mv.z);
        float night = smoothstep(.14, .60, uCity);
        bool isBeacon = aPhase > .5;
        float pulse = isBeacon
          ? (.18 + .82 * pow(.5 + .5 * sin(uTime * 3.1 + aPhase * 4.), 2.6))
          : 1.;
        float farFade = isBeacon
          ? (1. - smoothstep(4500., 13500., dist))
          : (1. - smoothstep(10000., 24000., dist));
        vColor = aColor * (isBeacon ? .72 : .85);
        vAlpha = night * pulse * farFade;
        gl_PointSize = isBeacon
          ? clamp(aSize * 210. / dist + 1.1, 1.5, 4.8)
          : clamp(aSize * 280. / dist + 1.3, 1.8, 5.8);
        gl_Position = vAlpha > .01 ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec2 d = gl_PointCoord - .5;
        float r2 = dot(d, d);
        if (r2 > .25) discard;
        float core = exp(-r2 * 30.) + .24 * exp(-r2 * 8.);
        gl_FragColor = vec4(vColor * core, vAlpha);
      }
    `,
  });
  const pts = new THREE.Points(lGeo, lMat);
  pts.name = `${name}-lights`;
  pts.frustumCulled = false;
  group.add(pts);

  return group;
}
