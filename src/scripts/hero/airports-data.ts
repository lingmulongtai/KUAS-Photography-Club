import { toLocal } from './geo.ts';

export interface RunwaySpec {
  id: string;
  airportId: 'kix' | 'itami' | 'kobeAirport';
  /** Start threshold (takeoff start / landing touchdown end) [lat, lon] */
  start: [number, number];
  /** Opposite end [lat, lon] */
  end: [number, number];
  width: number;
  /** Surface deck elevation above local ground(x,z) or water */
  deckOffset: number;
}

/** Surveyed runway geometries shared between airports.ts and aircraft-path.ts. */
export const AIRPORT_RUNWAYS: readonly RunwaySpec[] = [
  // 関西国際空港 (KIX) — Runway A (06R/24L, 3,500 m × 60 m, Island 1)
  { id: 'kix-06R', airportId: 'kix', start: [34.4178, 135.2291], end: [34.4370, 135.2591], width: 60, deckOffset: 6.2 },
  // 関西国際空港 (KIX) — Runway B (06L/24R, 4,000 m × 60 m, Island 2)
  { id: 'kix-06L', airportId: 'kix', start: [34.4317, 135.1999], end: [34.4536, 135.2342], width: 60, deckOffset: 6.2 },
  // 大阪国際空港・伊丹空港 (ITM) — Runway B (32L/14R, 3,000 m × 60 m — approach directly over 千里川土手!)
  { id: 'itm-32L', airportId: 'itami', start: [34.7736, 135.4508], end: [34.7931, 135.4279], width: 60, deckOffset: 1.3 },
  // 大阪国際空港・伊丹空港 (ITM) — Runway A (32R/14L, 1,828 m × 45 m)
  { id: 'itm-32R', airportId: 'itami', start: [34.7810, 135.4480], end: [34.7929, 135.4340], width: 45, deckOffset: 1.3 },
  // 神戸空港 (UKB) — Runway 09/27 (2,500 m × 60 m)
  { id: 'ukb-09', airportId: 'kobeAirport', start: [34.6311, 135.2104], end: [34.6344, 135.2374], width: 60, deckOffset: 5.8 },
];

export interface HelipadSpec {
  id: string;
  lat: number;
  lon: number;
  deckOffset: number;
}

export const HELIPADS: readonly HelipadSpec[] = [
  // Kobe Airport west heliport apron (Fire / Police / Coast Guard hub)
  { id: 'kobe-heli', lat: 34.6347, lon: 135.2148, deckOffset: 4.6 },
  // Itami general aviation / helicopter apron
  { id: 'itami-heli', lat: 34.7885, lon: 135.4445, deckOffset: 0.8 },
  // Osaka Bay / Maishima-Yumeshima heliport
  { id: 'maishima-heli', lat: 34.6638, lon: 135.3948, deckOffset: 4.0 },
  // Kyoto / Fushimi heliport area
  { id: 'kyoto-heli', lat: 34.9385, lon: 135.7540, deckOffset: 1.0 },
];

const localXZ = (lat: number, lon: number) => {
  const p = toLocal(lat, lon);
  return [p.x, p.z] as const;
};

const ITAMI_CENTER = localXZ(34.7834, 135.4394);
const KIX1_CENTER = localXZ(34.4320, 135.2400);
const KIX2_CENTER = localXZ(34.4426, 135.2170);
const UKB_CENTER = localXZ(34.6335, 135.2240);

/** Keep procedural trees off active airport runways, taxiways and aprons (Itami, KIX, Kobe Airport). */
export function inAirportClearing(x: number, z: number): boolean {
  // Itami Airport (bearing 316 deg NW: ux=-0.695, uz=-0.719)
  {
    const dx = x - ITAMI_CENTER[0], dz = z - ITAMI_CENTER[1];
    if (Math.abs(dx) < 2200 && Math.abs(dz) < 2200) {
      const along = dx * -0.695 - dz * 0.719;
      const across = dx * 0.719 - dz * 0.695;
      if (Math.abs(along) < 1680 && across > -240 && across < 660) return true;
    }
  }
  // KIX Islands 1 & 2
  for (const [c, aMin, aMax] of [[KIX1_CENTER, -1120, 300], [KIX2_CENTER, -520, 880]] as const) {
    const dx = x - c[0], dz = z - c[1];
    if (Math.abs(dx) < 3500 && Math.abs(dz) < 3500) {
      const along = dx * 0.79 - dz * 0.61;
      const across = dx * 0.61 + dz * 0.79;
      if (Math.abs(along) < 2400 && across > aMin && across < aMax) return true;
    }
  }
  // Kobe Airport island
  {
    const dx = x - UKB_CENTER[0], dz = z - UKB_CENTER[1];
    if (Math.abs(dx) < 1680 && dz > -680 && dz < 360) return true;
  }
  return false;
}
