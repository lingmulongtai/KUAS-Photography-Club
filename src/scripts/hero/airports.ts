import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { toLocal } from './geo';
import { AIRPORT_RUNWAYS, HELIPADS } from './airports-data';
export { AIRPORT_RUNWAYS, HELIPADS, inAirportBuildingMask, type RunwaySpec, type HelipadSpec } from './airports-data';

type RGB = [number, number, number];
type GroundFn = (x: number, z: number) => number;

/** Surface texture class encoded per vertex for procedural shader detailing. */
const SURF = {
  solid: 0,
  asphalt: 1,
  concrete: 2,
  turf: 3,
  seawall: 4,
  terminalGlass: 5,
  hangarMetal: 6,
} as const;

interface MeshBuilder {
  pos: number[];
  nrm: number[];
  col: number[];
  emit: number[];
  glass: number[];
  surf: number[];
  lightPos: number[];
  lightCol: number[];
  lightSize: number[];
  lightPhase: number[];
}

function createBuilder(): MeshBuilder {
  return { pos: [], nrm: [], col: [], emit: [], glass: [], surf: [], lightPos: [], lightCol: [], lightSize: [], lightPhase: [] };
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
  /** Optional terrain sampler for inland runways/taxiways that drape smoothly onto ground elevation. */
  drape?: (x: number, z: number) => number;
}

function frameFromEndpoints(
  a: { x: number; z: number },
  b: { x: number; z: number },
  y: number,
  drape?: (x: number, z: number) => number,
): { frame: LocalFrame; length: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length;
  return {
    length,
    frame: { cx: (a.x + b.x) * 0.5, cy: y, cz: (a.z + b.z) * 0.5, ux, uz, rx: -uz, rz: ux, drape },
  };
}

function baseYAt(f: LocalFrame, along: number, across: number): number {
  if (!f.drape) return f.cy;
  const wx = f.cx + f.ux * along + f.rx * across;
  const wz = f.cz + f.uz * along + f.rz * across;
  return f.drape(wx, wz) + f.cy;
}

function toWorld(f: LocalFrame, along: number, across: number, up: number): [number, number, number] {
  const wx = f.cx + f.ux * along + f.rx * across;
  const wz = f.cz + f.uz * along + f.rz * across;
  const by = f.drape ? f.drape(wx, wz) + f.cy : f.cy;
  return [wx, by + up, wz];
}

function toWorldFixedY(f: LocalFrame, along: number, across: number, absY: number): [number, number, number] {
  return [f.cx + f.ux * along + f.rx * across, absY, f.cz + f.uz * along + f.rz * across];
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
  sf = 0,
) {
  for (const v of [p0, p1, p2, p0, p2, p3]) {
    b.pos.push(v[0], v[1], v[2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.col.push(rgb[0], rgb[1], rgb[2]);
    b.emit.push(em);
    b.glass.push(gl);
    b.surf.push(sf);
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
  opts?: { topRgb?: RGB; emit?: number; topEmit?: number; glass?: number; surf?: number; topSurf?: number; skipBottom?: boolean },
) {
  const hl = len * 0.5, hw = wid * 0.5;
  // Anchor building footprints at their center terrain height so floors stay perfectly level on gentle slopes
  const anchorY = baseYAt(f, along, across);
  const y0 = anchorY + yBottom;
  const y1 = y0 + h;
  const b00 = toWorldFixedY(f, along - hl, across - hw, y0);
  const b10 = toWorldFixedY(f, along + hl, across - hw, y0);
  const b11 = toWorldFixedY(f, along + hl, across + hw, y0);
  const b01 = toWorldFixedY(f, along - hl, across + hw, y0);
  const t00 = toWorldFixedY(f, along - hl, across - hw, y1);
  const t10 = toWorldFixedY(f, along + hl, across - hw, y1);
  const t11 = toWorldFixedY(f, along + hl, across + hw, y1);
  const t01 = toWorldFixedY(f, along - hl, across + hw, y1);
  const em = opts?.emit ?? 0;
  const topEm = opts?.topEmit ?? em * 0.18;
  const gl = opts?.glass ?? 0;
  const sf = opts?.surf ?? (gl > 0.35 ? SURF.terminalGlass : SURF.solid);
  const topSf = opts?.topSurf ?? SURF.solid;
  const topRgb = opts?.topRgb ?? rgb;
  const sideA: RGB = [rgb[0] * 0.94, rgb[1] * 0.94, rgb[2] * 0.94];
  const sideB: RGB = [rgb[0] * 0.88, rgb[1] * 0.88, rgb[2] * 0.88];

  pushQuad(b, t00, t01, t11, t10, [0, 1, 0], topRgb, topEm, gl * 0.15, topSf);
  pushQuad(b, b10, b11, t11, t10, [f.ux, 0, f.uz], sideA, em, gl, sf);
  pushQuad(b, b01, b00, t00, t01, [-f.ux, 0, -f.uz], sideA, em, gl, sf);
  pushQuad(b, b11, b01, t01, t11, [f.rx, 0, f.rz], sideB, em, gl, sf);
  pushQuad(b, b00, b10, t10, t00, [-f.rx, 0, -f.rz], sideB, em, gl, sf);
  if (!opts?.skipBottom) {
    pushQuad(b, b00, b10, b11, b01, [0, -1, 0], sideB, 0, 0, sf);
  }
}

/** Push a flat or terrain-draped surface strip, subdivided along length when `f.drape` is active. */
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
  sf = 0,
) {
  const hl = len * 0.5, hw = wid * 0.5;
  const segs = f.drape && len > 65 ? Math.max(2, Math.ceil(len / 50)) : 1;
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    const a0 = along - hl + i * step;
    const a1 = a0 + step;
    const p0 = toWorld(f, a0, across - hw, y);
    const p1 = toWorld(f, a0, across + hw, y);
    const p2 = toWorld(f, a1, across + hw, y);
    const p3 = toWorld(f, a1, across - hw, y);
    pushQuad(b, p0, p1, p2, p3, [0, 1, 0], rgb, em, 0, sf);
  }
}

function addLight(b: MeshBuilder, p: [number, number, number], rgb: RGB, size: number, phase = 0) {
  b.lightPos.push(p[0], p[1], p[2]);
  b.lightCol.push(rgb[0], rgb[1], rgb[2]);
  b.lightSize.push(size);
  b.lightPhase.push(phase);
}

/** Build an arched/curved airfoil roof (terminals & arched maintenance hangars). */
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
  surf: number = SURF.hangarMetal,
) {
  const hl = len * 0.5;
  const anchorY = baseYAt(f, along, across);
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments - 0.5;
    const t1 = (i + 1) / segments - 0.5;
    const w0 = across + t0 * wid;
    const w1 = across + t1 * wid;
    const y0 = anchorY + baseY + Math.cos(t0 * Math.PI) * archRise;
    const y1 = anchorY + baseY + Math.cos(t1 * Math.PI) * archRise;
    const p00 = toWorldFixedY(f, along - hl, w0, y0 + thickness);
    const p01 = toWorldFixedY(f, along - hl, w1, y1 + thickness);
    const p11 = toWorldFixedY(f, along + hl, w1, y1 + thickness);
    const p10 = toWorldFixedY(f, along + hl, w0, y0 + thickness);
    const slope = (y1 - y0) / (w1 - w0);
    const inv = 1 / Math.hypot(slope, 1);
    const nx = -f.rx * slope * inv, ny = inv, nz = -f.rz * slope * inv;
    pushQuad(b, p00, p01, p11, p10, [nx, ny, nz], rgb, 0.04, 0.22, surf);
  }
}

/** Build a high-detail Maintenance Hangar (ANA/JAL/Cargo) with arched truss roof, ribbed walls, tall hangar doors & lit bays. */
function pushMaintenanceHangar(
  b: MeshBuilder,
  f: LocalFrame,
  along: number,
  across: number,
  len: number,
  wid: number,
  wallH: number,
  doorSide: -1 | 1,
  accentRgb: RGB,
) {
  const wallCol: RGB = [0.64, 0.67, 0.70];
  const roofCol: RGB = [0.56, 0.60, 0.64];
  const doorCol: RGB = [0.46, 0.50, 0.54];
  // Main hangar hall
  pushBox(b, f, along, across, -1.2, len, wid, wallH + 1.2, wallCol, { topRgb: roofCol, emit: 0.14, surf: SURF.hangarMetal, skipBottom: true });
  // Sweeping arched hangar roof shell
  pushCurvedRoof(b, f, along, across, wallH - 0.5, len + 2, wid + 3, 5.2, 1.1, roofCol, 8, SURF.hangarMetal);
  // Airline color fascia header above hangar doors
  pushBox(b, f, along, across + doorSide * (wid * 0.5 + 0.6), wallH - 3.6, len - 4, 1.4, 3.2, accentRgb, { emit: 0.26 });
  // Tall sliding hangar bay doors with illuminated interior bay glow at night
  const bays = Math.max(2, Math.round(len / 48));
  const baySpan = (len - 14) / bays;
  for (let i = 0; i < bays; i++) {
    const ba = along - (len - 14) * 0.5 + (i + 0.5) * baySpan;
    const isLitBay = i % 2 === 0;
    pushBox(
      b, f, ba, across + doorSide * (wid * 0.5 + 0.35), 0,
      baySpan * 0.84, 0.9, wallH - 4.4,
      isLitBay ? [0.22, 0.26, 0.30] : doorCol,
      { emit: isLitBay ? 0.68 : 0.12, glass: isLitBay ? 0.35 : 0.05 },
    );
  }
  // Attached maintenance office/workshop wing on back side
  pushBox(b, f, along, across - doorSide * (wid * 0.5 + 11), -1.0, len * 0.85, 20, wallH * 0.55 + 1.0, [0.54, 0.57, 0.60], {
    emit: 0.30, glass: 0.55, surf: SURF.terminalGlass, skipBottom: true,
  });
  // Apron floodlight mast lighting the aircraft maintenance stand at night
  const mastPos = toWorld(f, along, across + doorSide * (wid * 0.5 + 18), wallH + 6);
  addLight(b, mastPos, [1.0, 0.90, 0.72], 5.6, 0);
}

/** Build an authentic Air Traffic Control Tower (podium + ribbed shaft + equipment gallery + flared glazed cab + radome + beacons). */
function pushControlTower(b: MeshBuilder, f: LocalFrame, along: number, across: number, baseY: number, height: number) {
  const concrete: RGB = [0.68, 0.70, 0.72];
  const trimDark: RGB = [0.36, 0.39, 0.42];
  const cabGlass: RGB = [0.06, 0.14, 0.20];
  const roofWhite: RGB = [0.84, 0.86, 0.88];
  // Operations base podium with glazed windows
  pushBox(b, f, along, across, baseY - 1.5, 34, 28, Math.min(14, height * 0.24) + 1.5, [0.56, 0.59, 0.62], {
    emit: 0.34, glass: 0.58, surf: SURF.terminalGlass, skipBottom: true,
  });
  // Fluted vertical concrete shaft with vertical dark service core strips
  const shaftH = height - 11.5;
  pushBox(b, f, along, across, baseY, 12.5, 12.5, shaftH, concrete, { skipBottom: true });
  pushBox(b, f, along, across, baseY, 13.6, 5.2, shaftH - 2, trimDark, { skipBottom: true });
  pushBox(b, f, along, across, baseY, 5.2, 13.6, shaftH - 2, trimDark, { skipBottom: true });
  // Cantilevered equipment & radar gallery below cab
  pushBox(b, f, along, across, baseY + shaftH - 3.2, 17.5, 17.5, 3.2, trimDark, { emit: 0.16 });
  pushBox(b, f, along, across, baseY + shaftH, 19.5, 19.5, 1.4, concrete);
  // Flared panoramic glazed ATC control cab (bright warm-cyan instrument room glow at night!)
  pushBox(b, f, along, across, baseY + shaftH + 1.4, 20.5, 20.5, 6.4, cabGlass, {
    emit: 0.92, glass: 0.96, surf: SURF.terminalGlass, topRgb: roofWhite,
  });
  // Overhanging sun-visor roof + upper antenna deck + white ASR radome
  pushBox(b, f, along, across, baseY + shaftH + 7.8, 24.0, 24.0, 1.8, roofWhite, { emit: 0.15 });
  pushBox(b, f, along, across, baseY + shaftH + 9.6, 8.2, 8.2, 4.8, [0.86, 0.88, 0.90]);
  pushBox(b, f, along, across, baseY + shaftH + 14.4, 0.8, 0.8, 5.5, [0.80, 0.24, 0.20]);
  // Red aviation obstruction beacon + rotating green/white airport aerodrome beacon
  const anchorY = baseYAt(f, along, across) + baseY;
  addLight(b, toWorldFixedY(f, along, across, anchorY + shaftH + 20.2), [1.0, 0.12, 0.08], 6.4, 1.0);
  addLight(b, toWorldFixedY(f, along + 7, across, anchorY + shaftH + 11.2), [0.30, 1.0, 0.56], 7.2, 2.0);
}

/** Build a tall apron floodlight mast illuminating terminal gates & stands at night. */
function pushApronFloodlight(b: MeshBuilder, f: LocalFrame, along: number, across: number, height = 24) {
  pushBox(b, f, along, across, -0.6, 1.2, 1.2, height + 0.6, [0.58, 0.60, 0.62], { skipBottom: true });
  pushBox(b, f, along, across, height - 0.8, 5.5, 1.6, 1.4, [0.85, 0.86, 0.88], { emit: 1.0 });
  const anchorY = baseYAt(f, along, across);
  addLight(b, toWorldFixedY(f, along, across, anchorY + height + 0.6), [1.0, 0.92, 0.78], 6.0, 0);
}

/**
 * Build a complete high-detail runway with grooved asphalt texture, tire-skid touchdown zones,
 * piano-key thresholds, aiming points, centerline dashes, ICAO-accurate PAPI (left side abeam
 * aiming point: inner 2 RED, outer 2 WHITE), and bright full-spectrum night airfield lighting.
 */
function pushRunway(
  b: MeshBuilder,
  f: LocalFrame,
  length: number,
  width: number,
  y: number,
  opts?: { approachLen?: number; overWater?: boolean; papiSides?: [1 | -1, 1 | -1] },
) {
  const asphalt: RGB = [0.092, 0.097, 0.105];
  const shoulder: RGB = [0.145, 0.150, 0.156];
  const blastPad: RGB = [0.112, 0.118, 0.124];
  const rubberSkid: RGB = [0.052, 0.055, 0.060];
  const paint: RGB = [0.84, 0.85, 0.84];
  const yellow: RGB = [0.80, 0.66, 0.16];
  const halfL = length * 0.5;
  const halfW = width * 0.5;

  // Paved shoulders + main textured grooved asphalt runway
  pushStripTop(b, f, 0, 0, y + 0.06, length + 110, width + 16, shoulder, 0, SURF.asphalt);
  pushStripTop(b, f, 0, 0, y + 0.13, length, width, asphalt, 0, SURF.asphalt);
  // Stopway / blast pads at both ends
  pushStripTop(b, f, -halfL - 32, 0, y + 0.11, 56, width, blastPad, 0, SURF.asphalt);
  pushStripTop(b, f, halfL + 32, 0, y + 0.11, 56, width, blastPad, 0, SURF.asphalt);
  // Subtle dark touchdown rubber streaks at both ends
  for (const dir of [-1, 1]) {
    pushStripTop(b, f, dir * (halfL - 360), 0, y + 0.16, 460, width * 0.44, rubberSkid, 0, SURF.asphalt);
  }
  // Yellow blast-pad chevron bars
  for (const dir of [-1, 1]) {
    for (const off of [18, 42]) {
      pushStripTop(b, f, dir * (halfL + off), 0, y + 0.19, 2.8, width * 0.56, yellow);
    }
  }

  // Crisp white runway edge stripes
  for (const side of [-1, 1]) {
    pushStripTop(b, f, 0, side * (halfW - 1.1), y + 0.21, length - 4, 1.25, paint);
  }
  // Centerline dashes every 55 m
  for (let s = -halfL + 105; s <= halfL - 105; s += 55) {
    pushStripTop(b, f, s, 0, y + 0.21, 30, 1.35, paint);
  }
  // Piano-key threshold stripes, aiming point blocks (300 m) & touchdown zone (TDZ) pairs
  const bars = width >= 55 ? 6 : 4;
  for (const dir of [-1, 1]) {
    for (let k = 1; k <= bars; k++) {
      const across = (k / (bars + 0.6)) * (halfW - 4.2);
      for (const side of [-1, 1]) {
        pushStripTop(b, f, dir * (halfL - 28), side * across, y + 0.21, 36, 2.1, paint);
      }
    }
    for (const side of [-1, 1]) {
      pushStripTop(b, f, dir * (halfL - 300), side * (halfW * 0.36), y + 0.21, 54, 7.2, paint);
    }
    for (const d of [150, 460, 610]) {
      if (d < halfL - 120) {
        for (const side of [-1, 1]) {
          pushStripTop(b, f, dir * (halfL - d), side * (halfW * 0.34), y + 0.21, 24, 3.3, paint);
        }
      }
    }
  }

  // 1. Bright Runway Edge Lights (REDL every 50 m: crisp white, switching to golden amber in final 600 m!)
  const edgeStep = 50;
  for (let s = -halfL; s <= halfL; s += edgeStep) {
    const nearEnd = halfL - Math.abs(s) < 600;
    const edgeRgb: RGB = nearEnd ? [1.0, 0.78, 0.24] : [1.0, 0.97, 0.90];
    for (const side of [-1, 1]) {
      addLight(b, toWorld(f, s, side * (halfW + 2.6), y + 1.15), edgeRgb, 4.2, 0);
    }
  }
  // 2. Dense Runway Centerline Lights (RCL every 35 m: white -> alternating red/white last 900 m -> red last 300 m)
  const clStep = 35;
  let clIdx = 0;
  for (let s = -halfL + 35; s <= halfL - 35; s += clStep, clIdx++) {
    const distFromEnd = halfL - Math.abs(s);
    const clRgb: RGB = distFromEnd < 300
      ? [1.0, 0.18, 0.12]
      : (distFromEnd < 900 && clIdx % 2 === 1) ? [1.0, 0.24, 0.16] : [0.98, 0.98, 0.95];
    addLight(b, toWorld(f, s, 0, y + 0.95), clRgb, 3.0, 0);
  }

  // 3. Threshold green/red bar + Touchdown Zone (TDZ) white bars + ICAO-accurate PAPI + ALSF-II Approach Lights
  const approachLen = opts?.approachLen ?? 540;
  const papiSideStart = opts?.papiSides?.[0] ?? -1; // default pilot's LEFT side when landing from start (dir=-1 -> -rx)
  const papiSideEnd = opts?.papiSides?.[1] ?? 1;    // default pilot's LEFT side when landing from end (dir=+1 -> +rx)
  for (const dir of [-1, 1] as const) {
    // Threshold green wing bars + end red lights
    for (let k = -5; k <= 5; k++) {
      addLight(b, toWorld(f, dir * halfL, k * (width / 10.5), y + 1.25), [0.18, 1.0, 0.42], 4.4, 0);
      if (Math.abs(k) <= 3) {
        addLight(b, toWorld(f, dir * (halfL + 4), k * (width / 8), y + 1.15), [1.0, 0.14, 0.10], 3.4, 0);
      }
    }
    // Touchdown zone (TDZ) twin white light bars for first 650 m past threshold
    for (let d = 90; d <= Math.min(630, halfL - 150); d += 90) {
      for (const side of [-1, 1]) {
        addLight(b, toWorld(f, dir * (halfL - d), side * (halfW * 0.30), y + 0.95), [1.0, 0.98, 0.92], 2.9, 0);
      }
    }
    // ICAO/JCAB PAPI (4 light units perpendicular to runway, 16 m OUTSIDE runway edge, abeam aiming point 340 m past threshold!)
    // Inner 2 lights (closest to runway, p=0,1) = RED; Outer 2 lights (farthest from runway, p=2,3) = WHITE.
    const papiSide = dir === -1 ? papiSideStart : papiSideEnd;
    const papiAlong = dir * (halfL - 340);
    for (let p = 0; p < 4; p++) {
      const across = papiSide * (halfW + 16 + p * 7.5);
      // Physical dark housing box beside runway
      pushBox(b, f, papiAlong, across, y, 2.2, 2.8, 1.1, [0.18, 0.19, 0.20]);
      const papiCol: RGB = p < 2 ? [1.0, 0.14, 0.10] : [1.0, 0.98, 0.90];
      // PAPI stays visible in late afternoon/dusk/night (phase 0.5 gives subtle daytime/dusk boost)
      addLight(b, toWorld(f, papiAlong, across, y + 1.45), papiCol, 4.8, 0.5);
    }

    // Approach Lighting System (ALSF-II): centerline barrettes + 300 m decision crossbar + red side row bars + sequenced rabbit strobes
    if (opts?.overWater) {
      pushBox(b, f, dir * (halfL + approachLen * 0.5 + 26), 0, y - 3.6, approachLen, 8.5, 3.8, [0.42, 0.44, 0.46]);
    }
    for (let d = 55; d <= approachLen; d += 50) {
      const isCrossbar = Math.abs(d - 280) < 30;
      const span = isCrossbar ? 6 : 1;
      for (let k = -span; k <= span; k++) {
        addLight(b, toWorld(f, dir * (halfL + d), k * 4.5, y + 1.8), [1.0, 0.95, 0.85], isCrossbar ? 4.8 : 4.2, 0);
      }
      // Red side-row barrettes in inner 270 m (ALSF-II signature!)
      if (d <= 265) {
        for (const side of [-1, 1]) {
          addLight(b, toWorld(f, dir * (halfL + d), side * (halfW * 0.36), y + 1.7), [1.0, 0.16, 0.12], 3.8, 0);
        }
      }
      // Sequenced flashing white rabbit strobe sweeping cleanly toward threshold!
      addLight(b, toWorld(f, dir * (halfL + d), 0, y + 2.4), [0.94, 0.99, 1.0], 6.4, 3.0 + (approachLen - d) / approachLen);
    }
  }
}

/** Build a parallel taxiway with textured asphalt, yellow centerline, crisp blue edge lights & green centerline lights. */
function pushTaxiway(b: MeshBuilder, f: LocalFrame, length: number, across: number, y: number, connectors: number[], runwayAcross = 0, drawPavement = true) {
  const taxiAsphalt: RGB = [0.128, 0.133, 0.142];
  const yellow: RGB = [0.78, 0.64, 0.16];
  if (drawPavement) {
    pushStripTop(b, f, 0, across, y + 0.09, length, 23, taxiAsphalt, 0, SURF.asphalt);
    pushStripTop(b, f, 0, across, y + 0.15, length - 10, 0.85, yellow);
  }
  const halfL = length * 0.5;
  for (let s = -halfL; s <= halfL; s += 60) {
    for (const side of [-1, 1]) {
      addLight(b, toWorld(f, s, across + side * 12.5, y + 0.95), [0.18, 0.52, 1.0], 3.1, 0);
    }
    addLight(b, toWorld(f, s, across, y + 0.85), [0.18, 0.96, 0.44], 2.4, 0);
  }
  const midAcross = (across + runwayAcross) * 0.5;
  const spanAcross = Math.abs(across - runwayAcross);
  for (const s of connectors) {
    if (drawPavement) {
      pushStripTop(b, f, s, midAcross, y + 0.08, 25, spanAcross, taxiAsphalt, 0, SURF.asphalt);
      pushStripTop(b, f, s, midAcross, y + 0.14, 0.8, spanAcross - 12, yellow);
    }
    const steps = Math.max(2, Math.round(spanAcross / 45));
    for (let k = 1; k < steps; k++) {
      const a = runwayAcross + ((across - runwayAcross) * k) / steps;
      addLight(b, toWorld(f, s, a, y + 0.85), [0.18, 0.96, 0.44], 2.4, 0);
    }
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
  const deckCol: RGB = [0.20, 0.21, 0.22];
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
    pushBox(b, frame, along, 0, ym - 2.4, segLen, width, 2.6, deckCol, { topRgb: deckCol, topSurf: SURF.asphalt });
    if (truss) {
      pushBox(b, frame, along, 0, ym - 7.8, segLen, width * 0.72, 5.4, trussCol, { skipBottom: true });
    }
    for (const side of [-1, 1]) {
      pushBox(b, frame, along, side * (width * 0.5 - 0.7), ym + 0.2, segLen, 1.2, 1.4, [0.66, 0.68, 0.70]);
    }
    if (i % 2 === 0) {
      addLight(b, toWorldFixedY(frame, along, 0, baseY + ym + 4.8), [1.0, 0.84, 0.56], 3.8, 0);
    }
  }
  for (let i = 1; i < piers; i++) {
    const t = i / piers;
    const ym = yAt(t);
    const along = (t - 0.5) * length;
    pushBox(b, frame, along, 0, -4, 7.5, width * 0.55, ym + (truss ? -3.5 : 1.8), pierCol);
  }
}

/** Build a marked helicopter pad (asphalt pad + bold yellow 'H' + crisp green perimeter lights). */
function pushHelipad(b: MeshBuilder, lat: number, lon: number, ground: GroundFn, deckOffset: number) {
  const p = toLocal(lat, lon);
  const y = Math.max(0.4, ground(p.x, p.z)) + deckOffset;
  const f: LocalFrame = { cx: p.x, cy: y, cz: p.z, ux: 1, uz: 0, rx: 0, rz: 1 };
  pushStripTop(b, f, 0, 0, 0.14, 34, 34, [0.14, 0.15, 0.16], 0, SURF.asphalt);
  const yellow: RGB = [0.84, 0.68, 0.16];
  pushStripTop(b, f, -6, 0, 0.21, 2.2, 16, yellow);
  pushStripTop(b, f, 6, 0, 0.21, 2.2, 16, yellow);
  pushStripTop(b, f, 0, 0, 0.21, 12, 2.2, yellow);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    addLight(b, toWorld(f, Math.cos(a) * 15, Math.sin(a) * 15, 0.8), [0.20, 1.0, 0.45], 3.2, 0);
  }
}

/**
 * Build high-detail 3D models for Kansai International Airport (KIX),
 * Osaka International Airport / Itami (ITM), and Kobe Airport (UKB),
 * aligned to exact OSM/AIP runway coordinates with textured pavements/turf,
 * high-detail terminals, control towers, maintenance hangars, ICAO PAPI,
 * and brilliant full-spectrum night airfield lighting.
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

    // Island 1 (textured coastal turf + riprap seawall + concrete apron)
    pushBox(b, fA, 40, -455, -6.8, 4520, 1340, 6.8, [0.40, 0.42, 0.41], {
      topRgb: [0.22, 0.26, 0.20], surf: SURF.seawall, topSurf: SURF.turf, skipBottom: true,
    });
    pushStripTop(b, fA, 0, -565, 0.06, 2750, 560, [0.34, 0.35, 0.36], 0, SURF.concrete);
    pushRunway(b, fA, lenA, rwyA.width, 0, { approachLen: 680, overWater: true });
    pushTaxiway(b, fA, lenA + 220, -185, 0, [-1600, -1020, -440, 0, 440, 1020, 1600], 0);
    pushTaxiway(b, fA, lenA - 120, -255, 0, [-1180, -440, 440, 1180], -185);

    // Iconic Renzo Piano Terminal 1 (1.7 km sweeping airfoil roof + North/South wings + 30 jet bridges)
    const t1Across = -625;
    const t1Roof: RGB = [0.78, 0.81, 0.84];
    const t1Glass: RGB = [0.10, 0.17, 0.24];
    pushBox(b, fA, 0, t1Across, 0, 315, 120, 23, t1Glass, { topRgb: t1Roof, emit: 0.68, glass: 0.90, surf: SURF.terminalGlass });
    pushCurvedRoof(b, fA, 0, t1Across, 22.5, 336, 152, 13.0, 1.8, t1Roof, 10);
    for (const dir of [-1, 1]) {
      pushBox(b, fA, dir * 508, t1Across + 12, 0, 705, 48, 14.5, t1Glass, { topRgb: t1Roof, emit: 0.56, glass: 0.85, surf: SURF.terminalGlass });
      pushCurvedRoof(b, fA, dir * 508, t1Across + 12, 14.2, 712, 58, 5.4, 1.2, t1Roof, 8);
      for (let g = 0; g < 11; g++) {
        const gs = dir * (195 + g * 58);
        pushBox(b, fA, gs, t1Across + 58, 4.5, 5.5, 44, 4.2, [0.74, 0.76, 0.78], { emit: 0.34, glass: 0.45 });
        pushBox(b, fA, gs, t1Across - 34, 4.5, 5.5, 36, 4.2, [0.74, 0.76, 0.78], { emit: 0.34, glass: 0.45 });
        if (g % 3 === 1) pushApronFloodlight(b, fA, gs, t1Across + 96, 26);
      }
    }
    // KIX Station + Aeroplaza + Hotel Nikko + Parking decks
    pushBox(b, fA, 0, t1Across - 155, 0, 268, 70, 17, [0.58, 0.61, 0.64], { emit: 0.48, glass: 0.62, surf: SURF.terminalGlass });
    pushBox(b, fA, 0, t1Across - 265, 0, 224, 84, 28, [0.68, 0.70, 0.73], { emit: 0.44, glass: 0.72, surf: SURF.terminalGlass });
    for (const dir of [-1, 1]) {
      pushBox(b, fA, dir * 215, t1Across - 175, 0, 140, 94, 18, [0.54, 0.56, 0.58], { emit: 0.24 });
    }
    // KIX 86 m Air Traffic Control Tower
    pushControlTower(b, fA, 220, t1Across - 270, 0, 86);
    // KIX North & South Maintenance & Cargo Hangar complexes
    pushMaintenanceHangar(b, fA, -1420, -545, 195, 94, 21, 1, [0.10, 0.28, 0.62]);
    pushMaintenanceHangar(b, fA, -1140, -545, 175, 90, 19, 1, [0.72, 0.14, 0.16]);
    pushMaintenanceHangar(b, fA, 1180, -545, 185, 92, 20, 1, [0.14, 0.36, 0.64]);
    pushMaintenanceHangar(b, fA, 1460, -545, 195, 94, 21, 1, [0.68, 0.18, 0.22]);

    // Island 2 (exact surveyed 06L/24R + Terminal 2 + twin sea-channel bridges)
    pushBox(b, fB, 0, 195, -6.8, 4620, 1280, 6.8, [0.40, 0.42, 0.41], {
      topRgb: [0.21, 0.25, 0.19], surf: SURF.seawall, topSurf: SURF.turf, skipBottom: true,
    });
    pushRunway(b, fB, lenB, rwyB.width, 0, { approachLen: 680, overWater: true });
    pushTaxiway(b, fB, lenB + 200, 195, 0, [-1880, -1180, -380, 380, 1180, 1880], 0);
    pushStripTop(b, fB, 180, 485, 0.06, 1400, 360, [0.34, 0.35, 0.36], 0, SURF.concrete);
    pushBox(b, fB, 80, 540, 0, 425, 74, 12, [0.74, 0.76, 0.78], { topRgb: [0.80, 0.82, 0.84], emit: 0.46, glass: 0.55, surf: SURF.terminalGlass });
    pushBox(b, fB, 520, 540, 0, 285, 68, 12, [0.74, 0.76, 0.78], { topRgb: [0.80, 0.82, 0.84], emit: 0.44, glass: 0.55, surf: SURF.terminalGlass });
    pushApronFloodlight(b, fB, -60, 455, 22);
    pushApronFloodlight(b, fB, 220, 455, 22);
    pushApronFloodlight(b, fB, 520, 455, 22);
    // Twin connecting taxiway bridges spanning between Island 1 and Island 2
    pushBox(b, fA, -620, -1125, -2.5, 68, 380, 2.8, [0.36, 0.38, 0.40], { topSurf: SURF.asphalt });
    pushBox(b, fA, 620, -1125, -2.5, 68, 380, 2.8, [0.36, 0.38, 0.40], { topSurf: SURF.asphalt });

    // 3.75 km Sky Gate Bridge R (関西国際空港連絡橋)
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
    // Drape inland runways & lights seamlessly onto real surveyed terrain — ZERO ugly flat solid-green carpet!
    // The real high-resolution GSI aerial photograph provides natural grass, perimeter roads & apron markings.
    const { frame: f32L, length: len32L } = frameFromEndpoints(p0, p1, rwy32L.deckOffset, ground);
    const { frame: f32R, length: len32R } = frameFromEndpoints(q0, q1, rwy32R.deckOffset, ground);

    // Runway 32L/14R (exact 3,000 m surveyed — approach directly over 千里川土手!)
    // PAPI on SW side (-1) for 32L and NE/SW clean clearings
    pushRunway(b, f32L, len32L, rwy32L.width, 0, { approachLen: 460, papiSides: [-1, -1] });
    // Runway 32R/14L (exact 1,828 m surveyed — offset +307 m NE, extending NW to 14L!)
    pushRunway(b, f32R, len32R, rwy32R.width, 0, { approachLen: 260, papiSides: [-1, 1] });
    // Taxiway edge & centerline lights aligned along the real taxiways between 32L, 32R, and Terminal apron
    // (drawPavement=false lets the real GSI orthophoto taxiway markings shine crisply by day while lights sparkle at night!)
    pushTaxiway(b, f32L, len32L - 120, 145, 0, [-1350, -820, -250, 320, 880, 1380], 0, false);
    pushTaxiway(b, f32R, len32R - 80, 112, 0, [-780, -320, 180, 680], 0, false);

    // Sculpted Itami Terminal Complex (aligned to exact surveyed NE apron: across ~520..620 m from 32L)
    const termAcross = 545;
    const termGlass: RGB = [0.10, 0.17, 0.24];
    const termRoof: RGB = [0.76, 0.78, 0.80];
    // Central Block + La Sora Rooftop Observation Deck + sweeping curved roof
    pushBox(b, f32L, 125, termAcross, -1.2, 240, 88, 20.5, termGlass, {
      topRgb: [0.58, 0.60, 0.62], emit: 0.66, glass: 0.86, surf: SURF.terminalGlass, skipBottom: true,
    });
    pushCurvedRoof(b, f32L, 125, termAcross, 19.2, 232, 74, 4.8, 1.1, termRoof, 6);
    // North Wing (JAL, red accent) & South Wing (ANA, blue accent) + finger piers + 14 articulated jet bridges
    for (const [dir, accent] of [[-1, [0.06, 0.24, 0.62] as RGB], [1, [0.76, 0.12, 0.16] as RGB]] as const) {
      const wingCenter = 125 + dir * 255;
      pushBox(b, f32L, wingCenter, termAcross - 14, -1.2, 275, 56, 16.5, termGlass, {
        topRgb: termRoof, emit: 0.56, glass: 0.82, surf: SURF.terminalGlass, skipBottom: true,
      });
      // Airline wing roof fascia band
      pushBox(b, f32L, wingCenter, termAcross - 42, 13.4, 272, 2.0, 2.2, accent, { emit: 0.35 });
      // Boarding finger pier extending west toward 32R apron
      pushBox(b, f32L, 125 + dir * 305, termAcross - 88, -1.0, 32, 108, 12.2, [0.68, 0.71, 0.74], {
        emit: 0.44, glass: 0.65, surf: SURF.terminalGlass, skipBottom: true,
      });
      for (let g = 0; g < 6; g++) {
        const gs = 125 + dir * (135 + g * 44);
        pushBox(b, f32L, gs, termAcross - 58, 4.4, 5.2, 36, 3.8, [0.74, 0.76, 0.78], { emit: 0.34, glass: 0.45 });
        if (g % 2 === 0) pushApronFloodlight(b, f32L, gs, termAcross - 88, 22);
      }
    }
    // Forecourt multi-story parking & Osaka Monorail Itami Airport Station on east side of terminal
    pushBox(b, f32L, 125, termAcross + 96, -1.2, 360, 56, 15.5, [0.56, 0.58, 0.60], { emit: 0.32, glass: 0.35, skipBottom: true });
    // Itami ATC Control Tower at exact surveyed site (along +266, across +510)
    pushControlTower(b, f32L, 266, 510, 0, 50);
    // South ANA Maintenance Hangars (整備地区 — along -1140..-760, across ~400)
    pushMaintenanceHangar(b, f32L, -1120, 385, 165, 84, 22, -1, [0.06, 0.24, 0.62]);
    pushMaintenanceHangar(b, f32L, -885, 415, 155, 82, 21, -1, [0.06, 0.24, 0.62]);
    // North JAL Maintenance Hangars & Cargo Complex (along +960..+1360, across ~475)
    pushMaintenanceHangar(b, f32L, 960, 468, 165, 84, 22, -1, [0.76, 0.12, 0.16]);
    pushMaintenanceHangar(b, f32L, 1210, 478, 155, 80, 20, -1, [0.76, 0.12, 0.16]);
  }

  // =========================================================================
  // 3. 神戸空港 (Kobe Airport — UKB)
  // =========================================================================
  {
    const rwy = AIRPORT_RUNWAYS[4];
    const p0 = toLocal(rwy.start[0], rwy.start[1]), p1 = toLocal(rwy.end[0], rwy.end[1]);
    const { frame: fK, length: lenK } = frameFromEndpoints(p0, p1, rwy.deckOffset);

    // Reclaimed Airport Island seawall platform (textured mowed grass + riprap seawall + concrete apron)
    pushBox(b, fK, 0, -145, -6.4, 3180, 960, 6.4, [0.40, 0.42, 0.41], {
      topRgb: [0.22, 0.26, 0.20], surf: SURF.seawall, topSurf: SURF.turf, skipBottom: true,
    });
    pushStripTop(b, fK, -80, -340, 0.06, 1820, 310, [0.34, 0.35, 0.36], 0, SURF.concrete);

    // Runway 09/27 (exact 2,500 m surveyed) + over-water approach light piers at both ends
    pushRunway(b, fK, lenK, rwy.width, 0, { approachLen: 520, overWater: true });
    pushTaxiway(b, fK, lenK + 110, -155, 0, [-1160, -540, 0, 540, 1160], 0);

    // Kobe Airport Main Passenger Terminal + curved signature wave roof + jet bridges
    const termAcross = -435;
    pushBox(b, fK, 140, termAcross, 0, 295, 70, 16.5, [0.10, 0.18, 0.25], {
      topRgb: [0.76, 0.79, 0.82], emit: 0.62, glass: 0.86, surf: SURF.terminalGlass,
    });
    pushCurvedRoof(b, fK, 140, termAcross, 16.2, 312, 86, 6.4, 1.3, [0.78, 0.81, 0.84], 8);
    for (let g = -2; g <= 2; g++) {
      pushBox(b, fK, 140 + g * 54, termAcross + 54, 4.2, 5.2, 38, 3.8, [0.74, 0.76, 0.78], { emit: 0.34, glass: 0.45 });
    }
    pushApronFloodlight(b, fK, 30, termAcross + 92, 22);
    pushApronFloodlight(b, fK, 250, termAcross + 92, 22);
    // International Sub-Terminal (T2) west of main terminal
    pushBox(b, fK, -190, termAcross + 12, 0, 180, 60, 13.0, [0.68, 0.71, 0.74], {
      topRgb: [0.78, 0.80, 0.82], emit: 0.50, glass: 0.68, surf: SURF.terminalGlass,
    });
    // Kobe Airport ATC Control Tower
    pushControlTower(b, fK, 360, termAcross + 18, 0, 46);
    // West Helicopter & Business Jet Maintenance Hangars (Fire/Police/Coast Guard/Airbus Helicopters)
    pushMaintenanceHangar(b, fK, -940, termAcross + 28, 120, 60, 14.5, 1, [0.78, 0.18, 0.14]);
    pushMaintenanceHangar(b, fK, -770, termAcross + 28, 120, 60, 14.5, 1, [0.14, 0.38, 0.68]);
    pushMaintenanceHangar(b, fK, -595, termAcross + 28, 130, 62, 15.0, 1, [0.16, 0.48, 0.64]);
    // Port Liner station & parking decks north of terminal
    pushBox(b, fK, 140, termAcross - 92, 0, 265, 54, 12.5, [0.56, 0.58, 0.60], { emit: 0.32 });

    // 1.2 km Kobe Sky Bridge (神戸スカイブリッジ)
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

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(b.emit, 1));
  geo.setAttribute('aGlass', new THREE.Float32BufferAttribute(b.glass, 1));
  geo.setAttribute('aSurf', new THREE.Float32BufferAttribute(b.surf, 1));
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
      attribute float aSurf;
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vSurf;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vEmit = aEmit;
        vGlass = aGlass;
        vSurf = aSurf;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vSurf;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 baseCol = vColor;
        float sf = floor(vSurf + .5);
        vec2 p = vWorld.xz;
        float fp = max(length(dFdx(p)), length(dFdy(p)));
        float windowBand = 1.;

        if (sf == 1.) {
          // Grooved runway/taxiway asphalt: fine aggregate grain + subtle weathering patches
          float g1 = mix(.5, vnoise(p * .08), 1. - smoothstep(3., 14., fp));
          float g2 = mix(.5, vnoise(p * 1.15), 1. - smoothstep(.2, .85, fp * 1.15));
          baseCol *= .84 + .22 * g1 + .14 * g2;
        } else if (sf == 2.) {
          // Concrete apron: realistic expansion-joint slab grid (12 m bays) + gentle tyre/oil wear
          vec2 cell = fract(p / 12.);
          float edge = min(min(cell.x, 1. - cell.x), min(cell.y, 1. - cell.y));
          float seamFade = 1. - smoothstep(.35, 1.8, fp / 12. * 14.);
          float seam = 1. - smoothstep(0., .035, edge) * seamFade * .16;
          float stain = mix(.5, vnoise(p * .035), 1. - smoothstep(4., 18., fp));
          baseCol *= (.86 + .24 * stain) * seam;
        } else if (sf == 3.) {
          // Reclaimed airport island mowed coastal grass/turf: multi-octave organic greens & mowing strips
          float broad = vnoise(p * .014 + 3.1);
          float med = mix(.5, vnoise(p * .065 + 11.7), 1. - smoothstep(2.5, 14., fp));
          float fine = mix(.5, vnoise(p * .35), 1. - smoothstep(.4, 2.2, fp));
          float stripe = .5 + .5 * sin((p.x * .6 + p.y * .8) * .18) * (1. - smoothstep(2., 10., fp));
          vec3 dryGrass = vec3(.24, .25, .17);
          vec3 lushGrass = vec3(.14, .22, .12);
          baseCol = mix(lushGrass, dryGrass, broad * .65 + .2 * med) * (.82 + .22 * fine + .07 * stripe);
        } else if (sf == 4.) {
          // Coastal seawall concrete / riprap block texture
          float blk = mix(.5, vnoise(vec2(p.x + p.y, vWorld.y * 2.2) * .45), 1. - smoothstep(.5, 3., fp));
          baseCol *= .78 + .42 * blk;
        } else if (sf == 5.) {
          // Architectural terminal glass curtain wall: linear deep glazing + vertical mullions + spandrels
          float along = abs(n.x) > abs(n.z) ? p.y : p.x;
          float fy = fract(vWorld.y / 4.2);
          float fx = fract(along / 3.4);
          float spandrel = smoothstep(.12, .22, fy) * (1. - smoothstep(.84, .92, fy));
          float mullion = smoothstep(.04, .10, fx) * (1. - smoothstep(.90, .96, fx));
          windowBand = mix(.35, .95, spandrel * mullion);
          baseCol = mix(vec3(.20, .22, .25), pow(baseCol, vec3(2.0)), windowBand);
        } else if (sf == 6.) {
          // Corrugated steel hangar cladding & roof ribs in calibrated linear reflectance
          float rib = .5 + .5 * sin((p.x + p.y) * 1.4) * (1. - smoothstep(.4, 2.5, fp));
          baseCol = pow(baseCol, vec3(1.9)) * (.86 + .18 * rib);
        }

        vec3 lit = shade(seasonalSurface(baseCol, n, vWorld), n, vWorld, 1.);
        if (vGlass > .05) {
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 r = reflect(v, n);
          r.y = clamp(r.y + .06, -.05, 1.);
          vec3 rn = normalize(r);
          float fres = .08 + .32 * pow(1. - clamp(dot(-v, n), 0., 1.), 3.4);
          lit += skyColor(rn) * fres * vGlass * windowBand;
          lit += uSunLight * pow(max(dot(rn, uSunDir), 0.), 52.) * .42 * vGlass * windowBand;
        }
        vec3 emitCol = mix(vec3(1., .82, .56), vec3(.72, .86, 1.), vGlass * .45);
        vec3 emit = emitCol * vEmit * (.20 + .22 * windowBand) * uCity;
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), 1.);
      }
    `,
  });
  const solidMesh = new THREE.Mesh(geo, mat);
  solidMesh.name = 'kansai-airports-structures';
  solidMesh.frustumCulled = false;
  group.add(solidMesh);

  // Crisp, vivid additive airfield lighting points (runway edge/centerline/TDZ, PAPI, ALSF-II, taxiways, floodlights)
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
        // Brilliant at dusk & night so all three airports sparkle like jewel-lit airfields from afar.
        float nightGain = smoothstep(.03, .38, uCity);
        float pulse = 1.;
        if (aPhase >= 2.9) {
          // Sequenced ALSF-II rabbit strobe sweeping rapidly toward threshold
          float wave = fract(uTime * 2.0 - (aPhase - 3.0));
          pulse = smoothstep(.0, .06, wave) * (1. - smoothstep(.06, .18, wave)) * 2.8;
          nightGain = max(nightGain, .42);
        } else if (aPhase >= 1.9) {
          // Rotating green/white aerodrome beacon atop control tower
          pulse = .38 + 1.65 * pow(max(0., sin(uTime * 2.1)), 5.);
          nightGain = max(nightGain, .30);
        } else if (aPhase >= 0.9) {
          // Red obstruction beacon pulse
          pulse = .45 + 1.10 * smoothstep(.15, .85, sin(uTime * 3.1));
          nightGain = max(nightGain, .25);
        } else if (aPhase >= 0.4) {
          // PAPI remains distinctly visible even in overcast/daytime final approach!
          nightGain = max(nightGain, .45);
        }
        vColor = aColor * (.52 + .58 * nightGain);
        vAlpha = nightGain * pulse * (1. - smoothstep(18000., 38000., dist));
        gl_PointSize = clamp(aSize * 460. / dist + 1.3, 1.8, 7.8);
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
        float core = exp(-r2 * 24.) + .22 * exp(-r2 * 7.);
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
