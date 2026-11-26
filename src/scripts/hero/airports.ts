import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { toLocal } from './geo';
import { AIRPORT_RUNWAYS, ATC_TOWERS, HELIPADS } from './airports-data';
export { AIRPORT_RUNWAYS, ATC_TOWERS, HELIPADS, inAirportBuildingMask, type AtcTowerSpec, type RunwaySpec, type HelipadSpec } from './airports-data';

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
  glowPos: number[];
  glowUv: number[];
  glowCol: number[];
}

function createBuilder(): MeshBuilder {
  return {
    pos: [], nrm: [], col: [], emit: [], glass: [], surf: [],
    lightPos: [], lightCol: [], lightSize: [], lightPhase: [],
    glowPos: [], glowUv: [], glowCol: [],
  };
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

/** Add a soft radial floodlight pool illuminating terminal gates, aprons and roadways at night. */
function pushApronGlow(
  b: MeshBuilder,
  f: LocalFrame,
  along: number,
  across: number,
  len: number,
  wid: number,
  rgb: RGB,
  yOff = 0.55,
) {
  const hl = len * 0.5, hw = wid * 0.5;
  const p0 = toWorld(f, along - hl, across - hw, yOff);
  const p1 = toWorld(f, along - hl, across + hw, yOff);
  const p2 = toWorld(f, along + hl, across + hw, yOff);
  const p3 = toWorld(f, along + hl, across - hw, yOff);
  const uvs: [number, number][] = [[-1, -1], [-1, 1], [1, 1], [-1, -1], [1, 1], [1, -1]];
  const verts = [p0, p1, p2, p0, p2, p3];
  for (let i = 0; i < 6; i++) {
    b.glowPos.push(verts[i][0], verts[i][1], verts[i][2]);
    b.glowUv.push(uvs[i][0], uvs[i][1]);
    b.glowCol.push(rgb[0], rgb[1], rgb[2]);
  }
}

/** Build an authentic Air Traffic Control Tower (podium + ribbed shaft + equipment gallery + flared glazed cab + radome + beacons). */
function pushControlTower(b: MeshBuilder, f: LocalFrame, along: number, across: number, baseY: number, height: number) {
  const concrete: RGB = [0.68, 0.70, 0.72];
  const trimDark: RGB = [0.36, 0.39, 0.42];
  const cabGlass: RGB = [0.06, 0.14, 0.20];
  const roofWhite: RGB = [0.84, 0.86, 0.88];
  // Operations base podium with glazed windows
  pushBox(b, f, along, across, baseY - 1.5, 34, 28, Math.min(14, height * 0.24) + 1.5, [0.56, 0.59, 0.62], {
    emit: 0.46, glass: 0.58, surf: SURF.terminalGlass, skipBottom: true,
  });
  // Fluted vertical concrete shaft with vertical dark service core strips
  const shaftH = height - 11.5;
  pushBox(b, f, along, across, baseY, 12.5, 12.5, shaftH, concrete, { skipBottom: true });
  pushBox(b, f, along, across, baseY, 13.6, 5.2, shaftH - 2, trimDark, { skipBottom: true });
  pushBox(b, f, along, across, baseY, 5.2, 13.6, shaftH - 2, trimDark, { skipBottom: true });
  // Cantilevered equipment & radar gallery below cab
  pushBox(b, f, along, across, baseY + shaftH - 3.2, 17.5, 17.5, 3.2, trimDark, { emit: 0.24 });
  pushBox(b, f, along, across, baseY + shaftH, 19.5, 19.5, 1.4, concrete);
  // Flared panoramic glazed ATC control cab (bright warm-cyan instrument room glow at night!)
  pushBox(b, f, along, across, baseY + shaftH + 1.4, 20.5, 20.5, 6.4, cabGlass, {
    emit: 1.0, glass: 0.96, surf: SURF.terminalGlass, topRgb: roofWhite,
  });
  // Overhanging sun-visor roof + upper antenna deck + white ASR radome
  pushBox(b, f, along, across, baseY + shaftH + 7.8, 24.0, 24.0, 1.8, roofWhite, { emit: 0.22 });
  pushBox(b, f, along, across, baseY + shaftH + 9.6, 8.2, 8.2, 4.8, [0.86, 0.88, 0.90]);
  pushBox(b, f, along, across, baseY + shaftH + 14.4, 0.8, 0.8, 5.5, [0.80, 0.24, 0.20]);
  // Restrained red aviation obstruction beacon + vivid rotating emerald/white airport aerodrome beacon
  const anchorY = baseYAt(f, along, across) + baseY;
  addLight(b, toWorldFixedY(f, along, across, anchorY + shaftH + 20.2), [1.0, 0.10, 0.06], 4.6, 1.0);
  addLight(b, toWorldFixedY(f, along + 7, across, anchorY + shaftH + 11.2), [0.16, 1.0, 0.46], 7.4, 2.0);
}

/** Build a tall apron floodlight mast illuminating terminal gates & stands at night. */
function pushApronFloodlight(
  b: MeshBuilder,
  f: LocalFrame,
  along: number,
  across: number,
  height = 24,
  lampCol: RGB = [1.0, 0.90, 0.72],
  glowRadius = 115,
) {
  pushBox(b, f, along, across, -0.6, 1.2, 1.2, height + 0.6, [0.58, 0.60, 0.62], { skipBottom: true });
  pushBox(b, f, along, across, height - 0.8, 5.8, 1.8, 1.5, [0.90, 0.92, 0.94], { emit: 1.0 });
  const anchorY = baseYAt(f, along, across);
  addLight(b, toWorldFixedY(f, along, across, anchorY + height + 0.8), lampCol, 6.8, 0);
  if (glowRadius > 0) {
    pushApronGlow(b, f, along, across, glowRadius * 2, glowRadius * 2, [lampCol[0] * 0.42, lampCol[1] * 0.40, lampCol[2] * 0.36], 0.55);
  }
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

  // 1. Bright Runway Edge Lights (REDL every 45 m: crisp warm-white, switching to vivid golden amber in final 600 m!)
  const edgeStep = 45;
  for (let s = -halfL; s <= halfL; s += edgeStep) {
    const nearEnd = halfL - Math.abs(s) < 600;
    const edgeRgb: RGB = nearEnd ? [1.0, 0.66, 0.10] : [1.0, 0.96, 0.86];
    for (const side of [-1, 1]) {
      addLight(b, toWorld(f, s, side * (halfW + 2.6), y + 1.15), edgeRgb, nearEnd ? 4.9 : 4.5, 0);
    }
  }
  // 2. Dense Runway Centerline Lights (RCL every 30 m: white -> alternating ruby-red/white last 900 m -> ruby-red last 300 m)
  const clStep = 30;
  let clIdx = 0;
  for (let s = -halfL + 30; s <= halfL - 30; s += clStep, clIdx++) {
    const distFromEnd = halfL - Math.abs(s);
    const clRgb: RGB = distFromEnd < 300
      ? [1.0, 0.10, 0.06]
      : (distFromEnd < 900 && clIdx % 2 === 1) ? [1.0, 0.14, 0.08] : [0.98, 0.98, 0.94];
    addLight(b, toWorld(f, s, 0, y + 0.95), clRgb, 3.4, 0);
  }

  // 3. Vivid emerald threshold wing bars + ruby end lights + TDZ bars + ICAO PAPI + ALSF-II Approach Lights
  const approachLen = opts?.approachLen ?? 540;
  const papiSideStart = opts?.papiSides?.[0] ?? -1; // default pilot's LEFT side when landing from start (dir=-1 -> -rx)
  const papiSideEnd = opts?.papiSides?.[1] ?? 1;    // default pilot's LEFT side when landing from end (dir=+1 -> +rx)
  for (const dir of [-1, 1] as const) {
    // Threshold vivid emerald-green wing bars + ruby-red end lights
    for (let k = -6; k <= 6; k++) {
      addLight(b, toWorld(f, dir * halfL, k * (width / 11.5), y + 1.25), [0.06, 1.0, 0.36], 5.3, 0);
      if (Math.abs(k) <= 4) {
        addLight(b, toWorld(f, dir * (halfL + 5), k * (width / 8.5), y + 1.15), [1.0, 0.08, 0.05], 4.3, 0);
      }
    }
    // Touchdown zone (TDZ) twin white light bars for first 650 m past threshold
    for (let d = 80; d <= Math.min(640, halfL - 150); d += 80) {
      for (const side of [-1, 1]) {
        addLight(b, toWorld(f, dir * (halfL - d), side * (halfW * 0.30), y + 0.95), [1.0, 0.97, 0.90], 3.3, 0);
      }
    }
    // ICAO/JCAB PAPI (4 light units perpendicular to runway, 16 m OUTSIDE runway edge, abeam aiming point 340 m past threshold!)
    // Inner 2 lights (closest to runway, p=0,1) = RUBY RED; Outer 2 lights (farthest from runway, p=2,3) = WHITE.
    const papiSide = dir === -1 ? papiSideStart : papiSideEnd;
    const papiAlong = dir * (halfL - 340);
    for (let p = 0; p < 4; p++) {
      const across = papiSide * (halfW + 16 + p * 7.5);
      pushBox(b, f, papiAlong, across, y, 2.2, 2.8, 1.1, [0.18, 0.19, 0.20]);
      const papiCol: RGB = p < 2 ? [1.0, 0.08, 0.05] : [1.0, 0.98, 0.90];
      addLight(b, toWorld(f, papiAlong, across, y + 1.45), papiCol, 5.6, 0.5);
    }

    // Approach Lighting System (ALSF-II): warm-white centerline barrettes + 300 m decision crossbar + vivid red side bars + cyan-white rabbit strobes
    if (opts?.overWater) {
      pushBox(b, f, dir * (halfL + approachLen * 0.5 + 26), 0, y - 3.6, approachLen, 8.5, 3.8, [0.42, 0.44, 0.46]);
    }
    for (let d = 50; d <= approachLen; d += 45) {
      const isCrossbar = Math.abs(d - 280) < 28;
      const span = isCrossbar ? 6 : 1;
      for (let k = -span; k <= span; k++) {
        addLight(b, toWorld(f, dir * (halfL + d), k * 4.5, y + 1.8), [1.0, 0.94, 0.80], isCrossbar ? 5.2 : 4.5, 0);
      }
      // Vivid ruby-red side-row barrettes in inner 275 m (ALSF-II signature!)
      if (d <= 275) {
        for (const side of [-1, 1]) {
          addLight(b, toWorld(f, dir * (halfL + d), side * (halfW * 0.36), y + 1.7), [1.0, 0.09, 0.06], 4.5, 0);
        }
      }
      // Sequenced flashing cyan-white rabbit strobe sweeping cleanly toward threshold!
      addLight(b, toWorld(f, dir * (halfL + d), 0, y + 2.4), [0.80, 0.96, 1.0], 7.2, 3.0 + (approachLen - d) / approachLen);
    }
  }
}

/** Build a parallel taxiway with dense sapphire-blue edge lights, emerald-green centerlines, and alternating amber wig-wag runway guard lights. */
function pushTaxiway(
  b: MeshBuilder,
  f: LocalFrame,
  length: number,
  across: number,
  y: number,
  connectors: number[],
  runwayAcross = 0,
  drawPavement = true,
  wigwags = true,
) {
  const taxiAsphalt: RGB = [0.128, 0.133, 0.142];
  const yellow: RGB = [0.78, 0.64, 0.16];
  if (drawPavement) {
    pushStripTop(b, f, 0, across, y + 0.09, length, 23, taxiAsphalt, 0, SURF.asphalt);
    pushStripTop(b, f, 0, across, y + 0.15, length - 10, 0.85, yellow);
  }
  const halfL = length * 0.5;
  // Dense cobalt/sapphire-blue taxiway edge ribbons (every 38 m)
  for (let s = -halfL; s <= halfL; s += 38) {
    for (const side of [-1, 1]) {
      addLight(b, toWorld(f, s, across + side * 12.5, y + 0.95), [0.08, 0.44, 1.0], 4.0, 0);
    }
  }
  // Vivid emerald-green taxiway centerline lights (every 32 m)
  for (let s = -halfL; s <= halfL; s += 32) {
    addLight(b, toWorld(f, s, across, y + 0.85), [0.06, 1.0, 0.38], 3.2, 0);
  }
  const midAcross = (across + runwayAcross) * 0.5;
  const spanAcross = Math.abs(across - runwayAcross);
  const signToTaxi = across >= runwayAcross ? 1 : -1;
  for (const s of connectors) {
    if (drawPavement) {
      pushStripTop(b, f, s, midAcross, y + 0.08, 25, spanAcross, taxiAsphalt, 0, SURF.asphalt);
      pushStripTop(b, f, s, midAcross, y + 0.14, 0.8, spanAcross - 12, yellow);
    }
    const steps = Math.max(3, Math.round(spanAcross / 28));
    for (let k = 1; k < steps; k++) {
      const a = runwayAcross + ((across - runwayAcross) * k) / steps;
      // Alternating green/yellow lead-off centerline near runway exit (ICAO standard!)
      const leadRgb: RGB = k <= 2 ? (k % 2 === 1 ? [0.08, 1.0, 0.38] : [1.0, 0.78, 0.10]) : [0.06, 1.0, 0.38];
      addLight(b, toWorld(f, s, a, y + 0.85), leadRgb, 3.1, 0);
      if (k % 2 === 0) {
        addLight(b, toWorld(f, s - 12, a, y + 0.95), [0.08, 0.44, 1.0], 3.7, 0);
        addLight(b, toWorld(f, s + 12, a, y + 0.95), [0.08, 0.44, 1.0], 3.7, 0);
      }
    }
    // Runway Guard Lights ("wig-wags" — alternating flashing golden amber) + red stop bar at runway holding point
    if (wigwags && Math.abs(runwayAcross) < 1) {
      const holdAcross = runwayAcross + signToTaxi * 68;
      addLight(b, toWorld(f, s - 14, holdAcross, y + 1.3), [1.0, 0.68, 0.06], 4.6, 4.0);
      addLight(b, toWorld(f, s + 14, holdAcross, y + 1.3), [1.0, 0.68, 0.06], 4.6, 4.5);
      for (const rx of [-7, 0, 7]) {
        addLight(b, toWorld(f, s + rx, holdAcross, y + 0.9), [1.0, 0.10, 0.06], 3.2, 0);
      }
    }
  }
}

/** Build a straight or gently curved sea bridge connecting an offshore airport island to land. */
function pushAccessBridge(
  b: MeshBuilder,
  startLatLon: [number, number],
  endLatLon: [number, number],
  baseY: number,
  width: number,
  peakH: number,
  piers: number,
  truss = false,
  midLatLon?: [number, number],
) {
  const a = toLocal(startLatLon[0], startLatLon[1]);
  const c = toLocal(endLatLon[0], endLatLon[1]);
  const m = midLatLon
    ? toLocal(midLatLon[0], midLatLon[1])
    : { x: (a.x + c.x) * 0.5, z: (a.z + c.z) * 0.5 };
  const evalXZ = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * m.x + t * t * c.x,
      z: u * u * a.z + 2 * u * t * m.z + t * t * c.z,
    };
  };
  const approxLen = Math.hypot(m.x - a.x, m.z - a.z) + Math.hypot(c.x - m.x, c.z - m.z);
  const steps = Math.max(18, Math.round(approxLen / 120));
  const deckCol: RGB = [0.20, 0.21, 0.22];
  const trussCol: RGB = [0.54, 0.58, 0.62];
  const pierCol: RGB = [0.46, 0.47, 0.46];
  const yAt = (t: number) => {
    const endFade = Math.sin(Math.min(1, t / 0.12) * Math.PI * 0.5) * Math.sin(Math.min(1, (1 - t) / 0.12) * Math.PI * 0.5);
    const u = (t - 0.5) / 0.28;
    return 3.6 + (11.0 - 3.6) * endFade + (peakH - 11.0) * Math.exp(-u * u * 1.4);
  };
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps, tm = (t0 + t1) * 0.5;
    const p0 = evalXZ(t0), p1 = evalXZ(t1);
    const { frame, length: segBaseLen } = frameFromEndpoints(p0, p1, baseY);
    const ym = yAt(tm);
    const segLen = segBaseLen + 2.2;
    pushBox(b, frame, 0, 0, ym - 2.4, segLen, width, 2.6, deckCol, { topRgb: deckCol, topSurf: SURF.asphalt });
    if (truss) {
      pushBox(b, frame, 0, 0, ym - 7.8, segLen, width * 0.72, 5.4, trussCol, { skipBottom: true });
    }
    for (const side of [-1, 1]) {
      pushBox(b, frame, 0, side * (width * 0.5 - 0.7), ym + 0.2, segLen, 1.2, 1.4, [0.66, 0.68, 0.70]);
      // Warm golden roadway lamps along both parapets of Sky Gate Bridge R & Kobe Sky Bridge
      addLight(b, toWorldFixedY(frame, 0, side * (width * 0.44), baseY + ym + 4.8), [1.0, 0.80, 0.40], 4.2, 0);
    }
    if (i % 3 === 0) {
      pushApronGlow(b, frame, 0, 0, segLen * 1.6, width * 1.4, [0.52, 0.40, 0.20], ym + 0.5);
    }
  }
  for (let i = 1; i < piers; i++) {
    const t = i / piers;
    const p0 = evalXZ(Math.max(0, t - 0.01)), p1 = evalXZ(Math.min(1, t + 0.01));
    const { frame } = frameFromEndpoints(p0, p1, baseY);
    const pm = evalXZ(t);
    frame.cx = pm.x;
    frame.cz = pm.z;
    const ym = yAt(t);
    pushBox(b, frame, 0, 0, -4, 7.5, width * 0.55, ym + (truss ? -3.5 : 1.8), pierCol);
  }
}

/** Place an ATC Control Tower directly at a surveyed geographic coordinate. */
function pushWorldControlTower(b: MeshBuilder, lat: number, lon: number, height: number, ground: GroundFn, minGround = 0) {
  const p = toLocal(lat, lon);
  const y = Math.max(minGround, ground(p.x, p.z));
  const f: LocalFrame = { cx: p.x, cy: y, cz: p.z, ux: 1, uz: 0, rx: 0, rz: 1 };
  pushControlTower(b, f, 0, 0, 0, height);
}

/** Place an apron floodlight mast directly at a surveyed geographic coordinate. */
function pushWorldApronLight(
  b: MeshBuilder,
  lat: number,
  lon: number,
  ground: GroundFn,
  height = 24,
  minGround = 0,
  lampCol: RGB = [1.0, 0.88, 0.64],
  glowRadius = 115,
) {
  const p = toLocal(lat, lon);
  const y = Math.max(minGround, ground(p.x, p.z));
  const f: LocalFrame = { cx: p.x, cy: y, cz: p.z, ux: 1, uz: 0, rx: 0, rz: 1 };
  pushApronFloodlight(b, f, 0, 0, height, lampCol, glowRadius);
}

/** Build a marked helicopter pad (asphalt pad + bold yellow 'H' + crisp green perimeter lights). */
function pushHelipad(b: MeshBuilder, lat: number, lon: number, ground: GroundFn, deckOffset: number) {
  const p = toLocal(lat, lon);
  const y = Math.max(0.5, ground(p.x, p.z)) + deckOffset;
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
 * Build terrain-draped runways, full-spectrum ICAO airfield lighting (edge/centerline/PAPI/ALSF-II),
 * surveyed ATC control towers, apron floodlights, and offshore access bridges for KIX, Itami (ITM),
 * and Kobe Airport (UKB). Real GSI aerial orthophotos and surveyed GSI/PLATEAU buildings render the
 * islands, aprons, terminals, finger piers, rail stations and hangars directly at 0 m offset.
 */
export function buildKansaiAirports(env: Env, ground: GroundFn): THREE.Group {
  const b = createBuilder();
  const islandGround: GroundFn = (x, z) => Math.max(0.5, ground(x, z));

  // =========================================================================
  // 1. 関西国際空港 (Kansai International Airport — KIX)
  // =========================================================================
  {
    const rwyA = AIRPORT_RUNWAYS[0];
    const rwyB = AIRPORT_RUNWAYS[1];
    const a0 = toLocal(rwyA.start[0], rwyA.start[1]), a1 = toLocal(rwyA.end[0], rwyA.end[1]);
    const b0 = toLocal(rwyB.start[0], rwyB.start[1]), b1 = toLocal(rwyB.end[0], rwyB.end[1]);
    const { frame: fA, length: lenA } = frameFromEndpoints(a0, a1, rwyA.deckOffset, islandGround);
    const { frame: fB, length: lenB } = frameFromEndpoints(b0, b1, rwyB.deckOffset, islandGround);

    // Island 1 — Runway A (06R/24L) + parallel & apron taxiway blue/green lighting over real GSI orthophoto
    pushRunway(b, fA, lenA, rwyA.width, 0, { approachLen: 680, overWater: true });
    pushTaxiway(b, fA, lenA + 180, -190, 0, [-1520, -960, -400, 160, 720, 1320], 0, false, true);
    pushTaxiway(b, fA, lenA - 140, -268, 0, [-1140, -400, 420, 1180], -190, false, false);
    // Terminal 1 SE & NW airside apron taxi lanes + cross-island taxiway bridges into Island 2!
    pushTaxiway(b, fA, 2850, -370, 0, [-1280, -680, 0, 680, 1280], -268, false, false);
    pushTaxiway(b, fA, 2200, -860, 0, [-980, 980], -370, false, false);
    // Cross-channel connecting taxiways linking Island 1 and Island 2 (glowing blue/green over the sea channel!)
    for (const sBridge of [-1020, 1040]) {
      for (let a = -900; a >= -1320; a -= 35) {
        addLight(b, toWorld(fA, sBridge, a, 1.0), [0.06, 1.0, 0.38], 3.2, 0);
        addLight(b, toWorld(fA, sBridge - 14, a, 1.1), [0.08, 0.44, 1.0], 3.9, 0);
        addLight(b, toWorld(fA, sBridge + 14, a, 1.1), [0.08, 0.44, 1.0], 3.9, 0);
      }
    }

    // Island 2 — Runway B (06L/24R) + parallel & Terminal 2 apron taxiways
    pushRunway(b, fB, lenB, rwyB.width, 0, { approachLen: 680, overWater: true });
    pushTaxiway(b, fB, lenB + 160, 195, 0, [-1820, -1120, -360, 360, 1120, 1820], 0, false, true);
    pushTaxiway(b, fB, 2400, 340, 0, [-950, -250, 450, 1050], 195, false, false);

    // Rich warm-sodium & cool-LED apron floodlights + ground light pools illuminating KIX Terminal 1 (1.7 km!),
    // Aeroplaza/KIX Station, Cargo SW/NE aprons, and Terminal 2 so night KIX gleams vividly across Osaka Bay!
    const kixWarm: RGB = [1.0, 0.84, 0.48];
    const kixCool: RGB = [0.86, 0.94, 1.0];
    for (let s = -860; s <= 860; s += 145) {
      const col = Math.abs(s) < 260 ? kixCool : kixWarm;
      // SE Airside gate stands (facing Runway A)
      pushApronFloodlight(b, fA, s, -520, 26, col, 130);
      // NW Airside stands + landside Aeroplaza/Station loop
      pushApronFloodlight(b, fA, s, -780, 26, s % 290 === 0 ? kixCool : kixWarm, 130);
    }
    // Broad luminous apron wash along KIX T1 Main Building & both 1.7 km wings + KIX Station concourse
    pushApronGlow(b, fA, 0, -640, 1850, 420, [0.52, 0.46, 0.34], 0.65);
    pushApronGlow(b, fA, 40, -760, 680, 280, [0.46, 0.56, 0.68], 0.72);
    // SW & NE International Cargo aprons on Island 1
    for (const s of [-1380, -1160, 1120, 1340, 1520]) {
      pushApronFloodlight(b, fA, s, -540, 24, kixWarm, 125);
      pushApronFloodlight(b, fA, s, -760, 24, kixWarm, 115);
    }
    // KIX Terminal 2 & LCC apron stands on Island 2
    for (let s = -460; s <= 940; s += 175) {
      pushApronFloodlight(b, fB, s, 460, 23, s % 350 === 0 ? kixCool : kixWarm, 125);
      pushApronFloodlight(b, fB, s, 610, 23, kixWarm, 110);
    }
    pushApronGlow(b, fB, 240, 520, 1520, 320, [0.48, 0.45, 0.36], 0.65);

    // 3.75 km Sky Gate Bridge R (関西国際空港連絡橋) — aligned to exact GSI RailCL / orthophoto span
    pushAccessBridge(b, [34.4376, 135.2636], [34.4138, 135.2948], 0, 30, 29, 28, true);
  }

  // =========================================================================
  // 2. 大阪国際空港・伊丹空港 (Itami Airport — ITM)
  // =========================================================================
  {
    const rwy32L = AIRPORT_RUNWAYS[2];
    const rwy32R = AIRPORT_RUNWAYS[3];
    const p0 = toLocal(rwy32L.start[0], rwy32L.start[1]), p1 = toLocal(rwy32L.end[0], rwy32L.end[1]);
    const q0 = toLocal(rwy32R.start[0], rwy32R.start[1]), q1 = toLocal(rwy32R.end[0], rwy32R.end[1]);
    const { frame: f32L, length: len32L } = frameFromEndpoints(p0, p1, rwy32L.deckOffset, ground);
    const { frame: f32R, length: len32R } = frameFromEndpoints(q0, q1, rwy32R.deckOffset, ground);

    // Runway 32L/14R (3,000 m, approach right over 千里川土手) & Runway 32R/14L (1,828 m)
    pushRunway(b, f32L, len32L, rwy32L.width, 0, { approachLen: 460, papiSides: [-1, -1] });
    pushRunway(b, f32R, len32R, rwy32R.width, 0, { approachLen: 260, papiSides: [-1, 1] });
    // Vibrant blue/green/amber taxiway ribbons aligned along real GSI orthophoto taxiways
    pushTaxiway(b, f32L, len32L - 120, 145, 0, [-1350, -820, -250, 320, 880, 1380], 0, false, true);
    pushTaxiway(b, f32R, len32R - 80, 135, 0, [-760, -300, 180, 680], 0, false, true);

    // Apron floodlight masts & warm/LED light pools illuminating Itami Terminal fingers & hangar aprons at night
    const itmWarm: RGB = [1.0, 0.85, 0.52];
    const itmCool: RGB = [0.88, 0.95, 1.0];
    const itmApronLights: [number, number, RGB][] = [
      [34.7852, 135.4444, itmWarm], [34.7867, 135.4426, itmCool], [34.7882, 135.4414, itmWarm],
      [34.7897, 135.4401, itmCool], [34.7912, 135.4388, itmWarm], [34.7926, 135.4374, itmCool],
      [34.7940, 135.4358, itmWarm], [34.7834, 135.4462, itmWarm],
    ];
    for (const [lat, lon, col] of itmApronLights) {
      pushWorldApronLight(b, lat, lon, ground, 22, 0, col, 105);
    }
    pushApronGlow(b, f32R, 40, 290, 1180, 260, [0.46, 0.42, 0.34], 0.6);
  }

  // =========================================================================
  // 3. 神戸空港 (Kobe Airport — UKB)
  // =========================================================================
  {
    const rwy = AIRPORT_RUNWAYS[4];
    const p0 = toLocal(rwy.start[0], rwy.start[1]), p1 = toLocal(rwy.end[0], rwy.end[1]);
    const { frame: fK, length: lenK } = frameFromEndpoints(p0, p1, rwy.deckOffset, islandGround);

    // Runway 09/27 (2,500 m) draped over real Kobe Airport island + over-water approach light piers
    pushRunway(b, fK, lenK, rwy.width, 0, { approachLen: 520, overWater: true });
    pushTaxiway(b, fK, lenK + 90, -155, 0, [-1120, -520, 0, 520, 1120], 0, false, true);
    pushTaxiway(b, fK, 1450, -250, 0, [-520, 0, 520], -155, false, false);

    // Apron floodlight masts & luminous gate wash along Kobe Airport Terminal & west heliport aprons
    const kobeWarm: RGB = [1.0, 0.85, 0.52];
    const kobeCool: RGB = [0.86, 0.94, 1.0];
    for (const [lat, lon, col] of [
      [34.6359, 135.2248, kobeWarm], [34.6361, 135.2268, kobeCool], [34.6362, 135.2287, kobeWarm],
      [34.6363, 135.2305, kobeCool], [34.6352, 135.2188, kobeWarm], [34.6349, 135.2158, kobeWarm],
    ] as [number, number, RGB][]) {
      pushWorldApronLight(b, lat, lon, ground, 21, 0.5, col, 105);
    }
    pushApronGlow(b, fK, 320, -320, 880, 220, [0.44, 0.44, 0.38], 0.6);

    // 1.2 km Kobe Sky Bridge (神戸スカイブリッジ) — curved cleanly along the real Port Island -> Airport span
    pushAccessBridge(b, [34.6396, 135.2328], [34.6514, 135.2279], 0, 24, 24, 14, false, [34.6458, 135.2320]);
  }

  // =========================================================================
  // 4. Surveyed ATC Control Towers (KIX 86 m, Itami 50 m, Kobe 46 m)
  // =========================================================================
  for (const tower of ATC_TOWERS) {
    pushWorldControlTower(b, tower.lat, tower.lon, tower.height, ground, tower.id === 'itami' ? 0 : 0.5);
  }

  // =========================================================================
  // 5. Marked Helipads (Kobe Airport, Itami, Maishima, Kyoto)
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

  // Smooth additive radial apron floodlight pools illuminating KIX, Itami and Kobe concrete gates at night
  if (b.glowPos.length) {
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.glowPos, 3));
    glowGeo.setAttribute('aUv', new THREE.Float32BufferAttribute(b.glowUv, 2));
    glowGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.glowCol, 3));
    glowGeo.computeBoundingSphere();
    const glowMat = new THREE.ShaderMaterial({
      uniforms: env,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      vertexShader: /* glsl */ `
        attribute vec2 aUv;
        attribute vec3 aColor;
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.);
          vWorld = wp.xyz;
          vUv = aUv;
          vColor = aColor;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vWorld;
        void main(){
          float r2 = dot(vUv, vUv);
          if (r2 > 1.) discard;
          float falloff = exp(-r2 * 3.1) * (1. - smoothstep(.62, 1., r2));
          float night = smoothstep(.04, .42, uCity);
          float dist = length(vWorld - cameraPosition);
          float distFade = 1. - smoothstep(14000., 32000., dist);
          vec3 col = vColor * falloff * night * distFade * .44;
          gl_FragColor = vec4(col, 1.);
        }
      `,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.name = 'kansai-airports-apron-glow';
    glowMesh.frustumCulled = false;
    group.add(glowMesh);
  }

  // Crisp, vivid jewel-colored additive airfield lighting points (runway edge/centerline/TDZ, PAPI, ALSF-II, taxiways, wig-wags, floodlights)
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
        // Vivid jewel-colored airfield optics across dusk & night.
        float nightGain = smoothstep(.02, .34, uCity);
        float pulse = 1.;
        float maxDist0 = 18000., maxDist1 = 40000.;
        if (aPhase >= 3.9) {
          // Runway Guard Lights ("wig-wags"): crisp alternating golden-amber flash at taxiway holding points
          pulse = .22 + 1.38 * smoothstep(-.1, .55, sin(uTime * 5.2 + (aPhase - 4.0) * 6.28318));
          nightGain = max(nightGain, .32);
        } else if (aPhase >= 2.9) {
          // Sequenced ALSF-II cyan-white rabbit strobe sweeping rapidly toward threshold
          float wave = fract(uTime * 2.1 - (aPhase - 3.0));
          pulse = smoothstep(.0, .06, wave) * (1. - smoothstep(.06, .18, wave)) * 3.1;
          nightGain = max(nightGain, .45);
        } else if (aPhase >= 1.9) {
          // Rotating emerald/white aerodrome beacon atop control tower
          pulse = .42 + 1.75 * pow(max(0., sin(uTime * 2.1)), 4.5);
          nightGain = max(nightGain, .32);
        } else if (aPhase >= 0.9) {
          // Restrained red ATC obstruction beacon (realistic shorter atmospheric fade)
          pulse = .25 + .75 * smoothstep(.15, .85, sin(uTime * 3.1));
          nightGain = max(nightGain, .20);
          maxDist0 = 4500.;
          maxDist1 = 13500.;
        } else if (aPhase >= 0.4) {
          // PAPI remains distinctly visible even in overcast/daytime final approach!
          nightGain = max(nightGain, .52);
        }
        vColor = aColor * (.68 + .84 * nightGain);
        vAlpha = nightGain * pulse * (1. - smoothstep(maxDist0, maxDist1, dist));
        gl_PointSize = clamp(aSize * 520. / dist + 1.5, 2.0, 8.8);
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
        float core = exp(-r2 * 26.);
        float halo = exp(-r2 * 6.5) * .36;
        // Keep chromatic halo deeply saturated so emerald, sapphire, amber & ruby runway optics stay vividly colorful
        vec3 haloCol = pow(clamp(vColor, 0., 1.), vec3(1.25)) * max(vColor.r, max(vColor.g, vColor.b));
        gl_FragColor = vec4(vColor * core + haloCol * halo, vAlpha);
      }
    `,
  });
  const lights = new THREE.Points(lightGeo, lightMat);
  lights.name = 'kansai-airports-lights';
  lights.frustumCulled = false;
  group.add(lights);

  return group;
}
