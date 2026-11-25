import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { toLocal } from './geo';
import { AIRPORT_RUNWAYS, HELIPADS } from './airports-data';
export { AIRPORT_RUNWAYS, HELIPADS, type RunwaySpec, type HelipadSpec } from './airports-data';

type RGB = [number, number, number];
type GroundFn = (x: number, z: number) => number;

interface MeshBuilder {
  pos: number[];
  nrm: number[];
  col: number[];
  emit: number[];
  glass: number[];
  lightPos: number[];
  lightCol: number[];
  lightSize: number[];
  lightPhase: number[];
}

function createBuilder(): MeshBuilder {
  return { pos: [], nrm: [], col: [], emit: [], glass: [], lightPos: [], lightCol: [], lightSize: [], lightPhase: [] };
}

/** Local frame oriented along vector (ux, uz) with right perpendicular (rx, rz) = (-uz, ux). */
interface LocalFrame {
  cx: number;
  cy: number;
  cz: number;
  ux: number;
  uz: number;
  rx: number;
  rz: number;
}

function frameFromEndpoints(a: { x: number; z: number }, b: { x: number; z: number }, y: number): { frame: LocalFrame; length: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length;
  return {
    length,
    frame: { cx: (a.x + b.x) * 0.5, cy: y, cz: (a.z + b.z) * 0.5, ux, uz, rx: -uz, rz: ux },
  };
}

function toWorld(f: LocalFrame, along: number, across: number, up: number): [number, number, number] {
  return [
    f.cx + f.ux * along + f.rx * across,
    f.cy + up,
    f.cz + f.uz * along + f.rz * across,
  ];
}

function pushQuad(
  b: MeshBuilder,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  n: [number, number, number],
  rgb: RGB,
  em = 0,
  gl = 0,
) {
  for (const v of [p0, p1, p2, p0, p2, p3]) {
    b.pos.push(v[0], v[1], v[2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.col.push(rgb[0], rgb[1], rgb[2]);
    b.emit.push(em);
    b.glass.push(gl);
  }
}

function pushBox(
  b: MeshBuilder,
  f: LocalFrame,
  along: number,
  across: number,
  yBottom: number,
  len: number,
  wid: number,
  h: number,
  rgb: RGB,
  opts?: { topRgb?: RGB; emit?: number; topEmit?: number; glass?: number; skipBottom?: boolean },
) {
  const hl = len * 0.5, hw = wid * 0.5;
  const y0 = yBottom, y1 = yBottom + h;
  const b00 = toWorld(f, along - hl, across - hw, y0);
  const b10 = toWorld(f, along + hl, across - hw, y0);
  const b11 = toWorld(f, along + hl, across + hw, y0);
  const b01 = toWorld(f, along - hl, across + hw, y0);
  const t00 = toWorld(f, along - hl, across - hw, y1);
  const t10 = toWorld(f, along + hl, across - hw, y1);
  const t11 = toWorld(f, along + hl, across + hw, y1);
  const t01 = toWorld(f, along - hl, across + hw, y1);
  const em = opts?.emit ?? 0;
  const topEm = opts?.topEmit ?? em * 0.25;
  const gl = opts?.glass ?? 0;
  const topRgb = opts?.topRgb ?? rgb;
  const sideA: RGB = [rgb[0] * 0.94, rgb[1] * 0.94, rgb[2] * 0.94];
  const sideB: RGB = [rgb[0] * 0.88, rgb[1] * 0.88, rgb[2] * 0.88];

  // Top (+Y)
  pushQuad(b, t00, t01, t11, t10, [0, 1, 0], topRgb, topEm, gl * 0.2);
  // Sides
  pushQuad(b, b10, b11, t11, t10, [f.ux, 0, f.uz], sideA, em, gl);
  pushQuad(b, b01, b00, t00, t01, [-f.ux, 0, -f.uz], sideA, em, gl);
  pushQuad(b, b11, b01, t01, t11, [f.rx, 0, f.rz], sideB, em, gl);
  pushQuad(b, b00, b10, t10, t00, [-f.rx, 0, -f.rz], sideB, em, gl);
  if (!opts?.skipBottom) {
    pushQuad(b, b00, b10, b11, b01, [0, -1, 0], sideB, 0, 0);
  }
}

function pushStripTop(
  b: MeshBuilder,
  f: LocalFrame,
  along: number,
  across: number,
  y: number,
  len: number,
  wid: number,
  rgb: RGB,
  em = 0,
) {
  const hl = len * 0.5, hw = wid * 0.5;
  const p0 = toWorld(f, along - hl, across - hw, y);
  const p1 = toWorld(f, along - hl, across + hw, y);
  const p2 = toWorld(f, along + hl, across + hw, y);
  const p3 = toWorld(f, along + hl, across - hw, y);
  pushQuad(b, p0, p1, p2, p3, [0, 1, 0], rgb, em, 0);
}

function addLight(b: MeshBuilder, p: [number, number, number], rgb: RGB, size: number, phase = 0) {
  b.lightPos.push(p[0], p[1], p[2]);
  b.lightCol.push(rgb[0], rgb[1], rgb[2]);
  b.lightSize.push(size);
  b.lightPhase.push(phase);
}

/** Build an arched/curved airfoil terminal roof (Renzo Piano KIX T1, ITM & UKB terminal roofs). */
function pushCurvedRoof(
  b: MeshBuilder,
  f: LocalFrame,
  along: number,
  across: number,
  baseY: number,
  len: number,
  wid: number,
  archRise: number,
  thickness: number,
  rgb: RGB,
  segments = 8,
) {
  const hl = len * 0.5;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments - 0.5;
    const t1 = (i + 1) / segments - 0.5;
    const w0 = across + t0 * wid;
    const w1 = across + t1 * wid;
    const y0 = baseY + Math.cos(t0 * Math.PI) * archRise;
    const y1 = baseY + Math.cos(t1 * Math.PI) * archRise;
    const p00 = toWorld(f, along - hl, w0, y0 + thickness);
    const p01 = toWorld(f, along - hl, w1, y1 + thickness);
    const p11 = toWorld(f, along + hl, w1, y1 + thickness);
    const p10 = toWorld(f, along + hl, w0, y0 + thickness);
    const slope = (y1 - y0) / (w1 - w0);
    const inv = 1 / Math.hypot(slope, 1);
    const nx = -f.rx * slope * inv, ny = inv, nz = -f.rz * slope * inv;
    pushQuad(b, p00, p01, p11, p10, [nx, ny, nz], rgb, 0.04, 0.18);
  }
}

/** Build an Air Traffic Control Tower (shaft + flared glazed cab + roof radome + red obstruction beacon). */
function pushControlTower(b: MeshBuilder, f: LocalFrame, along: number, across: number, baseY: number, height: number) {
  const concrete: RGB = [0.64, 0.65, 0.66];
  const cabGlass: RGB = [0.08, 0.14, 0.18];
  const roofWhite: RGB = [0.78, 0.79, 0.80];
  // Base podium
  pushBox(b, f, along, across, baseY, 26, 22, Math.min(14, height * 0.22), [0.52, 0.54, 0.56], { emit: 0.15, glass: 0.35 });
  // Tapered concrete shaft
  const shaftH = height - 10;
  pushBox(b, f, along, across, baseY, 11, 11, shaftH, concrete, { skipBottom: true });
  // Equipment deck below cab
  pushBox(b, f, along, across, baseY + shaftH - 3, 16, 16, 3.2, [0.46, 0.48, 0.50]);
  // Glazed ATC cab
  pushBox(b, f, along, across, baseY + shaftH + 0.2, 18.5, 18.5, 6.2, cabGlass, { emit: 0.72, glass: 0.92, topRgb: roofWhite });
  // Overhanging roof disc + radar dome
  pushBox(b, f, along, across, baseY + shaftH + 6.4, 21.5, 21.5, 1.8, roofWhite);
  pushBox(b, f, along, across, baseY + shaftH + 8.2, 7.5, 7.5, 4.5, [0.82, 0.83, 0.84]);
  // Red obstruction lights & rotating green-white airport beacon
  const top = toWorld(f, along, across, baseY + shaftH + 14.5);
  addLight(b, top, [1.0, 0.16, 0.12], 5.5, 1.0);
  addLight(b, toWorld(f, along + 6, across, baseY + shaftH + 9.2), [0.35, 1.0, 0.55], 6.5, 2.0);
}

/** Build a complete high-detail runway with piano-key thresholds, touchdown markers, centerline dashes, blast pads & full night lighting. */
function pushRunway(b: MeshBuilder, f: LocalFrame, length: number, width: number, y: number, opts?: { approachLen?: number; overWater?: boolean }) {
  const asphalt: RGB = [0.095, 0.10, 0.108];
  const shoulder: RGB = [0.155, 0.16, 0.165];
  const blastPad: RGB = [0.12, 0.125, 0.13];
  const paint: RGB = [0.82, 0.83, 0.82];
  const yellow: RGB = [0.78, 0.64, 0.16];
  const halfL = length * 0.5;
  const halfW = width * 0.5;

  // Paved shoulder + main asphalt runway
  pushStripTop(b, f, 0, 0, y + 0.08, length + 120, width + 18, shoulder);
  pushStripTop(b, f, 0, 0, y + 0.16, length, width, asphalt);
  // Stopway / blast pads at both ends
  pushStripTop(b, f, -halfL - 35, 0, y + 0.13, 60, width, blastPad);
  pushStripTop(b, f, halfL + 35, 0, y + 0.13, 60, width, blastPad);
  // Yellow blast-pad chevrons
  for (const dir of [-1, 1]) {
    for (const off of [20, 45]) {
      pushStripTop(b, f, dir * (halfL + off), 0, y + 0.21, 3.2, width * 0.62, yellow);
    }
  }

  // White edge stripes
  for (const side of [-1, 1]) {
    pushStripTop(b, f, 0, side * (halfW - 1.2), y + 0.22, length - 6, 1.3, paint);
  }
  // Centerline dashes every 55 m
  for (let s = -halfL + 110; s <= halfL - 110; s += 55) {
    pushStripTop(b, f, s, 0, y + 0.22, 30, 1.35, paint);
  }
  // Piano-key threshold bars + aiming point slabs + touchdown zone bars at both ends
  const bars = width >= 55 ? 6 : 4;
  for (const dir of [-1, 1]) {
    for (let k = 1; k <= bars; k++) {
      const across = (k / (bars + 0.6)) * (halfW - 4.5);
      for (const side of [-1, 1]) {
        pushStripTop(b, f, dir * (halfL - 28), side * across, y + 0.22, 36, 2.2, paint);
      }
    }
    // Aiming point (300 m from threshold)
    for (const side of [-1, 1]) {
      pushStripTop(b, f, dir * (halfL - 300), side * (halfW * 0.36), y + 0.22, 54, 7.5, paint);
    }
    // Touchdown zone pairs (150 m, 450 m, 600 m)
    for (const d of [150, 460, 610]) {
      if (d < halfL - 120) {
        for (const side of [-1, 1]) {
          pushStripTop(b, f, dir * (halfL - d), side * (halfW * 0.34), y + 0.22, 24, 3.4, paint);
        }
      }
    }
  }

  // Runway edge lights (white, switching to amber in final 600 m) & green centerline lights
  const edgeStep = 65;
  for (let s = -halfL; s <= halfL; s += edgeStep) {
    const nearEnd = halfL - Math.abs(s) < 600;
    const edgeRgb: RGB = nearEnd ? [1.0, 0.78, 0.28] : [0.98, 0.96, 0.88];
    for (const side of [-1, 1]) {
      addLight(b, toWorld(f, s, side * (halfW + 2.5), y + 1.0), edgeRgb, 2.8, 0);
    }
    if (Math.abs(s) < halfL - 50 && Math.round(s / edgeStep) % 2 === 0) {
      addLight(b, toWorld(f, s, 0, y + 0.8), [0.85, 0.96, 0.92], 1.8, 0);
    }
  }

  // Threshold green/red bar + PAPI (Precision Approach Path Indicator: 2 white + 2 red) + Approach Lighting System (ALS)
  const approachLen = opts?.approachLen ?? 540;
  for (const dir of [-1, 1]) {
    // Threshold bar (green on approach)
    for (let k = -4; k <= 4; k++) {
      addLight(b, toWorld(f, dir * halfL, k * (width / 10), y + 1.1), [0.22, 1.0, 0.42], 3.0, 0);
    }
    // PAPI 4-unit bank left of touchdown zone
    for (let p = 0; p < 4; p++) {
      const papiCol: RGB = p < 2 ? [1.0, 0.97, 0.88] : [1.0, 0.22, 0.16];
      addLight(b, toWorld(f, dir * (halfL - 320), -dir * (halfW + 14 + p * 6), y + 1.4), papiCol, 3.6, 0);
    }
    // Approach Light System (ALS) centerline + 300 m decision crossbar + sequenced rabbit strobes
    if (opts?.overWater) {
      // Concrete/steel pier supporting the approach light gantry over Osaka Bay
      pushBox(b, f, dir * (halfL + approachLen * 0.5 + 30), 0, y - 3.6, approachLen, 8, 3.8, [0.42, 0.44, 0.46]);
    }
    for (let d = 60; d <= approachLen; d += 55) {
      const isCrossbar = Math.abs(d - 280) < 35;
      const span = isCrossbar ? 5 : 1;
      for (let k = -span; k <= span; k++) {
        addLight(b, toWorld(f, dir * (halfL + d), k * 4.5, y + 1.6), [1.0, 0.94, 0.82], isCrossbar ? 3.5 : 3.2, 0);
      }
      // Sequenced flashing strobe ("rabbit") leading aircraft onto the runway at night
      addLight(b, toWorld(f, dir * (halfL + d), 0, y + 2.2), [0.92, 0.98, 1.0], 5.2, 3.0 + (approachLen - d) / approachLen);
    }
  }
}

/** Build a parallel taxiway with yellow centerline, blue edge lights & high-speed exit connectors. */
function pushTaxiway(b: MeshBuilder, f: LocalFrame, length: number, across: number, y: number, connectors: number[], runwayAcross = 0) {
  const taxiAsphalt: RGB = [0.13, 0.135, 0.145];
  const yellow: RGB = [0.76, 0.62, 0.16];
  pushStripTop(b, f, 0, across, y + 0.11, length, 24, taxiAsphalt);
  pushStripTop(b, f, 0, across, y + 0.16, length - 12, 0.85, yellow);
  const halfL = length * 0.5;
  for (let s = -halfL; s <= halfL; s += 90) {
    for (const side of [-1, 1]) {
      addLight(b, toWorld(f, s, across + side * 13, y + 0.85), [0.22, 0.55, 1.0], 2.1, 0);
    }
  }
  const midAcross = (across + runwayAcross) * 0.5;
  const spanAcross = Math.abs(across - runwayAcross);
  for (const s of connectors) {
    pushStripTop(b, f, s, midAcross, y + 0.10, 26, spanAcross, taxiAsphalt);
    pushStripTop(b, f, s, midAcross, y + 0.15, 0.8, spanAcross - 12, yellow);
  }
}

/** Build a sea bridge connecting an offshore airport island to the mainland/Port Island. */
function pushAccessBridge(
  b: MeshBuilder,
  startLatLon: [number, number],
  endLatLon: [number, number],
  baseY: number,
  width: number,
  peakH: number,
  piers: number,
  truss = false,
) {
  const a = toLocal(startLatLon[0], startLatLon[1]);
  const c = toLocal(endLatLon[0], endLatLon[1]);
  const { frame, length } = frameFromEndpoints(a, c, baseY);
  const steps = Math.max(18, Math.round(length / 130));
  const deckCol: RGB = [0.22, 0.23, 0.24];
  const trussCol: RGB = [0.54, 0.58, 0.62];
  const pierCol: RGB = [0.46, 0.47, 0.46];
  const yAt = (t: number) => {
    const endFade = Math.sin(Math.min(1, t / 0.12) * Math.PI * 0.5) * Math.sin(Math.min(1, (1 - t) / 0.12) * Math.PI * 0.5);
    const u = (t - 0.5) / 0.28;
    return 4.2 + (11.5 - 4.2) * endFade + (peakH - 11.5) * Math.exp(-u * u * 1.4);
  };
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps, tm = (t0 + t1) * 0.5;
    const ym = yAt(tm);
    const segLen = length / steps + 1.5;
    const along = (tm - 0.5) * length;
    pushBox(b, frame, along, 0, ym - 2.4, segLen, width, 2.6, deckCol, { topRgb: deckCol });
    if (truss) {
      // Double-deck steel truss silhouette (Sky Gate Bridge R)
      pushBox(b, frame, along, 0, ym - 7.8, segLen, width * 0.72, 5.4, trussCol, { skipBottom: true });
    }
    for (const side of [-1, 1]) {
      pushBox(b, frame, along, side * (width * 0.5 - 0.7), ym + 0.2, segLen, 1.2, 1.4, [0.66, 0.68, 0.70]);
    }
    if (i % 2 === 0) {
      addLight(b, toWorld(frame, along, 0, ym + 4.8), [1.0, 0.82, 0.52], 2.9, 0);
    }
  }
  for (let i = 1; i < piers; i++) {
    const t = i / piers;
    const ym = yAt(t);
    const along = (t - 0.5) * length;
    pushBox(b, frame, along, 0, -4, 7.5, width * 0.55, ym + (truss ? -3.5 : 1.8), pierCol);
  }
}

/** Build a marked helicopter pad (white circle/square pad + bold yellow 'H' + green perimeter lights). */
function pushHelipad(b: MeshBuilder, lat: number, lon: number, ground: GroundFn, deckOffset: number) {
  const p = toLocal(lat, lon);
  const y = Math.max(0.4, ground(p.x, p.z)) + deckOffset;
  const f: LocalFrame = { cx: p.x, cy: y, cz: p.z, ux: 1, uz: 0, rx: 0, rz: 1 };
  pushStripTop(b, f, 0, 0, 0.14, 34, 34, [0.16, 0.17, 0.18]);
  // Yellow 'H' marking
  const yellow: RGB = [0.84, 0.68, 0.16];
  pushStripTop(b, f, -6, 0, 0.20, 2.2, 16, yellow);
  pushStripTop(b, f, 6, 0, 0.20, 2.2, 16, yellow);
  pushStripTop(b, f, 0, 0, 0.20, 12, 2.2, yellow);
  // Green perimeter helipad lights
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    addLight(b, toWorld(f, Math.cos(a) * 15, Math.sin(a) * 15, 0.7), [0.22, 1.0, 0.45], 2.2, 0);
  }
}

/**
 * Build high-detail 3D models for Kansai International Airport (KIX),
 * Osaka International Airport / Itami (ITM), and Kobe Airport (UKB),
 * including reclaimed seawall islands, runways, markings, terminals, jet bridges,
 * ATC towers, hangars, access bridges, helipads, and night airfield lighting.
 */
export function buildKansaiAirports(env: Env, ground: GroundFn): THREE.Group {
  const b = createBuilder();

  // =========================================================================
  // 1. 関西国際空港 (Kansai International Airport — KIX)
  // =========================================================================
  {
    const rwyA = AIRPORT_RUNWAYS[0];
    const rwyB = AIRPORT_RUNWAYS[1];
    const a0 = toLocal(rwyA.start[0], rwyA.start[1]), a1 = toLocal(rwyA.end[0], rwyA.end[1]);
    const b0 = toLocal(rwyB.start[0], rwyB.start[1]), b1 = toLocal(rwyB.end[0], rwyB.end[1]);
    const { frame: fA, length: lenA } = frameFromEndpoints(a0, a1, rwyA.deckOffset);
    const { frame: fB, length: lenB } = frameFromEndpoints(b0, b1, rwyB.deckOffset);

    // Island 1 (4,550 m × 1,340 m reclaimed seawall platform — cleanly sits above Osaka Bay)
    pushBox(b, fA, 40, -440, -6.8, 4560, 1340, 6.8, [0.40, 0.42, 0.41], { topRgb: [0.19, 0.22, 0.18], skipBottom: true });
    // Apron concrete around Terminal 1
    pushStripTop(b, fA, 0, -560, 0.06, 2600, 540, [0.30, 0.31, 0.32]);
    // Runway A (06R/24L, 3,500 m) + parallel taxiways
    pushRunway(b, fA, lenA, rwyA.width, 0, { approachLen: 680, overWater: true });
    pushTaxiway(b, fA, lenA + 260, -185, 0, [-1650, -1050, -450, 0, 450, 1050, 1650], 0);
    pushTaxiway(b, fA, lenA - 120, -255, 0, [-1200, -450, 450, 1200], -185);

    // Iconic Renzo Piano Terminal 1: 1.7 km long sweeping curved airfoil roof + central hall + North/South wings
    const t1Across = -620;
    const t1Wall: RGB = [0.64, 0.68, 0.72];
    const t1Roof: RGB = [0.76, 0.79, 0.82];
    const t1Glass: RGB = [0.11, 0.18, 0.24];
    // Central main terminal building (300 m × 115 m × 26 m)
    pushBox(b, fA, 0, t1Across, 0, 310, 118, 22, t1Glass, { topRgb: t1Roof, emit: 0.48, glass: 0.88 });
    pushCurvedRoof(b, fA, 0, t1Across, 21.5, 330, 148, 12.5, 1.8, t1Roof, 10);
    // North & South Wings extending 700 m each way (total ~1.7 km!)
    for (const dir of [-1, 1]) {
      pushBox(b, fA, dir * 505, t1Across + 12, 0, 700, 46, 13.5, t1Glass, { topRgb: t1Roof, emit: 0.36, glass: 0.82 });
      pushCurvedRoof(b, fA, dir * 505, t1Across + 12, 13.2, 706, 56, 5.2, 1.2, t1Roof, 8);
      // Boarding gates & jet bridges along both sides of the wings
      for (let g = 0; g < 11; g++) {
        const gs = dir * (200 + g * 58);
        pushBox(b, fA, gs, t1Across + 56, 4.5, 5.5, 42, 4.2, [0.72, 0.74, 0.76], { emit: 0.22 });
        pushBox(b, fA, gs, t1Across - 32, 4.5, 5.5, 34, 4.2, [0.72, 0.74, 0.76], { emit: 0.22 });
      }
    }
    // KIX Station + Aeroplaza + multi-story parking decks on landward side
    pushBox(b, fA, 0, t1Across - 155, 0, 260, 68, 16, [0.58, 0.61, 0.64], { emit: 0.35, glass: 0.55 });
    pushBox(b, fA, 0, t1Across - 265, 0, 220, 82, 26, [0.68, 0.70, 0.72], { emit: 0.32, glass: 0.68 });
    for (const dir of [-1, 1]) {
      pushBox(b, fA, dir * 210, t1Across - 175, 0, 135, 92, 18, [0.54, 0.55, 0.56], { emit: 0.14 });
    }
    // KIX 86 m Air Traffic Control Tower
    pushControlTower(b, fA, 220, t1Across - 270, 0, 86);
    // Cargo & maintenance hangars at North & South ends of Island 1
    for (const s of [-1450, -1180, 1180, 1460]) {
      pushBox(b, fA, s, -540, 0, 190, 95, 18, t1Wall, { topRgb: [0.56, 0.59, 0.62], emit: 0.12 });
    }

    // Island 2 (4,620 m × 1,280 m reclaimed platform — unaffected by prefecture boundary!)
    pushBox(b, fB, 0, 190, -6.8, 4640, 1280, 6.8, [0.40, 0.42, 0.41], { topRgb: [0.18, 0.22, 0.18], skipBottom: true });
    pushRunway(b, fB, lenB, rwyB.width, 0, { approachLen: 680, overWater: true });
    pushTaxiway(b, fB, lenB + 220, 195, 0, [-1900, -1200, -400, 400, 1200, 1900], 0);
    // Terminal 2 (LCC single-level white roof complex on Island 2)
    pushStripTop(b, fB, 180, 480, 0.06, 1350, 360, [0.30, 0.31, 0.32]);
    pushBox(b, fB, 80, 535, 0, 420, 74, 11, [0.74, 0.76, 0.78], { topRgb: [0.80, 0.82, 0.83], emit: 0.30, glass: 0.45 });
    pushBox(b, fB, 520, 535, 0, 280, 68, 11, [0.74, 0.76, 0.78], { topRgb: [0.80, 0.82, 0.83], emit: 0.28, glass: 0.45 });
    // Two connecting taxiway bridges spanning the sea channel between Island 1 and Island 2
    pushBox(b, fA, -620, -1120, -2.5, 65, 360, 2.8, [0.34, 0.36, 0.38]);
    pushBox(b, fA, 620, -1120, -2.5, 65, 360, 2.8, [0.34, 0.36, 0.38]);

    // 3.75 km Sky Gate Bridge R (関西国際空港連絡橋) linking Island 1 to Rinku Town
    pushAccessBridge(b, [34.4310, 135.2520], [34.4126, 135.2918], 0, 30, 29, 28, true);
  }

  // =========================================================================
  // 2. 大阪国際空港・伊丹空港 (Itami Airport — ITM)
  // =========================================================================
  {
    const rwy32L = AIRPORT_RUNWAYS[2];
    const rwy32R = AIRPORT_RUNWAYS[3];
    const p0 = toLocal(rwy32L.start[0], rwy32L.start[1]), p1 = toLocal(rwy32L.end[0], rwy32L.end[1]);
    const q0 = toLocal(rwy32R.start[0], rwy32R.start[1]), q1 = toLocal(rwy32R.end[0], rwy32R.end[1]);
    const yBase = Math.max(ground((p0.x + p1.x) * 0.5, (p0.z + p1.z) * 0.5), ground(p0.x, p0.z), ground(p1.x, p1.z)) + rwy32L.deckOffset;
    const { frame: f32L, length: len32L } = frameFromEndpoints(p0, p1, yBase);
    const { frame: f32R, length: len32R } = frameFromEndpoints(q0, q1, yBase);

    // Airfield green/concrete base apron so terrain slopes never poke through runways or ramps
    pushStripTop(b, f32L, 0, 175, -0.05, len32L + 220, 740, [0.19, 0.23, 0.17]);
    pushStripTop(b, f32L, 120, 445, 0.05, 1650, 330, [0.30, 0.31, 0.32]);

    // Runway 32L/14R (3,000 m — Senrigawa embankment sits just 180 m SE of threshold!)
    pushRunway(b, f32L, len32L, rwy32L.width, 0, { approachLen: 460 });
    // Runway 32R/14L (1,828 m)
    pushRunway(b, f32R, len32R, rwy32R.width, 0, { approachLen: 300 });
    // Taxiways linking 32L, 32R & terminal apron
    pushTaxiway(b, f32L, len32L + 120, 128, 0, [-1400, -850, -250, 350, 950, 1400], 0);
    pushTaxiway(b, f32L, len32L - 260, 295, 0, [-900, -350, 250, 850], 128);

    // Itami Terminal Complex (Curved North JAL + Central + South ANA Wings + Rooftop Observation Deck)
    const termAcross = 545;
    const termGlass: RGB = [0.12, 0.18, 0.23];
    const termRoof: RGB = [0.73, 0.75, 0.77];
    // Central block + rooftop deck
    pushBox(b, f32L, -40, termAcross, 0, 260, 88, 19, termGlass, { topRgb: [0.56, 0.58, 0.60], emit: 0.45, glass: 0.80 });
    pushCurvedRoof(b, f32L, -40, termAcross, 18.8, 250, 74, 4.5, 1.0, termRoof, 6);
    // North Wing (JAL) & South Wing (ANA) + finger piers + jet bridges
    for (const dir of [-1, 1]) {
      pushBox(b, f32L, -40 + dir * 275, termAcross - 12, 0, 290, 56, 15.5, termGlass, { topRgb: termRoof, emit: 0.36, glass: 0.76 });
      // Boarding fingers jutting out onto apron
      pushBox(b, f32L, -40 + dir * 320, termAcross - 92, 0, 34, 125, 11.5, [0.66, 0.69, 0.72], { emit: 0.28, glass: 0.52 });
      for (let g = 0; g < 6; g++) {
        const gs = -40 + dir * (155 + g * 46);
        pushBox(b, f32L, gs, termAcross - 58, 4.2, 5.0, 36, 3.8, [0.72, 0.74, 0.76], { emit: 0.22 });
      }
    }
    // Multi-story parking & Osaka Monorail Airport Station on east side of terminal
    pushBox(b, f32L, -40, termAcross + 115, 0, 380, 62, 16, [0.55, 0.56, 0.57], { emit: 0.22 });
    // Itami ATC Control Tower
    pushControlTower(b, f32L, 38, termAcross + 58, 0, 48);
    // Large ANA & JAL maintenance hangars at North & South apron ends
    for (const s of [-920, -680, 580, 820]) {
      pushBox(b, f32L, s, 495, 0, 165, 86, 22, [0.60, 0.63, 0.66], { topRgb: [0.54, 0.58, 0.62], emit: 0.14 });
    }
  }

  // =========================================================================
  // 3. 神戸空港 (Kobe Airport — UKB)
  // =========================================================================
  {
    const rwy = AIRPORT_RUNWAYS[4];
    const p0 = toLocal(rwy.start[0], rwy.start[1]), p1 = toLocal(rwy.end[0], rwy.end[1]);
    const { frame: fK, length: lenK } = frameFromEndpoints(p0, p1, rwy.deckOffset);

    // Reclaimed Airport Island seawall platform (3,180 m × 960 m sitting above Osaka Bay)
    pushBox(b, fK, 0, -145, -6.4, 3180, 960, 6.4, [0.40, 0.42, 0.41], { topRgb: [0.19, 0.23, 0.18], skipBottom: true });
    // Apron concrete on north side of runway
    pushStripTop(b, fK, -80, -340, 0.06, 1750, 300, [0.30, 0.31, 0.32]);

    // Runway 09/27 (2,500 m × 60 m) + over-water approach light piers at both ends
    pushRunway(b, fK, lenK, rwy.width, 0, { approachLen: 520, overWater: true });
    pushTaxiway(b, fK, lenK + 120, -155, 0, [-1180, -550, 0, 550, 1180], 0);

    // Kobe Airport Main Passenger Terminal + curved signature roof + jet bridges
    const termAcross = -435;
    pushBox(b, fK, 140, termAcross, 0, 290, 68, 16, [0.12, 0.19, 0.25], { topRgb: [0.76, 0.79, 0.82], emit: 0.42, glass: 0.84 });
    pushCurvedRoof(b, fK, 140, termAcross, 15.8, 305, 84, 6.2, 1.3, [0.78, 0.81, 0.84], 8);
    for (let g = -2; g <= 2; g++) {
      pushBox(b, fK, 140 + g * 54, termAcross + 54, 4.2, 5.2, 38, 3.8, [0.72, 0.74, 0.76], { emit: 0.22 });
    }
    // New International Sub-Terminal (T2) west of main terminal
    pushBox(b, fK, -190, termAcross + 12, 0, 175, 58, 12.5, [0.68, 0.71, 0.74], { topRgb: [0.78, 0.80, 0.82], emit: 0.34, glass: 0.65 });
    // Kobe Airport ATC Control Tower
    pushControlTower(b, fK, 360, termAcross + 18, 0, 44);
    // West Helicopter & Business Jet Hangar complex (Fire/Police/Coast Guard/Airbus Helicopters Japan!)
    for (const s of [-980, -820, -660, -500]) {
      pushBox(b, fK, s, termAcross + 28, 0, 110, 58, 13.5, [0.62, 0.65, 0.68], { topRgb: [0.56, 0.60, 0.64], emit: 0.16 });
    }
    // Port Liner station & parking decks north of terminal
    pushBox(b, fK, 140, termAcross - 92, 0, 260, 52, 12, [0.56, 0.58, 0.60], { emit: 0.22 });

    // 1.2 km Kobe Sky Bridge (神戸スカイブリッジ) connecting Kobe Airport north to Port Island
    pushAccessBridge(b, [34.6378, 135.2248], [34.6486, 135.2254], 0, 24, 24, 14, false);
  }

  // =========================================================================
  // 4. Marked Helipads (Kobe Airport, Itami, Maishima, Kyoto)
  // =========================================================================
  for (const pad of HELIPADS) {
    pushHelipad(b, pad.lat, pad.lon, ground, pad.deckOffset);
  }

  const group = new THREE.Group();
  group.name = 'kansai-airports';

  // Build main solid/glass airport structures mesh
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(b.emit, 1));
  geo.setAttribute('aGlass', new THREE.Float32BufferAttribute(b.glass, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: env,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEmit;
      attribute float aGlass;
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vEmit = aEmit;
        vGlass = aGlass;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 lit = shade(seasonalSurface(vColor, n, vWorld), n, vWorld, 1.);
        if (vGlass > .05) {
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 r = reflect(v, n);
          r.y = clamp(r.y + .06, -.05, 1.);
          vec3 rn = normalize(r);
          float fres = .14 + .62 * pow(1. - clamp(dot(-v, n), 0., 1.), 3.4);
          lit += skyColor(rn) * fres * vGlass;
          lit += uSunLight * pow(max(dot(rn, uSunDir), 0.), 56.) * .55 * vGlass;
        }
        vec3 emit = mix(vec3(1., .84, .58), vec3(.78, .90, 1.), vGlass * .5) * vEmit * .75 * uCity;
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), 1.);
      }
    `,
  });
  const solidMesh = new THREE.Mesh(geo, mat);
  solidMesh.name = 'kansai-airports-structures';
  solidMesh.frustumCulled = false;
  group.add(solidMesh);

  // Build crisp additive airfield lighting points (runway edge, PAPI, ALS sequenced strobes, taxiway blue, beacons)
  const lightGeo = new THREE.BufferGeometry();
  lightGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.lightPos, 3));
  lightGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.lightCol, 3));
  lightGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(b.lightSize, 1));
  lightGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(b.lightPhase, 1));
  lightGeo.computeBoundingSphere();

  const lightMat = new THREE.ShaderMaterial({
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
        float dist = max(12., -mv.z);
        // Active at dusk/night, with dim visibility for sequenced ALS & beacons even in late afternoon.
        float nightGain = smoothstep(.04, .42, uCity);
        float pulse = 1.;
        if (aPhase >= 2.9) {
          // Sequenced ALS rabbit flash sweeping smoothly toward threshold twice per second.
          float wave = fract(uTime * 2.0 - (aPhase - 3.0));
          pulse = smoothstep(.0, .06, wave) * (1. - smoothstep(.06, .18, wave)) * 2.4;
          nightGain = max(nightGain, .35);
        } else if (aPhase >= 1.9) {
          // Rotating airport green/white beacon.
          pulse = .35 + 1.45 * pow(max(0., sin(uTime * 2.1)), 6.);
          nightGain = max(nightGain, .25);
        } else if (aPhase >= 0.9) {
          // Red obstruction beacon pulse.
          pulse = .45 + .95 * smoothstep(.2, .85, sin(uTime * 3.1));
          nightGain = max(nightGain, .2);
        }
        vColor = aColor * (1.2 + .9 * nightGain);
        vAlpha = nightGain * pulse * (1. - smoothstep(14000., 32000., dist));
        gl_PointSize = clamp(aSize * 900. / dist, 1.5, 14.);
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
        float core = exp(-r2 * 18.) + .35 * exp(-r2 * 5.5);
        gl_FragColor = vec4(vColor * core, vAlpha);
      }
    `,
  });
  const lights = new THREE.Points(lightGeo, lightMat);
  lights.name = 'kansai-airports-lights';
  lights.frustumCulled = false;
  group.add(lights);

  return group;
}
