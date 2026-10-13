/**
 * Low-precision sun and moon positions for Kyoto (good to well under a degree),
 * after the formulas used by SunCalc / Astronomy Answers.
 * Angles in radians unless noted. Azimuth is a compass bearing: 0 = north, π/2 = east.
 */

export const KYOTO = { lat: 35.0116, lon: 135.7681 };

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J2000 = 2451545;
const OBLIQUITY = 23.4397 * RAD;

const toDays = (date: Date) => date.getTime() / DAY_MS + 2440587.5 - J2000;

function rightAscension(l: number, b: number) {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
}
function declination(l: number, b: number) {
  return Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
}
function siderealTime(d: number, lw: number) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}
function horizontal(H: number, phi: number, dec: number) {
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // azimuth from south, westward positive → compass bearing
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude, azimuth: fromSouth + Math.PI };
}

function sunEcliptic(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

function moonEcliptic(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  return { lon: L + RAD * 6.289 * Math.sin(M), lat: RAD * 5.128 * Math.sin(F) };
}

export interface SkyBody {
  altitude: number;
  azimuth: number;
}

export interface MoonState extends SkyBody {
  /** 0 = new, 0.5 = full */
  phase: number;
  /** Days since new moon (月齢), 0..29.5 */
  age: number;
  illumination: number;
}

export function sunPosition(date: Date, lat = KYOTO.lat, lon = KYOTO.lon): SkyBody {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const L = sunEcliptic(d);
  const ra = rightAscension(L, 0);
  const dec = declination(L, 0);
  return horizontal(siderealTime(d, lw) - ra, phi, dec);
}

export function moonPosition(date: Date, lat = KYOTO.lat, lon = KYOTO.lon): MoonState {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const m = moonEcliptic(d);
  const ra = rightAscension(m.lon, m.lat);
  const dec = declination(m.lon, m.lat);
  const pos = horizontal(siderealTime(d, lw) - ra, phi, dec);
  // atmospheric refraction near the horizon
  const h = Math.max(pos.altitude, 0);
  pos.altitude += 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));

  const elong = (((m.lon - sunEcliptic(d)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const phase = elong / (2 * Math.PI);
  return {
    ...pos,
    phase,
    age: phase * 29.530588,
    illumination: (1 - Math.cos(elong)) / 2,
  };
}

/** Local sidereal angle, used to turn the star sphere. */
export function localSiderealAngle(date: Date, lon = KYOTO.lon) {
  return siderealTime(toDays(date), RAD * -lon);
}

/**
 * Direction vector in scene space for an altitude/azimuth pair.
 * Scene axes: +x east, +y up, +z south.
 */
export function directionFrom(body: SkyBody): [number, number, number] {
  const c = Math.cos(body.altitude);
  return [c * Math.sin(body.azimuth), Math.sin(body.altitude), -c * Math.cos(body.azimuth)];
}

/** A Date for `minutes` past midnight Japan time on the same JST day as `ref`. */
export function jstDateAt(ref: Date, minutes: number) {
  const jst = new Date(ref.getTime() + 9 * 3600000);
  const midnightUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600000;
  return new Date(midnightUtc + minutes * 60000);
}

/** Minutes past midnight Japan time. */
export function jstMinutes(date: Date) {
  const jst = new Date(date.getTime() + 9 * 3600000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes() + jst.getUTCSeconds() / 60;
}

export function jstParts(date: Date) {
  const jst = new Date(date.getTime() + 9 * 3600000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}
