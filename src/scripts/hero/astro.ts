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

/** The moon's ecliptic position with the largest periodic terms (Meeus ch. 47), good to ~0.3°. */
function moonEcliptic(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const Mm = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const D = RAD * (297.85 + 12.190749 * d);
  const Ms = RAD * (357.5291 + 0.98560028 * d);
  const lon =
    L +
    RAD *
      (6.289 * Math.sin(Mm) +
        1.274 * Math.sin(2 * D - Mm) + // evection
        0.658 * Math.sin(2 * D) + // variation
        0.214 * Math.sin(2 * Mm) -
        0.186 * Math.sin(Ms) - // annual equation
        0.114 * Math.sin(2 * F));
  const lat =
    RAD *
    (5.128 * Math.sin(F) + 0.281 * Math.sin(Mm + F) + 0.278 * Math.sin(Mm - F) + 0.173 * Math.sin(2 * D - F));
  return { lon, lat };
}

const SYNODIC = 29.530588;
const TAU = 2 * Math.PI;
/** Moon minus sun ecliptic longitude, 0..2π: 0 at new moon, π at full. */
const elongation = (d: number) => ((((moonEcliptic(d).lon - sunEcliptic(d)) % TAU) + TAU) % TAU);

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
  // seen from the ground rather than the earth's centre the moon sits up to ~0.95° lower (parallax)
  pos.altitude -= 0.0166 * Math.cos(pos.altitude);
  // atmospheric refraction near the horizon
  const h = Math.max(pos.altitude, 0);
  pos.altitude += 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));

  const elong = elongation(d);
  return {
    ...pos,
    phase: elong / TAU,
    age: moonAge(date),
    illumination: (1 - Math.cos(elong)) / 2,
  };
}

/** 月齢: days since the last new moon (the moon's elongation passing 0°), 0..~29.5. */
export function moonAge(date: Date) {
  const d = toDays(date);
  // start from the mean rate, then correct the new-moon time a few times
  let t = d - (elongation(d) / TAU) * SYNODIC;
  for (let i = 0; i < 4; i++) {
    let e = elongation(t);
    if (e > Math.PI) e -= TAU;
    t -= (e / TAU) * SYNODIC;
  }
  // the guess can land on the next new moon when the moon is only hours old
  if (t > d) t -= SYNODIC;
  return d - t;
}

/** Japanese name for a moon age. */
export function moonPhaseName(age: number, en = false) {
  const names: [number, string, string][] = [
    [1.5, '新月', 'New moon'],
    [5.5, '三日月', 'Crescent'],
    [9, '上弦', 'First quarter'],
    [13.5, '十三夜', 'Waxing gibbous'],
    [16.5, '満月', 'Full moon'],
    [20.5, '寝待月', 'Waning gibbous'],
    [24, '下弦', 'Last quarter'],
    [28, '有明月', 'Waning crescent'],
    [Infinity, '新月', 'New moon'],
  ];
  const hit = names.find(([to]) => age < to)!;
  return en ? hit[2] : hit[1];
}

/**
 * Moonrise and moonset (minutes past midnight JST) on the JST day of `ref`, when the moon's
 * upper edge meets the horizon. NaN when the moon does not rise (or set) that day, as happens
 * about once a month.
 */
export function moonTimes(ref: Date) {
  const h0 = -0.26 * RAD;
  const alt = (m: number) => moonPosition(jstDateAt(ref, m)).altitude - h0;
  let rise = NaN;
  let set = NaN;
  let prev = alt(0);
  for (let m = 15; m <= 1440; m += 15) {
    const cur = alt(m);
    if (Math.sign(cur) !== Math.sign(prev)) {
      let lo = m - 15;
      let hi = m;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(alt(mid)) === Math.sign(alt(lo))) lo = mid;
        else hi = mid;
      }
      if (cur > 0) rise = (lo + hi) / 2;
      else set = (lo + hi) / 2;
    }
    prev = cur;
  }
  return { rise, set };
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

/**
 * Sunrise and sunset (minutes past midnight JST) on the JST day of `ref`,
 * when the sun's upper edge meets the horizon (altitude −0.833°).
 */
export function sunTimes(ref: Date) {
  const h0 = -0.833 * RAD;
  const alt = (m: number) => sunPosition(jstDateAt(ref, m)).altitude - h0;
  const find = (from: number, to: number) => {
    // coarse scan, then halve the bracket
    let a = from;
    for (let m = from + 10; m <= to; m += 10) {
      if (Math.sign(alt(m)) !== Math.sign(alt(a))) {
        let lo = a;
        let hi = m;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(alt(mid)) === Math.sign(alt(lo))) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }
      a = m;
    }
    return NaN;
  };
  return { sunrise: find(180, 720), sunset: find(720, 1260) };
}
