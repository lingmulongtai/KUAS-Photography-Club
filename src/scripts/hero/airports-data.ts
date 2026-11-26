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

/** Exact OSM/AIP surveyed runway endpoints shared between airports.ts and aircraft-path.ts. */
export const AIRPORT_RUNWAYS: readonly RunwaySpec[] = [
  // 関西国際空港 (KIX) — Runway A (06R/24L, 3,500 m × 60 m, Island 1)
  { id: 'kix-06R', airportId: 'kix', start: [34.417345, 135.229217], end: [34.437214, 135.258831], width: 60, deckOffset: 6.2 },
  // 関西国際空港 (KIX) — Runway B (06L/24R, 4,000 m × 60 m, Island 2)
  { id: 'kix-06L', airportId: 'kix', start: [34.428534, 135.206151], end: [34.451260, 135.240003], width: 60, deckOffset: 6.2 },
  // 大阪国際空港・伊丹空港 (ITM) — Runway B (32L/14R, 3,000 m × 60 m — approach right over 千里川土手!)
  { id: 'itm-32L', airportId: 'itami', start: [34.771524, 135.452689], end: [34.791984, 135.427905], width: 60, deckOffset: 0.45 },
  // 大阪国際空港・伊丹空港 (ITM) — Runway A (32R/14L, 1,828 m × 45 m)
  { id: 'itm-32R', airportId: 'itami', start: [34.782468, 135.444188], end: [34.796630, 135.427021], width: 45, deckOffset: 0.45 },
  // 神戸空港 (UKB) — Runway 09/27 (2,500 m × 60 m)
  { id: 'ukb-09', airportId: 'kobeAirport', start: [34.631588, 135.209675], end: [34.633804, 135.238090], width: 60, deckOffset: 5.8 },
];

export interface HelipadSpec {
  id: string;
  lat: number;
  lon: number;
  deckOffset: number;
}

export const HELIPADS: readonly HelipadSpec[] = [
  // Kobe Airport west heliport apron (Fire / Police / Coast Guard hub)
  { id: 'kobe-heli', lat: 34.6347, lon: 135.2148, deckOffset: 5.9 },
  // Itami south maintenance & general aviation / helicopter apron
  { id: 'itami-heli', lat: 34.7782, lon: 135.4510, deckOffset: 0.45 },
  // Osaka Bay / Maishima-Yumeshima heliport
  { id: 'maishima-heli', lat: 34.6638, lon: 135.3948, deckOffset: 4.0 },
  // Kyoto / Fushimi heliport area
  { id: 'kyoto-heli', lat: 34.9385, lon: 135.7540, deckOffset: 1.0 },
];

const localXZ = (lat: number, lon: number) => {
  const p = toLocal(lat, lon);
  return [p.x, p.z] as const;
};

// Exact runway midpoint frames for fast clearing & regional-building footprint masking
const ITM_P0 = localXZ(34.771524, 135.452689);
const ITM_P1 = localXZ(34.791984, 135.427905);
const ITM_CX = (ITM_P0[0] + ITM_P1[0]) * 0.5;
const ITM_CZ = (ITM_P0[1] + ITM_P1[1]) * 0.5;
const ITM_LEN = Math.hypot(ITM_P1[0] - ITM_P0[0], ITM_P1[1] - ITM_P0[1]);
const ITM_UX = (ITM_P1[0] - ITM_P0[0]) / ITM_LEN;
const ITM_UZ = (ITM_P1[1] - ITM_P0[1]) / ITM_LEN;
const ITM_RX = -ITM_UZ;
const ITM_RZ = ITM_UX;

const KIX1_CENTER = localXZ(34.4273, 135.2440);
const KIX2_CENTER = localXZ(34.4399, 135.2231);
const UKB_CENTER = localXZ(34.6327, 135.2239);

/** Keep procedural trees off active airport runways, taxiways and aprons (Itami, KIX, Kobe Airport). */
export function inAirportClearing(x: number, z: number): boolean {
  // Itami Airport (exact 32L/32R + terminal & maintenance aprons)
  {
    const dx = x - ITM_CX, dz = z - ITM_CZ;
    if (Math.abs(dx) < 2300 && Math.abs(dz) < 2300) {
      const along = dx * ITM_UX + dz * ITM_UZ;
      const across = dx * ITM_RX + dz * ITM_RZ;
      if (along > -1760 && along < 2160 && across > -220 && across < 690) return true;
    }
  }
  // KIX Islands 1 & 2
  for (const [c, aMin, aMax] of [[KIX1_CENTER, -1160, 340], [KIX2_CENTER, -520, 920]] as const) {
    const dx = x - c[0], dz = z - c[1];
    if (Math.abs(dx) < 3500 && Math.abs(dz) < 3500) {
      const along = dx * 0.78 - dz * 0.62;
      const across = dx * 0.62 + dz * 0.78;
      if (Math.abs(along) < 2450 && across > aMin && across < aMax) return true;
    }
  }
  // Kobe Airport island
  {
    const dx = x - UKB_CENTER[0], dz = z - UKB_CENTER[1];
    if (Math.abs(dx) < 1720 && dz > -720 && dz < 380) return true;
  }
  return false;
}

/**
 * Mask generic PLATEAU blocks inside bespoke Itami Terminal, ATC Tower, and Maintenance Hangar footprints
 * (so our detailed terminals, jet bridges & arched hangars never collide with plain grey boxes).
 */
export function inAirportBuildingMask(x: number, z: number): boolean {
  const dx = x - ITM_CX, dz = z - ITM_CZ;
  if (Math.abs(dx) > 2200 || Math.abs(dz) > 2200) return false;
  const along = dx * ITM_UX + dz * ITM_UZ;
  const across = dx * ITM_RX + dz * ITM_RZ;
  // Terminal complex + fingers + ATC tower + forecourt parking (along -520..+680, across 370..685)
  if (along > -520 && along < 680 && across > 370 && across < 685) return true;
  // South ANA maintenance hangars (along -1320..-620, across 255..530)
  if (along > -1320 && along < -620 && across > 255 && across < 530) return true;
  // North JAL maintenance hangars & cargo (along +720..+1560, across 340..610)
  if (along > 720 && along < 1560 && across > 340 && across < 610) return true;
  return false;
}
