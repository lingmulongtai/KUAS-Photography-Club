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
  /** Waypoints [lat, lon, cruiseAltAboveGround] for scenic flight loop */
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
  // High-altitude Kansai overflights (visible from Kyoto, Lake Biwa & Osaka)
  { id: 'cruise-kyoto-w', kind: 'overflight', from: [18000, 4600, -9000], to: [-42000, 4200, -4500], speed: 195, phase: 0.15, scale: 1.25, livery: LIVERY_BLUE },
  { id: 'cruise-osaka-e', kind: 'overflight', from: [-44000, 5800, 14000], to: [24000, 6200, 6000], speed: 215, phase: 0.54, scale: 1.35, livery: LIVERY_RED },
  { id: 'cruise-bay-s', kind: 'overflight', from: [16000, 3400, 22000], to: [-54000, 2900, 46000], speed: 185, phase: 0.82, scale: 1.15, livery: LIVERY_TEAL },

  // 伊丹空港 (ITM) Runway 32L/14R — famous low final approach right over 千里川土手!
  { id: 'itm-land-1', kind: 'landing', runwayIndex: 2, direction: 1, speed: 74, cycleSeconds: 95, phase: 0.08, scale: 1.30, livery: LIVERY_BLUE, turnSign: -1 },
  { id: 'itm-land-2', kind: 'landing', runwayIndex: 2, direction: 1, speed: 70, cycleSeconds: 95, phase: 0.58, scale: 1.15, livery: LIVERY_RED, turnSign: -1 },
  { id: 'itm-takeoff-1', kind: 'takeoff', runwayIndex: 2, direction: 1, speed: 86, cycleSeconds: 105, phase: 0.33, scale: 1.25, livery: LIVERY_BLUE, turnSign: -1 },
  { id: 'itm-takeoff-32r', kind: 'takeoff', runwayIndex: 3, direction: 1, speed: 76, cycleSeconds: 88, phase: 0.72, scale: 0.92, livery: LIVERY_RED, turnSign: 1 },

  // 関西国際空港 (KIX) Runway 06R & 06L — international widebodies over Osaka Bay
  { id: 'kix-land-a1', kind: 'landing', runwayIndex: 0, direction: 1, speed: 78, cycleSeconds: 110, phase: 0.12, scale: 1.40, livery: LIVERY_BLUE, turnSign: 1 },
  { id: 'kix-land-b1', kind: 'landing', runwayIndex: 1, direction: 1, speed: 75, cycleSeconds: 115, phase: 0.62, scale: 1.35, livery: LIVERY_PEACH, turnSign: -1 },
  { id: 'kix-takeoff-a1', kind: 'takeoff', runwayIndex: 0, direction: 1, speed: 92, cycleSeconds: 118, phase: 0.44, scale: 1.42, livery: LIVERY_RED, turnSign: -1 },
  { id: 'kix-takeoff-b1', kind: 'takeoff', runwayIndex: 1, direction: 1, speed: 88, cycleSeconds: 112, phase: 0.86, scale: 1.20, livery: LIVERY_TEAL, turnSign: 1 },

  // 神戸空港 (UKB) Runway 09/27 — regional approaches & departures over Kobe Bay
  { id: 'ukb-land-1', kind: 'landing', runwayIndex: 4, direction: 1, speed: 68, cycleSeconds: 100, phase: 0.22, scale: 0.98, livery: LIVERY_SKY, turnSign: 1 },
  { id: 'ukb-takeoff-1', kind: 'takeoff', runwayIndex: 4, direction: 1, speed: 80, cycleSeconds: 104, phase: 0.70, scale: 0.98, livery: LIVERY_BLUE, turnSign: 1 },
];

export const HELICOPTER_FLIGHTS: readonly HelicopterFlight[] = [
  // Kobe Airport heliport -> Meriken Park / Port Tower -> Akashi Bay -> back to Kobe Airport pad
  {
    id: 'heli-kobe',
    padIndex: 0,
    route: [
      [34.6347, 135.2148, 0],
      [34.6560, 135.2060, 190],
      [34.6780, 135.1900, 230],
      [34.6740, 135.2420, 260],
      [34.6440, 135.2420, 150],
    ],
    cycleSeconds: 150,
    phase: 0.10,
    color: [0.82, 0.20, 0.16], // Kobe Fire/Rescue red-white
  },
  // Maishima / Osaka Bay heliport -> Expo Yumeshima -> Osaka Castle -> Yodo River -> back to Maishima
  {
    id: 'heli-osaka',
    padIndex: 2,
    route: [
      [34.6638, 135.3948, 0],
      [34.6485, 135.3980, 190],
      [34.6820, 135.4850, 270],
      [34.7020, 135.5120, 290],
      [34.6960, 135.4320, 195],
    ],
    cycleSeconds: 175,
    phase: 0.42,
    color: [0.14, 0.36, 0.68], // News/Police blue
  },
  // Itami heliport -> Senrigawa / North Osaka patrol loop -> back to Itami
  {
    id: 'heli-itami',
    padIndex: 1,
    route: [
      [34.7885, 135.4445, 0],
      [34.7780, 135.4820, 210],
      [34.8120, 135.4950, 280],
      [34.8240, 135.4420, 240],
      [34.8020, 135.4420, 140],
    ],
    cycleSeconds: 145,
    phase: 0.72,
    color: [0.85, 0.70, 0.18], // Coast Guard / Patrol gold-white
  },
  // Kyoto / Lake Biwa scenic helicopter patrol
  {
    id: 'heli-kyoto',
    padIndex: 3,
    route: [
      [34.9385, 135.7540, 0],
      [34.9780, 135.7740, 260],
      [35.0120, 135.8720, 340],
      [34.9740, 135.9020, 300],
      [34.9480, 135.8150, 220],
    ],
    cycleSeconds: 195,
    phase: 0.28,
    color: [0.18, 0.54, 0.56],
  },
];

export interface AircraftPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  opacity: number;
  landingLights: number;
  onGround: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Legacy helper kept for existing tests/callers. */
export function aircraftPose(path: (typeof AIRCRAFT_PATHS)[number], seconds: number) {
  const [x, y, z] = path.from, [tx, ty, tz] = path.to, dx = tx - x, dz = tz - z;
  const length = Math.hypot(dx, ty - y, dz), p = ((path.phase + (seconds * path.speed) / length) % 1 + 1) % 1;
  const opacity = Math.min(1, p / 0.045, (1 - p) / 0.045);
  return { x: x + (tx - x) * p, y: y + (ty - y) * p, z: z + (tz - z) * p, yaw: Math.atan2(dx, dz), opacity };
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
  const rx = -uz, rz = ux; // right perpendicular
  const baseYaw = Math.atan2(ux, uz);
  // Runway deck height matching airports.ts
  const deckY = rwy.airportId === 'itami'
    ? Math.max(ground((a.x + b.x) * 0.5, (a.z + b.z) * 0.5), ground(a.x, a.z), ground(b.x, b.z)) + rwy.deckOffset + 4.0
    : rwy.deckOffset + 4.0;

  const cycle = flight.cycleSeconds ?? 100;
  const p = ((flight.phase + seconds / cycle) % 1 + 1) % 1;
  const turn = flight.turnSign ?? 1;

  if (flight.kind === 'landing') {
    // Phase breakdown:
    // [0.00..0.62]: Final approach from 5,400 m out down a 3.3 deg glideslope to touchdown (+320 m past threshold)
    // [0.62..0.88]: Smooth deceleration rollout along runway down to exit taxiway
    // [0.88..1.00]: Gentle turn off onto parallel taxiway & fade out
    const approachDist = 5400;
    const touchAlong = 320;
    const stopAlong = Math.min(len - 220, 2150);

    let along: number, across = 0, alt = 0, pitch = 0, roll = 0, yaw = baseYaw;
    let landingLights = 1;
    let onGround = false;

    if (p < 0.62) {
      const u = p / 0.62;
      // Slightly faster far out, decelerating onto approach speed
      const easeU = u;
      along = -approachDist * (1 - easeU) + touchAlong * easeU;
      const distToTouch = Math.max(0, touchAlong - along);
      // 3.3 degree glideslope (~0.058 rad) with smooth touchdown flare in final 280 m
      const flare = smoothstep(0.84, 1.0, u);
      alt = distToTouch * 0.062 * (1 - flare * 0.16);
      if (u > 0.94) alt *= (1 - (u - 0.94) / 0.06);
      // Slight base-to-final alignment turn at the very start of approach
      const align = 1 - smoothstep(0.0, 0.16, u);
      across = turn * align * align * 480;
      roll = -turn * align * 0.18;
      yaw = baseYaw + turn * align * 0.24;
      // Nose-up pitch during approach (+3 deg) flaring to +6.5 deg right before touchdown
      pitch = 0.05 + 0.075 * flare;
    } else if (p < 0.88) {
      const u = (p - 0.62) / 0.26;
      // Decelerate smoothly (quadratic ease-out) from touchdown to runway exit
      const decel = 1 - (1 - u) * (1 - u);
      along = touchAlong + (stopAlong - touchAlong) * decel;
      alt = 0;
      // Nose wheel gently lowers right after touchdown
      pitch = 0.08 * (1 - smoothstep(0.0, 0.18, u));
      onGround = true;
      landingLights = 1 - smoothstep(0.45, 0.85, u);
    } else {
      const u = (p - 0.88) / 0.12;
      const turnEase = smoothstep(0, 1, u);
      along = stopAlong + u * 180;
      across = turn * turnEase * 125;
      yaw = baseYaw + turn * Math.sin(u * Math.PI) * 0.48;
      onGround = true;
      landingLights = 0.2;
    }

    const opacity = Math.min(1, p / 0.045, (1 - p) / 0.055);
    return {
      x: a.x + ux * along + rx * across,
      y: deckY + alt,
      z: a.z + uz * along + rz * across,
      yaw,
      pitch,
      roll,
      opacity,
      landingLights,
      onGround,
    };
  }

  // Takeoff:
  // [0.00..0.09]: Line up on runway threshold
  // [0.09..0.34]: Takeoff acceleration roll down runway (quadratic accel) to liftoff at ~1,550 m
  // [0.34..1.00]: Rotation (+13 deg pitch), positive climb out to ~1,050 m altitude with gentle departure bank
  const liftoffAlong = Math.min(len * 0.66, 1650);
  let along: number, across = 0, alt = 0, pitch = 0, roll = 0, yaw = baseYaw;
  let landingLights = 1;
  let onGround = false;

  if (p < 0.09) {
    const u = p / 0.09;
    along = 70 + u * 55;
    across = turn * (1 - smoothstep(0, 1, u)) * 85;
    yaw = baseYaw - turn * (1 - u) * 0.55;
    onGround = true;
  } else if (p < 0.34) {
    const u = (p - 0.09) / 0.25;
    along = 125 + (liftoffAlong - 125) * u * u;
    onGround = true;
    // Rotate nose up right before liftoff
    pitch = 0.21 * smoothstep(0.84, 1.0, u);
  } else {
    const u = (p - 0.34) / 0.66;
    const climbDist = 5600;
    along = liftoffAlong + u * climbDist;
    // Smooth climb curve accelerating upward cleanly
    alt = 1050 * Math.pow(u, 1.24);
    pitch = 0.22 * (1 - 0.35 * smoothstep(0.35, 1.0, u));
    // Gentle departure bank once safely above 200 m
    const bankEnv = smoothstep(0.18, 0.42, u) * (1 - smoothstep(0.75, 1.0, u));
    const headingShift = turn * 0.52 * smoothstep(0.18, 0.92, u);
    across = turn * 1550 * Math.pow(Math.max(0, u - 0.16), 1.85);
    yaw = baseYaw + headingShift;
    roll = turn * bankEnv * 0.26;
    landingLights = 1 - smoothstep(0.45, 0.85, u);
  }

  const opacity = Math.min(1, p / 0.04, (1 - p) / 0.06);
  return {
    x: a.x + ux * along + rx * across,
    y: deckY + alt,
    z: a.z + uz * along + rz * across,
    yaw,
    pitch,
    roll,
    opacity,
    landingLights,
    onGround,
  };
}

/** Evaluate full 3D pose of a helicopter (vertical takeoff hover -> forward pitch cruise -> flare -> vertical landing). */
export function helicopterPose(
  flight: HelicopterFlight,
  seconds: number,
  ground: (x: number, z: number) => number,
): AircraftPose & { rotorPhase: number } {
  const pad = HELIPADS[flight.padIndex] ?? HELIPADS[0];
  const pts = flight.route.map(([lat, lon, agl]) => {
    const lp = toLocal(lat, lon);
    const baseY = Math.max(0.4, ground(lp.x, lp.z)) + (agl === 0 ? pad.deckOffset + 2.4 : agl);
    return { x: lp.x, y: baseY, z: lp.z };
  });
  // Close loop back to pad
  const closed = [...pts, pts[0]];
  const cycle = flight.cycleSeconds;
  const p = ((flight.phase + seconds / cycle) % 1 + 1) % 1;

  // [0.00..0.07]: Parked & spooling up on helipad
  // [0.07..0.14]: Vertical liftoff climb to +42 m hover
  // [0.14..0.86]: Smooth closed-loop cruise around city/bay waypoints
  // [0.86..0.94]: Hover flare & vertical descent back onto helipad
  // [0.94..1.00]: Touchdown cooldown on helipad
  const rotorPhase = seconds * 26.0;
  const padPt = pts[0];
  const nextPt = pts[1];
  const padYaw = Math.atan2(nextPt.x - padPt.x, nextPt.z - padPt.z);

  if (p < 0.07) {
    return { x: padPt.x, y: padPt.y, z: padPt.z, yaw: padYaw, pitch: 0, roll: 0, opacity: 1, landingLights: 0.4, onGround: true, rotorPhase };
  }
  if (p < 0.14) {
    const u = smoothstep(0.07, 0.14, p);
    return {
      x: padPt.x,
      y: padPt.y + 42 * u,
      z: padPt.z,
      yaw: padYaw,
      pitch: -0.09 * smoothstep(0.55, 1.0, u),
      roll: 0,
      opacity: 1,
      landingLights: 1,
      onGround: false,
      rotorPhase,
    };
  }
  if (p > 0.94) {
    return { x: padPt.x, y: padPt.y, z: padPt.z, yaw: padYaw, pitch: 0, roll: 0, opacity: 1, landingLights: 0.35, onGround: true, rotorPhase };
  }
  if (p > 0.86) {
    const u = 1 - smoothstep(0.86, 0.94, p);
    return {
      x: padPt.x,
      y: padPt.y + 42 * u,
      z: padPt.z,
      yaw: padYaw,
      pitch: 0.08 * u,
      roll: 0,
      opacity: 1,
      landingLights: 1,
      onGround: false,
      rotorPhase,
    };
  }

  // Cruise along Catmull-like smooth polyline from hover point around route back to hover point
  const cruisePts = closed.map((pt, i) => (i === 0 || i === closed.length - 1 ? { x: pt.x, y: pt.y + 42, z: pt.z } : pt));
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < cruisePts.length - 1; i++) {
    const d = Math.hypot(cruisePts[i + 1].x - cruisePts[i].x, cruisePts[i + 1].y - cruisePts[i].y, cruisePts[i + 1].z - cruisePts[i].z);
    segLens.push(d);
    totalLen += d;
  }
  const sampleAt = (t: number) => {
    const target = clamp01(t) * totalLen;
    let acc = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (acc + segLens[i] >= target || i === segLens.length - 1) {
        const local = segLens[i] > 1e-4 ? (target - acc) / segLens[i] : 0;
        const a = cruisePts[i], b = cruisePts[i + 1];
        return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local, z: a.z + (b.z - a.z) * local };
      }
      acc += segLens[i];
    }
    return cruisePts[0];
  };

  const u = (p - 0.14) / 0.72;
  const cur = sampleAt(u);
  const ahead = sampleAt(Math.min(1, u + 0.015));
  const behind = sampleAt(Math.max(0, u - 0.015));
  const dx = ahead.x - cur.x, dz = ahead.z - cur.z;
  const yaw = Math.atan2(dx, dz);
  const prevYaw = Math.atan2(cur.x - behind.x, cur.z - behind.z);
  let dyaw = yaw - prevYaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const roll = Math.max(-0.28, Math.min(0.28, -dyaw * 2.4));
  // Nose-down forward helicopter pitch during cruise
  const pitch = -0.11 * Math.sin(u * Math.PI);

  return {
    x: cur.x,
    y: cur.y,
    z: cur.z,
    yaw,
    pitch,
    roll,
    opacity: 1,
    landingLights: 0.75,
    onGround: false,
    rotorPhase,
  };
}
