import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { toLocal } from './geo';

type RGB = [number, number, number];
type Vec3 = [number, number, number];
type GroundFn = (x: number, z: number) => number;

/** Exact surveyed positions of Osaka's signature skyline landmarks. */
export const OSAKA_SKYLINE_SITES = {
  abenoHarukas: { lat: 34.646181, lon: 135.513396, maskRadius: 68 },
  umedaSky: { lat: 34.705244, lon: 135.490177, maskRadius: 74 },
  tsutenkaku: { lat: 34.652540, lon: 135.506305, maskRadius: 28 },
} as const;

const MASK_CIRCLES = Object.values(OSAKA_SKYLINE_SITES).map((s) => {
  const p = toLocal(s.lat, s.lon);
  return { x: p.x, z: p.z, r2: s.maskRadius * s.maskRadius };
});

/** True when a generic skyline/regional building sits inside a bespoke Osaka landmark footprint. */
export function inOsakaLandmarkMask(x: number, z: number): boolean {
  for (const c of MASK_CIRCLES) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < c.r2) return true;
  }
  return false;
}

interface Builder {
  pos: number[];
  nrm: number[];
  col: number[];
  emit: number[];
  glass: number[];
  style: number[]; // 0: steel/concrete/truss, 1: curtain-wall glass, 2: luminous atrium/observatory, 3: neon/accent trim
  lightPos: number[];
  lightCol: number[];
  lightSize: number[];
  lightPhase: number[]; // 0: steady accent, >=1: pulsing red aviation beacon
}

function createBuilder(): Builder {
  return { pos: [], nrm: [], col: [], emit: [], glass: [], style: [], lightPos: [], lightCol: [], lightSize: [], lightPhase: [] };
}

interface LocalSite {
  ox: number;
  oy: number;
  oz: number;
  c: number;
  s: number;
}

function makeSite(lat: number, lon: number, ground: GroundFn, rotY: number, sink = 2.0): LocalSite {
  const p = toLocal(lat, lon);
  return { ox: p.x, oy: ground(p.x, p.z) - sink, oz: p.z, c: Math.cos(rotY), s: Math.sin(rotY) };
}

function sitePt(st: LocalSite, lx: number, ly: number, lz: number): Vec3 {
  return [st.ox + lx * st.c - lz * st.s, st.oy + ly, st.oz + lx * st.s + lz * st.c];
}

function siteNrm(st: LocalSite, nx: number, ny: number, nz: number): Vec3 {
  const x = nx * st.c - nz * st.s;
  const z = nx * st.s + nz * st.c;
  const inv = 1 / (Math.hypot(x, ny, z) || 1);
  return [x * inv, ny * inv, z * inv];
}

function pushTri(
  b: Builder,
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

function pushQuad(
  b: Builder,
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

interface BoxOpts {
  topRgb?: RGB;
  bottomRgb?: RGB;
  emit?: number;
  topEmit?: number;
  glass?: number;
  style?: number;
  includeBottom?: boolean;
}

function addBox(
  b: Builder,
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
  const topEm = opts?.topEmit ?? em * 0.22;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? (gl > 0.4 ? 1 : 0);
  const topRgb = opts?.topRgb ?? rgb;
  const sideTint: RGB = [rgb[0] * 0.94, rgb[1] * 0.94, rgb[2] * 0.94];

  pushQuad(b, t00, t01, t11, t10, [0, 1, 0], topRgb, topEm, gl * 0.2, st === 2 || st === 3 ? st : 0);
  pushQuad(b, b01, b11, t11, t01, siteNrm(site, 0, 0, 1), rgb, em, gl, st);
  pushQuad(b, b10, b00, t00, t10, siteNrm(site, 0, 0, -1), rgb, em, gl, st);
  pushQuad(b, b11, b10, t10, t11, siteNrm(site, 1, 0, 0), sideTint, em, gl, st);
  pushQuad(b, b00, b01, t01, t00, siteNrm(site, -1, 0, 0), sideTint, em, gl, st);
  if (opts?.includeBottom) {
    const botRgb = opts.bottomRgb ?? [rgb[0] * 0.65, rgb[1] * 0.65, rgb[2] * 0.65];
    pushQuad(b, b00, b10, b11, b01, [0, -1, 0], botRgb, em * 0.15, 0, 0);
  }
}

/** Tapered cylinder or regular N-gon prism (octagonal shafts, round drums, spires, decks). */
function addFrustum(
  b: Builder,
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
    // Wind CCW around outward normal (angle increases from +X toward +Z, so j -> i -> top_i -> top_j faces outward)
    pushQuad(b, botPts[j], botPts[i], topPts[i], topPts[j], n, rgb, em, gl, st);
    if (opts?.capTop !== false) {
      pushTri(b, topCenter, topPts[j], topPts[i], [0, 1, 0], topRgb, topEm, gl * 0.2, st === 2 || st === 3 ? st : 0);
    }
    if (opts?.capBottom) {
      pushTri(b, botCenter, botPts[i], botPts[j], [0, -1, 0], botRgb, em * 0.15, 0, 0);
    }
  }
}

/** True circular hollow ring / sky-walk promenade / annular deck. */
function addAnnulusRing(
  b: Builder,
  site: LocalSite,
  lx: number,
  ly0: number,
  lz: number,
  rInner: number,
  rOuter: number,
  h: number,
  sides: number,
  rgb: RGB,
  opts?: { topRgb?: RGB; innerRgb?: RGB; emit?: number; innerEmit?: number; topEmit?: number; glass?: number; style?: number; innerStyle?: number },
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
    pushQuad(b, ti[i], ti[j], to[j], to[i], [0, 1, 0], topRgb, topEm, gl * 0.15, st === 3 ? 3 : 0);
    pushQuad(b, bi[j], bi[i], bo[i], bo[j], [0, -1, 0], botRgb, 0, 0, 0);
  }
}

/**
 * Watertight rectangular cantilevered deck pierced by a true smooth circular sky aperture.
 * Builds Umeda Sky Building's unmistakable Floating Garden Observatory without boxy corners.
 */
function addRectWithCircularAperture(
  b: Builder,
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
  opts?: { emit?: number; innerEmit?: number; glass?: number; innerGlass?: number; style?: number; innerStyle?: number; bottomRgb?: RGB },
) {
  const outer2D: [number, number][] = [];
  const pushEdge = (x0: number, z0: number, x1: number, z1: number) => {
    for (let k = 0; k < segsPerSide; k++) {
      const t = k / segsPerSide;
      outer2D.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
    }
  };
  // Walk outer perimeter in angle-increasing order (+X,+Z -> -X,+Z -> -X,-Z -> +X,-Z)
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
    // Outward normal to perimeter edge (ox0,oz0)->(ox1,oz1) in increasing polar angle order -> (edz, 0, -edx)
    const nOut = siteNrm(site, edz, 0, -edx);
    const midX = (ox0 + ox1) * 0.5, midZ = (oz0 + oz1) * 0.5;
    const nIn = siteNrm(site, -midX, 0, -midZ);

    pushQuad(b, bo[j], bo[i], to[i], to[j], nOut, outerRgb, em, gl, st);
    pushQuad(b, bi[i], bi[j], ti[j], ti[i], nIn, innerRgb, inEm, inGl, inSt);
    pushQuad(b, ti[i], ti[j], to[j], to[i], [0, 1, 0], topRgb, em * 0.18, gl * 0.15, 0);
    pushQuad(b, bi[j], bi[i], bo[i], bo[j], [0, -1, 0], botRgb, 0.08, 0, 0);
  }
}

/** 3D oriented tubular/prismatic strut (for tower legs, steel X-bracing, arches, and crossed escalator tubes). */
function addStrut(
  b: Builder,
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
  // Build orthonormal basis (u, v) perpendicular to axis (ax, ay, az)
  const refX = Math.abs(ay) > 0.9 ? 1 : 0;
  const refY = Math.abs(ay) > 0.9 ? 0 : 1;
  const refZ = 0;
  let ux = refY * az - refZ * ay;
  let uy = refZ * ax - refX * az;
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

function addLight(b: Builder, p: Vec3, rgb: RGB, size: number, phase = 0) {
  b.lightPos.push(p[0], p[1], p[2]);
  b.lightCol.push(rgb[0], rgb[1], rgb[2]);
  b.lightSize.push(size);
  b.lightPhase.push(phase);
}

/**
 * Build bespoke high-detail 3D models for Osaka's signature skyline icons:
 * - あべのハルカス (Abeno Harukas, 300 m)
 * - 梅田スカイビル (Umeda Sky Building, 173 m)
 * - 通天閣 (Tsutenkaku, 108 m)
 * Persistent at all ranges so they read unmistakably both up close and across the Osaka Plain.
 */
export function buildOsakaLandmarks(env: Env, ground: GroundFn): THREE.Group {
  const b = createBuilder();

  // =========================================================================
  // 1. あべのハルカス (Abeno Harukas — 300 m, Cesar Pelli stepped glass tower)
  // =========================================================================
  {
    const st = makeSite(OSAKA_SKYLINE_SITES.abenoHarukas.lat, OSAKA_SKYLINE_SITES.abenoHarukas.lon, ground, -0.06, 2.0);
    const glassPodium: RGB = [0.24, 0.34, 0.43];
    const glassMid: RGB = [0.22, 0.36, 0.48];
    const glassUpper: RGB = [0.28, 0.44, 0.56];
    const glassCrown: RGB = [0.36, 0.52, 0.64];
    const frameSilver: RGB = [0.78, 0.81, 0.85];
    const frameLight: RGB = [0.88, 0.90, 0.93];
    const louverDark: RGB = [0.16, 0.19, 0.23];
    const warmDeck: RGB = [0.58, 0.50, 0.38];
    const gardenGreen: RGB = [0.16, 0.34, 0.14];
    const padYellow: RGB = [0.92, 0.78, 0.18];

    // --- Tier 1: Kintetsu Department Store Podium (0–82 m, 90 m × 66 m) ---
    // Recessed ground-floor retail colonnade + overhanging entrance canopy
    addBox(b, st, 0, 0, 0, 86, 11, 62, [0.18, 0.24, 0.30], { emit: 0.72, glass: 0.90, style: 2 });
    addBox(b, st, 0, 10.5, 0, 93, 1.6, 69, frameSilver, { emit: 0.25, includeBottom: true });
    // Main department store glass-and-stone volume (11–81 m)
    addBox(b, st, 0, 11, 0, 90, 70, 66, glassPodium, {
      topRgb: [0.54, 0.56, 0.58], emit: 0.52, glass: 0.80, style: 1,
    });
    // Crisp horizontal podium floor cornice belts (26 m, 44 m, 62 m, 80.5 m)
    for (const fy of [26, 44, 62]) {
      addBox(b, st, 0, fy, 0, 91.2, 1.1, 67.2, frameSilver, { emit: 0.15 });
    }
    // Vertical architectural silver pilaster fins wrapping the podium facades
    for (let x = -40; x <= 40; x += 10) {
      addBox(b, st, x, 11, 33.2, 1.1, 70, 1.0, frameSilver, { emit: 0.10 });
      addBox(b, st, x, 11, -33.2, 1.1, 70, 1.0, frameSilver, { emit: 0.10 });
    }
    for (let z = -26; z <= 26; z += 10.4) {
      addBox(b, st, -45.2, 11, z, 1.0, 70, 1.1, frameSilver, { emit: 0.10 });
      addBox(b, st, 45.2, 11, z, 1.0, 70, 1.1, frameSilver, { emit: 0.10 });
    }
    // 16F Outdoor Sky Garden Terrace (81–84 m) on the stepped-back west/south podium deck
    addBox(b, st, 0, 80.6, 0, 91.8, 1.8, 67.8, frameLight, { emit: 0.32, style: 3 });
    addBox(b, st, -24, 82.4, 2, 34, 0.8, 54, warmDeck, { topRgb: warmDeck, emit: 0.18 });
    addBox(b, st, -28, 83.2, -12, 16, 1.2, 16, gardenGreen, { topRgb: gardenGreen });
    addBox(b, st, -26, 83.2, 12, 18, 1.2, 18, gardenGreen, { topRgb: gardenGreen });
    addBox(b, st, -2, 83.2, 26, 36, 1.2, 9, gardenGreen, { topRgb: gardenGreen });
    // Perimeter glazed balustrade around the 16F Sky Garden edge
    addBox(b, st, -45.2, 82.4, 0, 0.6, 2.2, 66.4, glassCrown, { emit: 0.30, glass: 0.9, style: 2 });
    addBox(b, st, -18, 82.4, 33.2, 54, 2.2, 0.6, glassCrown, { emit: 0.30, glass: 0.9, style: 2 });

    // --- Tier 2: Mid-Rise Office Block (82–186 m, 64 m × 56 m shifted NE) ---
    const mx = 11, mz = -4;
    addBox(b, st, mx, 82, mz, 64, 104, 56, glassMid, {
      topRgb: [0.56, 0.59, 0.62], emit: 0.58, glass: 0.92, style: 1,
    });
    // Recessed dark mechanical louver bands (126 m mid-service + 180 m sky-lobby transfer)
    addBox(b, st, mx, 126, mz, 64.6, 4.5, 56.6, louverDark, { emit: 0.06 });
    addBox(b, st, mx, 180, mz, 64.8, 5.2, 56.8, louverDark, { emit: 0.08 });
    // Full-height projecting silver pinstripe fins across all 4 mid-tier faces (Cesar Pelli signature!)
    for (let x = -28; x <= 28; x += 8) {
      addBox(b, st, mx + x, 82, mz + 28.2, 0.9, 104, 1.1, frameSilver, { emit: 0.12 });
      addBox(b, st, mx + x, 82, mz - 28.2, 0.9, 104, 1.1, frameSilver, { emit: 0.12 });
    }
    for (let z = -24; z <= 24; z += 8) {
      addBox(b, st, mx + 32.2, 82, mz + z, 1.1, 104, 0.9, frameSilver, { emit: 0.12 });
      addBox(b, st, mx - 32.2, 82, mz + z, 1.1, 104, 0.9, frameSilver, { emit: 0.12 });
    }
    // Heavier corner structural silver mullions
    for (const sx of [-31.8, 31.8]) for (const sz of [-27.8, 27.8]) {
      addBox(b, st, mx + sx, 82, mz + sz, 2.0, 105, 2.0, frameLight, { emit: 0.18 });
    }
    // 38F setback cornice & terrace planters at 186 m
    addBox(b, st, mx, 185.0, mz, 66.2, 1.8, 58.2, frameLight, { emit: 0.36, style: 3 });
    addBox(b, st, -11, 186.8, 12, 16, 1.4, 16, gardenGreen, { topRgb: gardenGreen });

    // --- Tier 3: Marriott Hotel & Harukas 300 Tower (186–278 m, 44 m × 48 m) ---
    const ux = 19, uz = -8;
    addBox(b, st, ux, 186, uz, 44, 92, 48, glassUpper, {
      topRgb: [0.60, 0.64, 0.68], emit: 0.64, glass: 0.95, style: 1,
    });
    // Mechanical louver band at 246 m
    addBox(b, st, ux, 246, uz, 44.5, 4.0, 48.5, louverDark, { emit: 0.06 });
    // Sleek vertical silver blade fins & crisp corner mullions rising to the 300 m crown
    for (let x = -18; x <= 18; x += 6) {
      addBox(b, st, ux + x, 186, uz + 24.2, 0.75, 114, 1.0, frameSilver, { emit: 0.14 });
      addBox(b, st, ux + x, 186, uz - 24.2, 0.75, 114, 1.0, frameSilver, { emit: 0.14 });
    }
    for (let z = -20; z <= 20; z += 6.66) {
      addBox(b, st, ux + 22.2, 186, uz + z, 1.0, 114, 0.75, frameSilver, { emit: 0.14 });
      addBox(b, st, ux - 22.2, 186, uz + z, 1.0, 114, 0.75, frameSilver, { emit: 0.14 });
    }
    for (const sx of [-21.8, 21.8]) for (const sz of [-23.8, 23.8]) {
      addBox(b, st, ux + sx, 186, uz + sz, 1.9, 114.5, 1.9, frameLight, { emit: 0.22 });
    }

    // --- Harukas 300 Triple-Height Hollow Glass Observatory & Open-Air Atrium (278–300 m) ---
    // Built as 4 distinct perimeter glazed sky-galleries framing the open 58F Tenku Teien courtyard!
    const obsY = 278, obsH = 21.5;
    addBox(b, st, ux, obsY, uz - 19.5, 44.6, obsH, 9.6, glassCrown, { topRgb: frameLight, emit: 0.90, glass: 0.96, style: 2 });
    addBox(b, st, ux, obsY, uz + 19.5, 44.6, obsH, 9.6, glassCrown, { topRgb: frameLight, emit: 0.90, glass: 0.96, style: 2 });
    addBox(b, st, ux - 17.5, obsY, uz, 9.6, obsH, 30.0, glassCrown, { topRgb: frameLight, emit: 0.90, glass: 0.96, style: 2 });
    addBox(b, st, ux + 17.5, obsY, uz, 9.6, obsH, 30.0, glassCrown, { topRgb: frameLight, emit: 0.90, glass: 0.96, style: 2 });
    // Warm timber courtyard deck inside the open-air 58F atrium
    addBox(b, st, ux, obsY, uz, 25.4, 1.2, 29.4, warmDeck, { topRgb: warmDeck, emit: 0.42, style: 2 });
    // Open sky-roof perimeter steel lattice beams & luminous white crown rim at 300 m
    addBox(b, st, ux, 299.0, uz - 24.0, 46.2, 1.6, 2.2, frameLight, { emit: 0.82, style: 3 });
    addBox(b, st, ux, 299.0, uz + 24.0, 46.2, 1.6, 2.2, frameLight, { emit: 0.82, style: 3 });
    addBox(b, st, ux - 22.0, 299.0, uz, 2.2, 1.6, 48.0, frameLight, { emit: 0.82, style: 3 });
    addBox(b, st, ux + 22.0, 299.0, uz, 2.2, 1.6, 48.0, frameLight, { emit: 0.82, style: 3 });
    // Structural bridge girders spanning the atrium roof + raised helipad deck with bold yellow 'H'
    for (const bx of [-8, 8]) {
      addBox(b, st, ux + bx, 298.6, uz, 1.4, 1.4, 46, frameSilver, { includeBottom: true });
    }
    addBox(b, st, ux, 299.8, uz, 22, 0.9, 22, [0.24, 0.26, 0.29], { topRgb: [0.26, 0.28, 0.31] });
    addBox(b, st, ux - 4.2, 300.75, uz, 1.5, 0.15, 10.5, padYellow);
    addBox(b, st, ux + 4.2, 300.75, uz, 1.5, 0.15, 10.5, padYellow);
    addBox(b, st, ux, 300.75, uz, 8.4, 0.15, 1.5, padYellow);
    // Subtle corner lightning rods + restrained pinpoint red aviation beacons (303.5 m)
    for (const [bx, bz] of [[ux - 21.5, uz - 23.5], [ux + 21.5, uz + 23.5]] as const) {
      addBox(b, st, bx, 300.5, bz, 0.4, 3.2, 0.4, frameLight);
      addLight(b, sitePt(st, bx, 304.0, bz), [1.0, 0.10, 0.05], 4.4, 1.1);
    }
    addLight(b, sitePt(st, ux, 290, uz), [0.85, 0.94, 1.0], 5.6, 0);
  }

  // =========================================================================
  // 2. 梅田スカイビル (Umeda Sky Building — 173 m Twin Towers + Circular Sky Aperture)
  // =========================================================================
  {
    const st = makeSite(OSAKA_SKYLINE_SITES.umedaSky.lat, OSAKA_SKYLINE_SITES.umedaSky.lon, ground, 0.08, 2.0);
    const skyGlass: RGB = [0.26, 0.40, 0.52];
    const deepGlass: RGB = [0.16, 0.28, 0.38];
    const silverMetal: RGB = [0.76, 0.80, 0.85];
    const brightSilver: RGB = [0.86, 0.89, 0.93];
    const darkSteel: RGB = [0.20, 0.24, 0.28];
    const atriumGlow: RGB = [0.64, 0.84, 0.98];
    const plazaGreen: RGB = [0.15, 0.30, 0.14];
    const plazaStone: RGB = [0.46, 0.48, 0.50];

    // --- Shin-Umeda City landscaped plaza podium & reflective garden court (0–7 m) ---
    addBox(b, st, 0, 0, 0, 102, 2.4, 62, plazaStone, { topRgb: plazaStone });
    addBox(b, st, 0, 2.4, -22, 34, 1.2, 14, plazaGreen, { topRgb: plazaGreen });
    addBox(b, st, 0, 2.4, 22, 34, 1.2, 14, plazaGreen, { topRgb: plazaGreen });
    // Low glazed lobby wings at the base of Tower East & Tower West
    for (const side of [-1, 1]) {
      const tx = side * 32;
      addBox(b, st, tx, 2.4, 0, 34, 9.6, 44, deepGlass, { emit: 0.60, glass: 0.90, style: 2 });
      addBox(b, st, tx, 11.6, 0, 35.6, 1.4, 45.6, silverMetal, { emit: 0.16, includeBottom: true });
    }

    // --- Twin Articulated Stepped-Corner Towers (Tower East & Tower West, 12–152 m) ---
    for (const side of [-1, 1]) {
      const tx = side * 32;
      // Primary sleek silver-blue glass core (30 m × 36 m)
      addBox(b, st, tx, 12, 0, 30, 140, 36, skyGlass, {
        topRgb: silverMetal, emit: 0.56, glass: 0.94, style: 1,
      });
      // Projecting center glass bays on N/S & E/W faces creating Umeda Sky's stepped cruciform silhouette
      addBox(b, st, tx, 12, 0, 20, 140, 41, skyGlass, {
        topRgb: silverMetal, emit: 0.58, glass: 0.95, style: 1,
      });
      addBox(b, st, tx + side * 2, 12, 0, 32, 140, 22, skyGlass, {
        topRgb: silverMetal, emit: 0.54, glass: 0.93, style: 1,
      });
      // Structural metallic corner piers & vertical curtain-wall fins
      for (const fx of [-15.2, 15.2]) for (const fz of [-18.2, 18.2]) {
        addBox(b, st, tx + fx, 12, fz, 1.8, 141, 1.8, brightSilver, { emit: 0.14 });
      }
      for (const fx of [-10.2, 10.2]) for (const fz of [-20.6, 20.6]) {
        addBox(b, st, tx + fx, 12, fz, 1.2, 141, 1.2, silverMetal, { emit: 0.12 });
      }
      // Horizontal dark mechanical refuge bands & crisp metallic floor ribs every ~35 m
      for (const by of [46, 82, 118]) {
        addBox(b, st, tx, by, 0, 31.4, 3.2, 37.4, darkSteel, { emit: 0.06 });
        addBox(b, st, tx, by - 0.6, 0, 32.2, 0.8, 38.2, brightSilver, { emit: 0.12 });
        addBox(b, st, tx, by + 3.0, 0, 32.2, 0.8, 38.2, brightSilver, { emit: 0.12 });
      }
      // Upper 35F transfer lobby band right under the Floating Garden (145–152 m)
      addBox(b, st, tx, 145, 0, 32.5, 7, 39, darkSteel, { emit: 0.12 });
    }

    // --- Central 16-Sided Cylindrical Glass Elevator Shaft rising through the open court (2–154 m) ---
    addFrustum(b, st, 0, 2, 0, 6.2, 6.2, 151, 16, atriumGlow, {
      topRgb: silverMetal, emit: 0.66, glass: 0.92, style: 2,
    });
    // Horizontal stainless-steel structural hoops around the glass cylinder every 14 m
    for (let ry = 16; ry <= 144; ry += 14) {
      addFrustum(b, st, 0, ry, 0, 6.55, 6.55, 0.85, 16, brightSilver, { emit: 0.15, capTop: true, capBottom: true });
    }
    // 4 vertical exterior steel guide spines on the elevator cylinder
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) * 0.5 + Math.PI * 0.25;
      addBox(b, st, Math.cos(a) * 6.3, 2, Math.sin(a) * 6.3, 0.8, 151, 0.8, silverMetal, { emit: 0.12 });
    }

    // --- Exposed Diagonal Space-Frame Steel Trusses supporting the cantilevered Floating Garden (142–152 m) ---
    for (const zSign of [-1, 1]) {
      const z = zSign * 19;
      addStrut(b, sitePt(st, -17, 142, z), sitePt(st, -9, 152.5, z), 0.75, 0.75, 6, darkSteel, 0.08);
      addStrut(b, sitePt(st, 17, 142, z), sitePt(st, 9, 152.5, z), 0.75, 0.75, 6, darkSteel, 0.08);
      addStrut(b, sitePt(st, -17, 152, z), sitePt(st, 17, 152, z), 0.85, 0.85, 6, silverMetal, 0.14);
    }

    // --- Iconic Floating Garden Observatory (空中庭園展望台, 152–173 m) ---
    // Built with true 24-segment circular sky aperture (radius 14 m) pierced cleanly through a 94 m × 56 m cantilevered steel-and-glass deck!
    // 1. Lower structural steel transfer skirt with circular inner opening (152–155.5 m)
    addRectWithCircularAperture(b, st, 152.0, 3.5, 47.0, 28.0, 14.2, 6, darkSteel, brightSilver, darkSteel, {
      emit: 0.16, innerEmit: 0.45, glass: 0.2, innerGlass: 0.4, style: 0, innerStyle: 3, bottomRgb: [0.18, 0.21, 0.25],
    });
    // 2. Main 39F–40F Panoramic Glazed Floating Garden Bridge (155.5–167.5 m)
    addRectWithCircularAperture(b, st, 155.5, 12.0, 47.2, 28.2, 14.0, 6, skyGlass, atriumGlow, [0.78, 0.82, 0.86], {
      emit: 0.60, innerEmit: 0.88, glass: 0.90, innerGlass: 0.94, style: 1, innerStyle: 2,
    });
    // 3. Crisp cantilevered metallic roof eave & fascia frame (167.5–170.0 m)
    addRectWithCircularAperture(b, st, 167.5, 2.5, 48.2, 29.2, 13.8, 6, brightSilver, atriumGlow, [0.80, 0.84, 0.88], {
      emit: 0.34, innerEmit: 0.92, glass: 0.35, innerGlass: 0.6, style: 0, innerStyle: 3,
    });
    // 4. Open-Air Rooftop "Lumi Sky Walk" Circular Promenade & Glass Guardrail (170.0–173.0 m)
    addAnnulusRing(b, st, 0, 170.0, 0, 14.0, 21.5, 1.1, 24, brightSilver, {
      topRgb: [0.56, 0.72, 0.88], innerRgb: atriumGlow, emit: 0.45, innerEmit: 0.92, topEmit: 0.55, style: 0, innerStyle: 3,
    });
    // Outer & inner slim circular glass safety balustrades around the Sky Walk
    addAnnulusRing(b, st, 0, 171.1, 0, 21.0, 21.5, 1.9, 24, glassCrown(atriumGlow), {
      topRgb: brightSilver, emit: 0.35, glass: 0.88, style: 2,
    });
    addAnnulusRing(b, st, 0, 171.1, 0, 13.8, 14.25, 1.8, 24, atriumGlow, {
      topRgb: brightSilver, emit: 0.72, innerEmit: 0.82, glass: 0.88, style: 2, innerStyle: 3,
    });

    // --- Signature Crossed Transparent Cylindrical Escalator Tubes bridging the void (128 m -> 153 m) ---
    const tubes: [Vec3, Vec3][] = [
      [sitePt(st, -17.5, 128, -4.2), sitePt(st, 17.5, 153.5, 4.2)],
      [sitePt(st, 17.5, 128, 4.2), sitePt(st, -17.5, 153.5, -4.2)],
    ];
    for (const [p0, p1] of tubes) {
      // Smooth 10-sided luminous glass tube
      addStrut(b, p0, p1, 1.85, 1.85, 10, atriumGlow, 0.92, 0.92, 2);
      // Dark steel underside deck rail + metallic structural rib hoops along each escalator tube!
      const ribCount = 7;
      for (let k = 1; k < ribCount; k++) {
        const t = k / ribCount;
        const tPrev = Math.max(0, t - 0.012);
        const tNext = Math.min(1, t + 0.012);
        const lerp = (u: number): Vec3 => [
          p0[0] + (p1[0] - p0[0]) * u,
          p0[1] + (p1[1] - p0[1]) * u,
          p0[2] + (p1[2] - p0[2]) * u,
        ];
        addStrut(b, lerp(tPrev), lerp(tNext), 2.12, 2.12, 10, brightSilver, 0.25, 0.2, 0);
      }
    }

    // Restrained pinpoint red aviation beacons on opposite roof corners + soft circular atrium sky-glow
    for (const [bx, bz] of [[-45.5, -26.5], [45.5, 26.5]] as const) {
      addBox(b, st, bx, 170.0, bz, 0.4, 3.0, 0.4, brightSilver);
      addLight(b, sitePt(st, bx, 173.4, bz), [1.0, 0.10, 0.05], 4.2, 1.4);
    }
    addLight(b, sitePt(st, 0, 166, 0), [0.62, 0.86, 1.0], 5.4, 0);
  }

  // =========================================================================
  // 3. 通天閣 (Tsutenkaku — 108 m, Tachū Naitō Shinsekai lattice tower)
  // =========================================================================
  {
    const st = makeSite(OSAKA_SKYLINE_SITES.tsutenkaku.lat, OSAKA_SKYLINE_SITES.tsutenkaku.lon, ground, 0.0, 1.5);
    const steelLight: RGB = [0.70, 0.73, 0.76];
    const steelMid: RGB = [0.54, 0.58, 0.62];
    const steelDark: RGB = [0.32, 0.35, 0.39];
    const neonBlue: RGB = [0.16, 0.50, 0.96];
    const neonGold: RGB = [1.0, 0.80, 0.30];
    const neonWhite: RGB = [0.92, 0.95, 1.0];
    const deckGlass: RGB = [0.14, 0.24, 0.34];
    const spireRed: RGB = [0.86, 0.22, 0.16];

    // --- 1. Four Inward-Leaning Tapered Steel Truss Legs & Grand Semi-Circular Arch Portals (0–28 m) ---
    const legCorners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const footR = 11.4, kneeR = 6.2, kneeY = 28.0;
    for (const [sx, sz] of legCorners) {
      // Heavy concrete pier footings
      addBox(b, st, sx * footR, 0, sz * footR, 3.8, 3.5, 3.8, [0.46, 0.48, 0.50]);
      // Main inward-leaning tapered steel box leg (4-sided prism strut)
      addStrut(
        b,
        sitePt(st, sx * footR, 2.5, sz * footR),
        sitePt(st, sx * kneeR, kneeY, sz * kneeR),
        1.55, 1.05, 4, steelLight, 0.12,
      );
      // Inner stiffening rib strut parallel to main leg
      addStrut(
        b,
        sitePt(st, sx * (footR - 2.2), 2.5, sz * (footR - 2.2)),
        sitePt(st, sx * (kneeR - 1.2), kneeY, sz * (kneeR - 1.2)),
        0.55, 0.42, 4, steelMid, 0.08,
      );
    }
    // Graceful semi-circular steel portal arches on all 4 facades spanning between the 4 legs (0–16 m)
    const archSegs = 8;
    for (let side = 0; side < 4; side++) {
      const [ax, az] = legCorners[side];
      const [bx, bz] = legCorners[(side + 1) % 4];
      const legAtY = (sx: number, sz: number, y: number): Vec3 => {
        const t = y / kneeY;
        const r = footR + (kneeR - footR) * t;
        return sitePt(st, sx * r, y, sz * r);
      };
      // Lower semi-circular portal arch curve
      let prevPt: Vec3 | null = null;
      for (let k = 0; k <= archSegs; k++) {
        const u = k / archSegs;
        const theta = u * Math.PI;
        const archY = 6.5 + Math.sin(theta) * 9.5;
        const tLeg = archY / kneeY;
        const r = footR + (kneeR - footR) * tLeg;
        const px = (ax + (bx - ax) * u) * r;
        const pz = (az + (bz - az) * u) * r;
        const cur = sitePt(st, px, archY, pz);
        if (prevPt) addStrut(b, prevPt, cur, 0.65, 0.65, 6, steelLight, 0.22);
        prevPt = cur;
      }
      // Upper diagonal X-bracing struts above the arch (16–28 m)
      addStrut(b, legAtY(ax, az, 16), legAtY(bx, bz, 27), 0.42, 0.42, 4, steelMid, 0.10);
      addStrut(b, legAtY(bx, bz, 16), legAtY(ax, az, 27), 0.42, 0.42, 4, steelMid, 0.10);
    }
    // Glazed 2F–3F Shinsekai Exhibition Pavilion tucked inside the upper arched podium (16.5–28 m)
    addFrustum(b, st, 0, 16.5, 0, 10.6, 9.6, 11.5, 8, deckGlass, {
      phase: Math.PI / 8, topRgb: steelLight, emit: 0.62, glass: 0.85, style: 2, capBottom: true,
    });
    // Flared mid-tower gallery collar & illuminated white cornice band (28–33 m)
    addFrustum(b, st, 0, 28.0, 0, 10.4, 8.6, 3.8, 8, steelLight, { phase: Math.PI / 8, emit: 0.26, capBottom: true });
    addFrustum(b, st, 0, 31.8, 0, 8.9, 8.9, 1.3, 8, neonWhite, { phase: Math.PI / 8, emit: 0.82, style: 3 });

    // --- 2. Tapered Octagonal Steel Lattice Shaft (33–77 m) ---
    const shaftY0 = 33.0, shaftY1 = 77.0, shaftR0 = 6.1, shaftR1 = 4.1;
    // Inner structural core shaft (octagonal steel enclosure)
    addFrustum(b, st, 0, shaftY0, 0, shaftR0 - 0.55, shaftR1 - 0.45, shaftY1 - shaftY0, 8, steelMid, {
      phase: Math.PI / 8, emit: 0.20,
    });
    // 8 exterior vertical tapered corner steel columns + horizontal ring collars + X-truss lattice bays!
    const bays = 6;
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI / 8 + (i / 8) * Math.PI * 2;
      const a1 = Math.PI / 8 + ((i + 1) / 8) * Math.PI * 2;
      addStrut(
        b,
        sitePt(st, Math.cos(a0) * shaftR0, shaftY0, Math.sin(a0) * shaftR0),
        sitePt(st, Math.cos(a0) * shaftR1, shaftY1, Math.sin(a0) * shaftR1),
        0.38, 0.30, 4, steelLight, 0.16,
      );
      for (let k = 0; k < bays; k++) {
        const t0 = k / bays, t1 = (k + 1) / bays;
        const yA = shaftY0 + (shaftY1 - shaftY0) * t0;
        const yB = shaftY0 + (shaftY1 - shaftY0) * t1;
        const rA = shaftR0 + (shaftR1 - shaftR0) * t0;
        const rB = shaftR0 + (shaftR1 - shaftR0) * t1;
        const p00 = sitePt(st, Math.cos(a0) * rA, yA, Math.sin(a0) * rA);
        const p10 = sitePt(st, Math.cos(a1) * rA, yA, Math.sin(a1) * rA);
        const p01 = sitePt(st, Math.cos(a0) * rB, yB, Math.sin(a0) * rB);
        const p11 = sitePt(st, Math.cos(a1) * rB, yB, Math.sin(a1) * rB);
        addStrut(b, p00, p11, 0.18, 0.18, 4, steelDark, 0.08);
        addStrut(b, p10, p01, 0.18, 0.18, 4, steelDark, 0.08);
      }
    }
    for (let k = 1; k < bays; k++) {
      const t = k / bays;
      const ry = shaftY0 + (shaftY1 - shaftY0) * t;
      const rr = shaftR0 + (shaftR1 - shaftR0) * t + 0.18;
      addFrustum(b, st, 0, ry - 0.35, 0, rr, rr, 0.7, 8, steelLight, { phase: Math.PI / 8, emit: 0.24 });
    }

    // Iconic Vertical Illuminated Osaka Neon Signboards on all 4 cardinal shaft faces (36–74 m)
    // Mounted cleanly just outside the tapered shaft with slim dark backing frames!
    addBox(b, st, 0, 36, 5.4, 4.4, 38, 0.9, steelDark);
    addBox(b, st, 0, 36.8, 5.8, 3.6, 36.4, 0.45, neonBlue, { emit: 0.96, style: 3 });
    addBox(b, st, 0, 36, -5.4, 4.4, 38, 0.9, steelDark);
    addBox(b, st, 0, 36.8, -5.8, 3.6, 36.4, 0.45, neonBlue, { emit: 0.96, style: 3 });
    addBox(b, st, 5.4, 36, 0, 0.9, 38, 4.4, steelDark);
    addBox(b, st, 5.8, 36.8, 0, 0.45, 36.4, 3.6, neonGold, { emit: 0.90, style: 3 });
    addBox(b, st, -5.4, 36, 0, 0.9, 38, 4.4, steelDark);
    addBox(b, st, -5.8, 36.8, 0, 0.45, 36.4, 3.6, neonGold, { emit: 0.90, style: 3 });

    // Iconic Large Illuminated Circular Clock Face on the East face at y = 57 m!
    const clockY = 57.5, clockR = 3.1, clockX = 6.2;
    const clockCenter = sitePt(st, clockX + 0.18, clockY, 0);
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      const p0 = sitePt(st, clockX + 0.18, clockY + Math.sin(a0) * clockR, Math.cos(a0) * clockR);
      const p1 = sitePt(st, clockX + 0.18, clockY + Math.sin(a1) * clockR, Math.cos(a1) * clockR);
      pushTri(b, clockCenter, p1, p0, siteNrm(st, 1, 0, 0), neonWhite, 0.95, 0.2, 3);
      // Outer dark bezel rim
      const r0 = sitePt(st, clockX + 0.22, clockY + Math.sin(a0) * (clockR + 0.35), Math.cos(a0) * (clockR + 0.35));
      const r1 = sitePt(st, clockX + 0.22, clockY + Math.sin(a1) * (clockR + 0.35), Math.cos(a1) * (clockR + 0.35));
      pushQuad(b, p1, r1, r0, p0, siteNrm(st, 1, 0, 0), steelDark, 0.1, 0, 0);
    }

    // --- 3. Flared Octagonal Double-Tier Observation Deck (77–94 m) ---
    // Tapered structural flare collar supporting the cantilevered observatory (77–81 m)
    addFrustum(b, st, 0, 77.0, 0, 4.8, 9.6, 4.0, 8, steelLight, { phase: Math.PI / 8, emit: 0.30, capBottom: true });
    // Lower illuminated golden/white cornice band
    addFrustum(b, st, 0, 80.8, 0, 10.1, 10.1, 1.1, 8, neonGold, { phase: Math.PI / 8, emit: 0.96, style: 3 });
    // 4F & 5F Main Octagonal Glazed Golden Observatory (81.9–90.2 m)
    addFrustum(b, st, 0, 81.9, 0, 9.8, 10.2, 8.3, 8, deckGlass, {
      phase: Math.PI / 8, topRgb: steelLight, emit: 0.86, glass: 0.92, style: 2,
    });
    // Crisp mid-floor divider ring + 8 vertical exterior silver mullions on observatory glass
    addFrustum(b, st, 0, 85.8, 0, 10.25, 10.25, 0.65, 8, steelLight, { phase: Math.PI / 8, emit: 0.35 });
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      addStrut(
        b,
        sitePt(st, Math.cos(a) * 10.0, 81.5, Math.sin(a) * 10.0),
        sitePt(st, Math.cos(a) * 10.4, 90.6, Math.sin(a) * 10.4),
        0.32, 0.32, 4, steelLight, 0.25,
      );
    }
    // Upper luminous blue/white observatory crown cornice + Open-Air "Tenbo Paradise" Deck (90.2–94.2 m)
    addFrustum(b, st, 0, 90.2, 0, 10.7, 10.7, 1.3, 8, neonBlue, { phase: Math.PI / 8, emit: 0.94, style: 3, capBottom: true });
    addAnnulusRing(b, st, 0, 91.5, 0, 9.8, 10.4, 1.6, 16, steelLight, {
      topRgb: neonWhite, emit: 0.45, glass: 0.5, style: 0,
    });
    addFrustum(b, st, 0, 91.5, 0, 7.6, 7.2, 2.7, 8, steelMid, { phase: Math.PI / 8, emit: 0.35 });

    // --- 4. Cylindrical Glowing Weather-Forecast Neon Crown & Spire (94.2–108 m) ---
    // Iconic 16-sided luminous circular weather forecast drum (94.2–101.2 m) with twin metallic color-divider rings!
    addFrustum(b, st, 0, 94.2, 0, 3.7, 3.7, 3.3, 16, neonWhite, { emit: 0.98, style: 3 });
    addFrustum(b, st, 0, 97.5, 0, 3.95, 3.95, 0.45, 16, steelLight, { emit: 0.25 });
    addFrustum(b, st, 0, 97.95, 0, 3.7, 3.7, 3.25, 16, neonGold, { emit: 1.0, style: 3 });
    // Tapered dome cap + stepped finial collar + slender red/white lightning mast (101.2–108 m)
    addFrustum(b, st, 0, 101.2, 0, 3.8, 1.4, 1.9, 16, steelLight, { emit: 0.45 });
    addFrustum(b, st, 0, 103.1, 0, 1.0, 0.55, 1.6, 8, neonWhite, { emit: 0.65, style: 3 });
    addFrustum(b, st, 0, 104.7, 0, 0.42, 0.14, 3.3, 8, spireRed, { emit: 0.55, style: 3 });
    addLight(b, sitePt(st, 0, 108.4, 0), [1.0, 0.12, 0.06], 4.0, 1.7);
    addLight(b, sitePt(st, 0, 97.6, 0), [1.0, 0.86, 0.44], 5.6, 0);
  }

  const group = new THREE.Group();
  group.name = 'osaka-skyline-landmarks';

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
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vStyle;
      void main(){
        vec3 n = normalize(vNormal);
        // Convert sRGB authoring tones to true linear architectural albedo so glass skyscrapers
        // read as deep reflective sapphire/slate glass instead of washed-out white boxes.
        vec3 col = pow(vColor, vec3(2.2));
        float st = floor(vStyle + .5);
        float fp = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
        float win = 1.;
        float nightPattern = 1.;

        if (st == 1.) {
          // Sleek skyscraper glass curtain wall with crisp aluminum mullions & dark floor spandrel ribbons
          float along = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
          float fY = fract(vWorld.y / 4.2);
          float fX = fract(along / 3.2);
          float fwY = fwidth(vWorld.y / 4.2);
          float fwX = fwidth(along / 3.2);
          float tY = smoothstep(.18, .46, fwY);
          float tX = smoothstep(.18, .46, fwX);
          float bandY = mix(smoothstep(.14 - fwY, .14 + fwY, fY) * (1. - smoothstep(.86 - fwY, .86 + fwY, fY)), .72, tY);
          float bandX = mix(smoothstep(.06 - fwX, .06 + fwX, fX) * (1. - smoothstep(.94 - fwX, .94 + fwX, fX)), .82, tX);
          // Macro 3-floor structural rhythm visible from 16 km away (Mt. Ikoma!)
          float macro = .5 + .5 * cos(6.28318 * vWorld.y / 12.6) * exp(-pow(fwY * .33, 2.) * 7.);
          win = mix(bandY * bandX, .56 + .28 * macro, tY * .75);
          vec3 mullionCol = vec3(.22, .25, .28);
          col = mix(mullionCol, col * .42, win);
          // Crisp sparse office floor & window clusters at night (high contrast, zero bloom whiteout)
          vec2 id = vec2(floor(along / 4.8), floor(vWorld.y / 4.2));
          float roomOn = step(.52, hash12(id * vec2(1.9, 3.1) + 7.1)) * step(.32, hash12(vec2(id.y * 2.3, 4.7)));
          nightPattern = mix(roomOn * bandY * bandX, (.24 + .18 * macro), smoothstep(.6, 2.8, fp * .2));
        } else if (st == 0. && abs(n.y) < .5) {
          // Subtle structural steel cladding / architectural panel joints
          float grid = smoothstep(.05, .12, min(fract(vWorld.y / 4.5), 1. - fract(vWorld.y / 4.5)));
          col *= .84 + .16 * grid;
          nightPattern = .35;
        }

        vec3 lit = shade(seasonalSurface(col, n, vWorld), n, vWorld, 1.);
        if (vGlass > .05) {
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 r = reflect(v, n);
          r.y = clamp(r.y + .06, -.05, 1.);
          vec3 rn = normalize(r);
          float fres = .06 + .32 * pow(1. - clamp(dot(-v, n), 0., 1.), 3.3);
          lit += skyColor(rn) * fres * vGlass * win;
          lit += uSunLight * pow(max(dot(rn, uSunDir), 0.), 56.) * .42 * vGlass * win;
        }
        vec3 emitTint = st == 3. ? pow(vColor, vec3(1.5)) * .58
                      : st == 2. ? vec3(.52, .76, .98)
                      : mix(vec3(.92, .74, .46), vec3(.66, .80, .98), .45);
        float emitScale = st == 3. ? .60 : st == 2. ? .38 : .28;
        vec3 emit = emitTint * vEmit * nightPattern * emitScale * uCity * cityLightShimmer(vWorld);
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'osaka-skyline-meshes';
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
        // Realistic atmospheric distance falloff: red aviation beacons read cleanly nearby and fade softly at far overlooks
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
  pts.name = 'osaka-skyline-lights';
  pts.frustumCulled = false;
  group.add(pts);

  return group;
}

function glassCrown(c: RGB): RGB {
  return [c[0] * 0.62, c[1] * 0.72, c[2] * 0.84];
}
