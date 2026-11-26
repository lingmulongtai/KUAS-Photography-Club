import { toLocal } from './geo.ts';
import { AIRPORT_RUNWAYS, HELIPADS } from './airports-data.ts';

export type AircraftKind = 'overflight' | 'landing' | 'takeoff';

export interface AirlinerFlight {
  id: string;
  kind: AircraftKind;
  /** Runway index in AIRPORT_RUNWAYS (for landing / takeoff) */
  runwayIndex?: number;
  /** 1 = start -> end, -1 = end -> start */
  direction?: 1 | -1;
  /** En-route endpoints in Kyoto scene metres (for overflight) */
  from?: readonly [number, number, number];
  to?: readonly [number, number, number];
  /** Cruise/approach speed (m/s) */
  speed: number;
  /** Cycle duration (seconds) for airport takeoff/landing loops */
  cycleSeconds?: number;
  /** Initial phase [0, 1) */
  phase: number;
  /** Scale multiplier (1.0 = narrowbody A320/737, 1.35 = widebody 787/777) */
  scale: number;
  /** Tail livery accent color RGB */
  livery: readonly [number, number, number];
  /** Gentle departure/arrival bank direction (+1 right, -1 left) */
  turnSign?: number;
}

export interface HelicopterFlight {
  id: string;
  /** Pad index in HELIPADS */
  padIndex: number;
  /** Waypoints [lat, lon, cruiseAltAboveGround] for scenic flight loop (index 0 = helipad) */
  route: readonly (readonly [number, number, number])[];
  cycleSeconds: number;
  phase: number;
  color: readonly [number, number, number];
}

/**
 * Legacy export kept for compatibility: high-altitude illustrative overflights
 * plus live airport takeoff & landing flights at Itami (ITM), Kansai Intl (KIX) and Kobe (UKB).
 */
export const AIRCRAFT_PATHS = [
  { from: [18000, 4800, -9000], to: [-42000, 4400, -4500], speed: 190, phase: 0.15 },
  { from: [-42000, 6500, 11000], to: [20000, 6800, 7000], speed: 220, phase: 0.58 },
  { from: [20000, 3600, 17000], to: [-42000, 3000, 21000], speed: 170, phase: 0.82 },
] as const;

const LIVERY_BLUE: readonly [number, number, number] = [0.06, 0.24, 0.62];
const LIVERY_RED: readonly [number, number, number] = [0.76, 0.12, 0.16];
const LIVERY_TEAL: readonly [number, number, number] = [0.10, 0.55, 0.58];
const LIVERY_PEACH: readonly [number, number, number] = [0.72, 0.18, 0.52];
const LIVERY_SKY: readonly [number, number, number] = [0.16, 0.44, 0.78];

export const AIRLINER_FLIGHTS: readonly AirlinerFlight[] = [
  // High-altitude Kansai overflights (visible from Kyoto, Lake Biwa & Osaka; scale 1.0 = true 1:1 Boeing 787-8)
  { id: 'cruise-kyoto-w', kind: 'overflight', from: [18000, 4600, -9000], to: [-42000, 4200, -4500], speed: 195, phase: 0.15, scale: 1.0, livery: LIVERY_BLUE },
  { id: 'cruise-osaka-e', kind: 'overflight', from: [-44000, 5800, 14000], to: [24000, 6200, 6000], speed: 215, phase: 0.54, scale: 1.08, livery: LIVERY_RED },
  { id: 'cruise-bay-s', kind: 'overflight', from: [16000, 3400, 22000], to: [-54000, 2900, 46000], speed: 185, phase: 0.82, scale: 0.88, livery: LIVERY_TEAL },

  // 伊丹空港 (ITM) Runway 32L/14R — famous low final approach right over 千里川土手!
  { id: 'itm-land-1', kind: 'landing', runwayIndex: 2, direction: 1, speed: 70, cycleSeconds: 108, phase: 0.08, scale: 1.0, livery: LIVERY_BLUE, turnSign: -1 },
  { id: 'itm-land-2', kind: 'landing', runwayIndex: 2, direction: 1, speed: 68, cycleSeconds: 108, phase: 0.58, scale: 0.85, livery: LIVERY_RED, turnSign: -1 },
  { id: 'itm-takeoff-1', kind: 'takeoff', runwayIndex: 2, direction: 1, speed: 82, cycleSeconds: 112, phase: 0.33, scale: 0.96, livery: LIVERY_BLUE, turnSign: -1 },
  { id: 'itm-takeoff-32r', kind: 'takeoff', runwayIndex: 3, direction: 1, speed: 74, cycleSeconds: 98, phase: 0.72, scale: 0.66, livery: LIVERY_RED, turnSign: 1 },

  // 関西国際空港 (KIX) Runway 06R & 06L — international widebodies over Osaka Bay
  { id: 'kix-land-a1', kind: 'landing', runwayIndex: 0, direction: 1, speed: 74, cycleSeconds: 118, phase: 0.12, scale: 1.08, livery: LIVERY_BLUE, turnSign: 1 },
  { id: 'kix-land-b1', kind: 'landing', runwayIndex: 1, direction: 1, speed: 72, cycleSeconds: 122, phase: 0.62, scale: 1.0, livery: LIVERY_PEACH, turnSign: -1 },
  { id: 'kix-takeoff-a1', kind: 'takeoff', runwayIndex: 0, direction: 1, speed: 86, cycleSeconds: 124, phase: 0.44, scale: 1.12, livery: LIVERY_RED, turnSign: -1 },
  { id: 'kix-takeoff-b1', kind: 'takeoff', runwayIndex: 1, direction: 1, speed: 84, cycleSeconds: 118, phase: 0.86, scale: 0.90, livery: LIVERY_TEAL, turnSign: 1 },

  // 神戸空港 (UKB) Runway 09/27 — regional approaches & departures over Kobe Bay
  { id: 'ukb-land-1', kind: 'landing', runwayIndex: 4, direction: 1, speed: 68, cycleSeconds: 108, phase: 0.22, scale: 0.74, livery: LIVERY_SKY, turnSign: 1 },
  { id: 'ukb-takeoff-1', kind: 'takeoff', runwayIndex: 4, direction: 1, speed: 78, cycleSeconds: 112, phase: 0.70, scale: 0.74, livery: LIVERY_BLUE, turnSign: 1 },
];

/**
 * Scenic helicopter patrols sized to realistic real-world cruise speeds (~36–46 m/s = 130–165 km/h)
 * along smooth closed Catmull-Rom splines returning gently to their helipads.
 */
export const HELICOPTER_FLIGHTS: readonly HelicopterFlight[] = [
  // Kobe Airport heliport -> Meriken Park / Port Tower -> Port Island -> back to Kobe Airport pad (~11.5 km -> ~42 m/s)
  {
    id: 'heli-kobe',
    padIndex: 0,
    route: [
      [34.6347, 135.2148, 0],
      [34.6565, 135.1985, 175],
      [34.6745, 135.1935, 205],
      [34.6720, 135.2280, 215],
      [34.6485, 135.2345, 145],
    ],
    cycleSeconds: 400,
    phase: 0.14,
    color: [0.82, 0.20, 0.16], // Kobe Fire/Rescue red-white
  },
  // Maishima / Osaka Bay heliport -> Expo Yumeshima -> Tempozan -> Nakanoshima / Osaka Castle -> Yodo -> Maishima (~24 km -> ~44 m/s)
  {
    id: 'heli-osaka',
    padIndex: 2,
    route: [
      [34.6638, 135.3948, 0],
      [34.6425, 135.4120, 185],
      [34.6600, 135.4620, 240],
      [34.6860, 135.5060, 270],
      [34.7040, 135.4740, 245],
      [34.6920, 135.4240, 195],
    ],
    cycleSeconds: 780,
    phase: 0.42,
    color: [0.14, 0.36, 0.68], // News/Police blue
  },
  // Itami heliport -> Senrigawa -> Toyonaka patrol loop -> back to Itami (~11 km -> ~41 m/s)
  {
    id: 'heli-itami',
    padIndex: 1,
    route: [
      [34.7834, 135.4472, 0],
      [34.7735, 135.4680, 195],
      [34.7985, 135.4850, 245],
      [34.8115, 135.4540, 215],
      [34.7995, 135.4410, 135],
    ],
    cycleSeconds: 380,
    phase: 0.72,
    color: [0.85, 0.70, 0.18], // Patrol gold-white
  },
  // Kyoto / Lake Biwa scenic helicopter patrol (~28 km -> ~46 m/s)
  {
    id: 'heli-kyoto',
    padIndex: 3,
    route: [
      [34.9385, 135.7540, 0],
      [34.9780, 135.7740, 245],
      [35.0090, 135.8700, 320],
      [34.9730, 135.8980, 285],
      [34.9480, 135.8150, 210],
    ],
    cycleSeconds: 960,
    phase: 0.28,
    color: [0.18, 0.54, 0.56],
  },
];

export interface AircraftPose {
  x: number;
  y: number;
  z: number;
  /** Heading in Three.js world space: atan2(vx, vz) where +Z is forward. */
  yaw: number;
  /** Positive = nose up (+Z lifted toward +Y). */
  pitch: number;
  /** Positive = right wing down (banking into a right turn). */
  roll: number;
  opacity: number;
  landingLights: number;
  onGround: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const smootherstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Legacy helper kept for existing tests/callers. */
export function aircraftPose(path: (typeof AIRCRAFT_PATHS)[number], seconds: number) {
  const [x, y, z] = path.from, [tx, ty, tz] = path.to, dx = tx - x, dz = tz - z;
  const length = Math.hypot(dx, ty - y, dz), p = ((path.phase + (seconds * path.speed) / length) % 1 + 1) % 1;
  const opacity = Math.min(1, p / 0.045, (1 - p) / 0.045);
  return { x: x + (tx - x) * p, y: y + (ty - y) * p, z: z + (tz - z) * p, yaw: Math.atan2(dx, dz), opacity };
}

interface AirlinerPoint {
  x: number;
  y: number;
  z: number;
  alt: number;
  pitchBonus: number;
  landingLights: number;
  onGround: boolean;
}

function evalAirlinerPoint(
  kind: 'landing' | 'takeoff',
  p: number,
  cycle: number,
  speed: number,
  turn: number,
  a: { x: number; z: number },
  ux: number,
  uz: number,
  rx: number,
  rz: number,
  len: number,
  deckY: number,
): AirlinerPoint {
  if (kind === 'landing') {
    // Phase durations (seconds):
    // [0.00..0.62]: Final approach at constant approach speed `speed` (m/s) down 3.2° glideslope + smooth flare
    // [0.62..0.88]: Smooth C1 deceleration from `speed` to taxi speed `vTaxi` along runway
    // [0.88..1.00]: Smooth constant-speed exit curve onto parallel taxiway
    const pTouch = 0.62;
    const pExit = 0.88;
    const tApp = pTouch * cycle;
    const tRoll = (pExit - pTouch) * cycle;
    const tTaxi = (1 - pExit) * cycle;
    const vApp = speed; // ~68–74 m/s
    const vTaxi = 13;
    const touchAlong = 320;
    const approachDist = vApp * tApp;
    const rawRollDist = 0.5 * (vApp + vTaxi) * tRoll;
    const maxRollDist = Math.max(600, len - touchAlong - 220);
    // If runway is shorter than nominal rollout, brake slightly faster via higher deceleration while keeping v(0)=vApp continuous
    const rollDist = Math.min(rawRollDist, maxRollDist);
    const stopAlong = touchAlong + rollDist;

    let along: number;
    let across = 0;
    let alt = 0;
    let pitchBonus = 0;
    let landingLights = 1;
    let onGround = false;

    if (p < pTouch) {
      const u = p / pTouch;
      const distToTouch = approachDist * (1 - u);
      along = touchAlong - distToTouch;
      // 3.2° glideslope (tan = 0.056) with C1 flare in the final 420 m so vertical rate smoothly approaches 0 at touchdown
      const flare = smoothstep(420, 0, distToTouch);
      alt = distToTouch * 0.056 * (1 - 0.32 * flare * flare);
      // Gentle localizer alignment well out on final (completes before 28% of approach)
      const align = 1 - smootherstep(0.0, 0.28, u);
      across = turn * align * align * 260;
      // Airliners fly nose-up (~+3° AoA on glideslope, flaring to +6° right before touchdown)
      pitchBonus = 0.095 + 0.055 * flare;
    } else if (p < pExit) {
      const u = (p - pTouch) / (pExit - pTouch);
      // Cubic Hermite distance profile matching s(0)=0, s(1)=rollDist, s'(0)=vApp*tRoll, s'(1)=vTaxi*tRoll
      const m0 = vApp * tRoll;
      const m1 = vTaxi * tRoll;
      const u2 = u * u, u3 = u2 * u;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      const s = h10 * m0 + h01 * rollDist + h11 * m1;
      along = touchAlong + s;
      alt = 0;
      onGround = true;
      // Nose wheel smoothly settles onto runway over first 18% of rollout
      pitchBonus = 0.095 * (1 - smootherstep(0.0, 0.20, u));
      landingLights = 1 - smoothstep(0.45, 0.85, u);
    } else {
      const u = (p - pExit) / (1 - pExit);
      // Smooth curved exit onto parallel taxiway at continuous speed vTaxi
      const taxiS = vTaxi * tTaxi * u;
      const curve = smootherstep(0, 1, u);
      along = stopAlong + taxiS * (1 - 0.25 * curve);
      across = turn * 105 * curve * curve;
      alt = 0;
      onGround = true;
      landingLights = 0.22;
    }

    return {
      x: a.x + ux * along + rx * across,
      y: deckY + alt,
      z: a.z + uz * along + rz * across,
      alt,
      pitchBonus,
      landingLights,
      onGround,
    };
  }

  // Takeoff:
  // [0.00..0.10]: Smooth taxi lineup onto centerline at vTaxi = 12 m/s
  // [0.10..0.36]: Smooth C1 acceleration roll from vTaxi to vRotate (`speed`, ~78–86 m/s)
  // [0.36..1.00]: Smooth C1 climb-out accelerating gently from vRotate to vClimb with coordinated departure turn
  const pRoll = 0.10;
  const pLift = 0.36;
  const tLine = pRoll * cycle;
  const tRun = (pLift - pRoll) * cycle;
  const tClimb = (1 - pLift) * cycle;
  const vTaxi = 12;
  const vRotate = speed; // ~74–86 m/s
  const vClimbEnd = speed * 1.32;
  const lineStart = 70;
  const lineDist = vTaxi * tLine;
  const rollStart = lineStart + lineDist;
  const runDist = Math.min(0.5 * (vTaxi + vRotate) * tRun, Math.max(600, len * 0.68 - rollStart));
  const liftoffAlong = rollStart + runDist;

  let along: number;
  let across = 0;
  let alt = 0;
  let pitchBonus = 0;
  let landingLights = 1;
  let onGround = false;

  if (p < pRoll) {
    const u = p / pRoll;
    const align = 1 - smootherstep(0, 1, u);
    along = lineStart + lineDist * u;
    across = turn * 68 * align * align;
    onGround = true;
  } else if (p < pLift) {
    const u = (p - pRoll) / (pLift - pRoll);
    // Cubic Hermite matching v(0)=vTaxi, v(1)=vRotate, distance=runDist
    const m0 = vTaxi * tRun;
    const m1 = vRotate * tRun;
    const u2 = u * u, u3 = u2 * u;
    const s = (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * runDist + (u3 - u2) * m1;
    along = rollStart + s;
    onGround = true;
    // Smooth nose-up rotation right before liftoff
    pitchBonus = 0.19 * smootherstep(0.82, 1.0, u);
  } else {
    const u = (p - pLift) / (1 - pLift);
    // C1 continuous horizontal acceleration: v(u) = vRotate + (vClimbEnd - vRotate) * u
    const distHoriz = vRotate * tClimb * u + 0.5 * (vClimbEnd - vRotate) * tClimb * u * u;
    // Smooth departure turn beginning gently after clearing ~180 m altitude
    const turnCurve = smootherstep(0.16, 1.0, u);
    const turnAngle = turn * 0.48 * turnCurve;
    // Curve along/across smoothly so horizontal speed stays smooth
    along = liftoffAlong + distHoriz * Math.cos(turnAngle * 0.55);
    across = turn * 1450 * turnCurve * turnCurve;
    // C1 vertical climb: zero vertical slope at u=0 smoothly rising to ~8.5° climb angle
    const climbRate = smoothstep(0.0, 0.14, u);
    alt = 1050 * Math.pow(u, 1.32) * (0.45 + 0.55 * climbRate);
    // Pitch blends from rotation (+0.19) to modest positive AoA (+0.05) above flight path
    pitchBonus = 0.19 * (1 - smoothstep(0.0, 0.20, u)) + 0.045 * smoothstep(0.0, 0.20, u);
    landingLights = 1 - smoothstep(0.45, 0.85, u);
  }

  return {
    x: a.x + ux * along + rx * across,
    y: deckY + alt,
    z: a.z + uz * along + rz * across,
    alt,
    pitchBonus,
    landingLights,
    onGround,
  };
}

/** Evaluate full 3D pose (position, yaw, pitch, roll, landing-light state) of an airliner flight. */
export function airlinerPose(
  flight: AirlinerFlight,
  seconds: number,
  ground: (x: number, z: number) => number,
): AircraftPose {
  if (flight.kind === 'overflight' && flight.from && flight.to) {
    const [x, y, z] = flight.from, [tx, ty, tz] = flight.to;
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const length = Math.hypot(dx, dy, dz);
    const p = ((flight.phase + (seconds * flight.speed) / length) % 1 + 1) % 1;
    const opacity = Math.min(1, p / 0.045, (1 - p) / 0.045);
    return {
      x: x + dx * p,
      y: y + dy * p,
      z: z + dz * p,
      yaw: Math.atan2(dx, dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
      roll: 0,
      opacity,
      landingLights: 0,
      onGround: false,
    };
  }

  const rwy = AIRPORT_RUNWAYS[flight.runwayIndex ?? 0];
  const pStart = toLocal(rwy.start[0], rwy.start[1]);
  const pEnd = toLocal(rwy.end[0], rwy.end[1]);
  const dir = flight.direction ?? 1;
  const a = dir === 1 ? pStart : pEnd;
  const b = dir === 1 ? pEnd : pStart;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const rx = -uz, rz = ux; // right perpendicular (+1 right when looking along (ux, uz))

  // Runway deck height matching airports.ts (all five runways drape cleanly onto real surveyed terrain)
  const midGround = ground((a.x + b.x) * 0.5, (a.z + b.z) * 0.5);
  const deckY = (rwy.airportId === 'itami' ? midGround : Math.max(0.5, midGround)) + rwy.deckOffset + 4.1;

  const cycle = flight.cycleSeconds ?? 110;
  const p = ((flight.phase + seconds / cycle) % 1 + 1) % 1;
  const turn = flight.turnSign ?? 1;

  const evalAt = (pp: number) => evalAirlinerPoint(
    flight.kind as 'landing' | 'takeoff',
    clamp(pp, 0.0005, 0.9995),
    cycle,
    flight.speed,
    turn,
    a, ux, uz, rx, rz, len, deckY,
  );

  // Finite-difference tangent & curvature for exact yaw, flight-path pitch, and coordinated bank angle
  const dtSec = 0.25;
  const dp = dtSec / cycle;
  const p0 = clamp(p - dp, 0.0005, 0.9995);
  const p1 = clamp(p, 0.0005, 0.9995);
  const p2 = clamp(p + dp, 0.0005, 0.9995);
  const cur = evalAt(p1);
  const prev = evalAt(p0);
  const next = evalAt(p2);

  const actualDt = Math.max(0.05, (p2 - p0) * cycle);
  const vx = (next.x - prev.x) / actualDt;
  const vy = (next.y - prev.y) / actualDt;
  const vz = (next.z - prev.z) / actualDt;
  const vHoriz = Math.hypot(vx, vz);
  const yaw = vHoriz > 0.2 ? Math.atan2(vx, vz) : Math.atan2(ux, uz);

  // Flight-path pitch + realistic aircraft AoA/rotation/flare bonus
  const pathPitch = vHoriz > 0.5 ? Math.atan2(vy, vHoriz) : 0;
  const pitch = clamp(cur.onGround ? cur.pitchBonus : pathPitch + cur.pitchBonus, -0.12, 0.30);

  // Coordinated bank angle when airborne: turning right decreases yaw (yawRate < 0) -> positive roll (right wing down)
  let roll = 0;
  if (!cur.onGround && cur.alt > 22) {
    const dtHalf = Math.max(0.05, (p1 - p0) * cycle);
    const dtNext = Math.max(0.05, (p2 - p1) * cycle);
    const yawPrev = Math.atan2(cur.x - prev.x, cur.z - prev.z);
    const yawNext = Math.atan2(next.x - cur.x, next.z - cur.z);
    const yawRate = wrapAngle(yawNext - yawPrev) / (0.5 * (dtHalf + dtNext));
    const bankEnv = smoothstep(22, 95, cur.alt);
    roll = clamp((-yawRate * vHoriz) / 9.81, -0.34, 0.34) * bankEnv;
  }

  const opacity = Math.min(1, p / 0.045, (1 - p) / 0.055);
  return {
    x: cur.x,
    y: cur.y,
    z: cur.z,
    yaw,
    pitch,
    roll,
    opacity,
    landingLights: cur.landingLights,
    onGround: cur.onGround,
  };
}

interface Vec3 { x: number; y: number; z: number }

/** Closed uniform Catmull-Rom spline with C1-continuous tangent everywhere, including wrap at index 0. */
function evalClosedCatmullRom(pts: readonly Vec3[], s: number): Vec3 {
  const n = pts.length;
  const wrapped = ((s % 1) + 1) % 1;
  const scaled = wrapped * n;
  const i1 = Math.floor(scaled) % n;
  const t = scaled - Math.floor(scaled);
  const p0 = pts[(i1 - 1 + n) % n];
  const p1 = pts[i1];
  const p2 = pts[(i1 + 1) % n];
  const p3 = pts[(i1 + 2) % n];

  const t2 = t * t;
  const t3 = t2 * t;
  const c = (a: number, b: number, cVal: number, d: number) =>
    0.5 * (
      (2 * b)
      + (-a + cVal) * t
      + (2 * a - 5 * b + 4 * cVal - d) * t2
      + (-a + 3 * b - 3 * cVal + d) * t3
    );

  return {
    x: c(p0.x, p1.x, p2.x, p3.x),
    y: c(p0.y, p1.y, p2.y, p3.y),
    z: c(p0.z, p1.z, p2.z, p3.z),
  };
}

/**
 * Evaluate full 3D pose of a helicopter:
 * parked spool-up -> vertical takeoff climb -> C2 closed Catmull-Rom cruise with realistic speed,
 * coordinated inward banking, smooth acceleration/flare -> aligned hover -> vertical landing.
 */
export function helicopterPose(
  flight: HelicopterFlight,
  seconds: number,
  ground: (x: number, z: number) => number,
): AircraftPose & { rotorPhase: number } {
  const pad = HELIPADS[flight.padIndex] ?? HELIPADS[0];
  const pts: Vec3[] = flight.route.map(([lat, lon, agl]) => {
    const lp = toLocal(lat, lon);
    const gY = Math.max(0.4, ground(lp.x, lp.z));
    return { x: lp.x, y: agl === 0 ? gY + pad.deckOffset + 2.2 : gY + agl, z: lp.z };
  });

  const padPt = pts[0];
  const hoverH = 42;
  const splinePts: Vec3[] = pts.map((pt, i) => (i === 0 ? { x: pt.x, y: pt.y + hoverH, z: pt.z } : pt));

  // Build an arc-length lookup table (96 segments) so cruise speed stays steady around uneven waypoint spacing.
  const SAMPLES = 96;
  const cumLen = new Float64Array(SAMPLES + 1);
  let prevP = evalClosedCatmullRom(splinePts, 0);
  for (let i = 1; i <= SAMPLES; i++) {
    const curP = evalClosedCatmullRom(splinePts, i / SAMPLES);
    cumLen[i] = cumLen[i - 1] + Math.hypot(curP.x - prevP.x, curP.y - prevP.y, curP.z - prevP.z);
    prevP = curP;
  }
  const totalLen = cumLen[SAMPLES] || 1;

  const sampleArc = (frac: number): Vec3 => {
    const f = ((frac % 1) + 1) % 1;
    const target = f * totalLen;
    let lo = 0, hi = SAMPLES;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid] <= target) lo = mid; else hi = mid;
    }
    const span = cumLen[hi] - cumLen[lo];
    const alpha = span > 1e-6 ? (target - cumLen[lo]) / span : 0;
    const s = (lo + alpha) / SAMPLES;
    return evalClosedCatmullRom(splinePts, s);
  };

  // Closed Catmull-Rom tangent at s=0 equals tangent at s=1 -> identical pad departure & arrival yaw (zero snap!)
  const departAhead = sampleArc(0.004);
  const departBehind = sampleArc(0.996);
  const padYaw = Math.atan2(departAhead.x - departBehind.x, departAhead.z - departBehind.z);

  const cycle = flight.cycleSeconds;
  const p = ((flight.phase + seconds / cycle) % 1 + 1) % 1;
  // Realistic rotor spin (~4.2 rev/s -> ~26 rad/s in flight, slower spool while parked)
  const rotorPhase = seconds * 24.0;

  // Phase schedule:
  // [0.00..0.06]: Parked & idling on helipad
  // [0.06..0.13]: Smooth vertical liftoff climb to +42 m hover
  // [0.13..0.87]: Smooth ease-in/cruise/ease-out closed-loop flight
  // [0.87..0.94]: Smooth vertical landing descent onto helipad
  // [0.94..1.00]: Touchdown cooldown on helipad
  const pLiftStart = 0.06;
  const pCruiseStart = 0.13;
  const pCruiseEnd = 0.87;
  const pLandEnd = 0.94;

  if (p < pLiftStart) {
    return { x: padPt.x, y: padPt.y, z: padPt.z, yaw: padYaw, pitch: 0, roll: 0, opacity: 1, landingLights: 0.4, onGround: true, rotorPhase };
  }
  if (p < pCruiseStart) {
    const u = smootherstep(pLiftStart, pCruiseStart, p);
    return {
      x: padPt.x,
      y: padPt.y + hoverH * u,
      z: padPt.z,
      yaw: padYaw,
      pitch: 0,
      roll: 0,
      opacity: 1,
      landingLights: 1,
      onGround: false,
      rotorPhase,
    };
  }
  if (p >= pLandEnd) {
    return { x: padPt.x, y: padPt.y, z: padPt.z, yaw: padYaw, pitch: 0, roll: 0, opacity: 1, landingLights: 0.35, onGround: true, rotorPhase };
  }
  if (p >= pCruiseEnd) {
    const u = 1 - smootherstep(pCruiseEnd, pLandEnd, p);
    return {
      x: padPt.x,
      y: padPt.y + hoverH * u,
      z: padPt.z,
      yaw: padYaw,
      pitch: 0,
      roll: 0,
      opacity: 1,
      landingLights: 1,
      onGround: false,
      rotorPhase,
    };
  }

  // Smooth ease-in / steady cruise / ease-out speed curve so horizontal velocity starts & ends at 0 in hover.
  const cruiseDur = (pCruiseEnd - pCruiseStart) * cycle;
  const u = (p - pCruiseStart) / (pCruiseEnd - pCruiseStart);

  // Integral of a smooth trapezoidal speed envelope (ramp = 0.09 at start & end):
  // v_norm(t) rises smoothly 0->1 over [0, r], stays 1 on [r, 1-r], falls smoothly 1->0 over [1-r, 1].
  const ramp = 0.09;
  const area = 1 - ramp; // exact integral of symmetric smooth ramp on [0, 1]
  const arcProgress = (uu: number) => {
    const t = clamp01(uu);
    if (t < ramp) {
      const q = t / ramp;
      // Integral of (3q^2 - 2q^3) dq = q^3 - 0.5*q^4
      return (ramp * (q * q * q - 0.5 * q * q * q * q)) / area;
    }
    if (t > 1 - ramp) {
      const q = (1 - t) / ramp;
      return 1 - (ramp * (q * q * q - 0.5 * q * q * q * q)) / area;
    }
    return (0.5 * ramp + (t - ramp)) / area;
  };
  const speedNorm = (uu: number) => {
    const t = clamp01(uu);
    if (t < ramp) return smoothstep(0, ramp, t);
    if (t > 1 - ramp) return smoothstep(1, 1 - ramp, t);
    return 1;
  };

  const sCur = arcProgress(u);
  const cur = sampleArc(sCur);
  // Guarantee smooth terrain clearance during mid-cruise
  const clearEnv = smoothstep(0.05, 0.14, u) * smoothstep(0.95, 0.86, u);
  const minClearY = Math.max(0.4, ground(cur.x, cur.z)) + 52;
  const y = cur.y + Math.max(0, minClearY - cur.y) * clearEnv;

  // Evaluate tangent cleanly along arc-length even when horizontal speed approaches 0 near hover
  const ds = 0.004;
  const prevArc = sampleArc(sCur - ds);
  const nextArc = sampleArc(sCur + ds);
  const yaw = Math.atan2(nextArc.x - prevArc.x, nextArc.z - prevArc.z);

  // Exact curvature & coordinated inward bank (positive roll = right wing down when turning right)
  const yawPrev = Math.atan2(cur.x - prevArc.x, cur.z - prevArc.z);
  const yawNext = Math.atan2(nextArc.x - cur.x, nextArc.z - cur.z);
  const vCruise = (totalLen / (cruiseDur * area)) * speedNorm(u);
  const dArcMeters = ds * totalLen;
  const kappa = wrapAngle(yawNext - yawPrev) / Math.max(1, dArcMeters); // dYaw / dS (rad/m)
  const yawRate = kappa * vCruise; // rad/s
  const bankEnv = smoothstep(0.02, 0.10, u) * smoothstep(0.98, 0.90, u);
  const roll = clamp((-yawRate * vCruise) / 9.81, -0.30, 0.30) * bankEnv;

  // Realistic helicopter pitch: nose tilts gently down proportionally to forward speed,
  // with a subtle nose-up braking flare during final deceleration into hover.
  const cruiseNoseDown = -0.095 * clamp01(vCruise / 44) * smoothstep(0.0, 0.08, u) * smoothstep(0.96, 0.84, u);
  const brakeFlare = 0.075 * Math.sin(clamp01((u - 0.86) / 0.14) * Math.PI);
  const pitch = cruiseNoseDown + brakeFlare;

  return {
    x: cur.x,
    y,
    z: cur.z,
    yaw,
    pitch,
    roll,
    opacity: 1,
    landingLights: 0.72 + 0.28 * (1 - bankEnv),
    onGround: false,
    rotorPhase,
  };
}
