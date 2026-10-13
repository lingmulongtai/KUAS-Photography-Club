import * as THREE from 'three';

/**
 * How Kyoto's sky and light look at a given sun altitude.
 * Nights are kept a deep blue rather than black, so the city and the shooting stars read.
 * Values are art-directed keyframes (sRGB hex, converted to linear by three.js)
 * and interpolated linearly between keys.
 */
interface Key {
  alt: number;
  zenith: string;
  mid: string;
  horizon: string;
  /** Color of the glow around the sun and of the horizon band under it. */
  glow: string;
  glowAmt: number;
  /** Direct sunlight color and intensity. */
  sun: string;
  sunAmt: number;
  /** Light on the underside of clouds. */
  cloud: string;
  cloudAmt: number;
  stars: number;
  /** Street lights and lit windows (0..1). */
  city: number;
  exposure: number;
  bloom: number;
}

const KEYS: Key[] = [
  { alt: -90, zenith: '#060f29', mid: '#0c1b43', horizon: '#1d2f63', glow: '#000000', glowAmt: 0, sun: '#000000', sunAmt: 0, cloud: '#000000', cloudAmt: 0, stars: 1, city: 1, exposure: 1.5, bloom: 1 },
  { alt: -18, zenith: '#07112d', mid: '#0e2049', horizon: '#22366e', glow: '#1a2244', glowAmt: 0.06, sun: '#000000', sunAmt: 0, cloud: '#000000', cloudAmt: 0, stars: 1, city: 1, exposure: 1.5, bloom: 1 },
  { alt: -12, zenith: '#08142f', mid: '#122450', horizon: '#2a3f7a', glow: '#33326a', glowAmt: 0.2, sun: '#000000', sunAmt: 0, cloud: '#1c1e3c', cloudAmt: 0.25, stars: 0.85, city: 1, exposure: 1.42, bloom: 0.95 },
  { alt: -8, zenith: '#091740', mid: '#1e3478', horizon: '#4a5a9e', glow: '#7a5aa2', glowAmt: 0.4, sun: '#000000', sunAmt: 0, cloud: '#6c4c8e', cloudAmt: 0.6, stars: 0.4, city: 0.95, exposure: 1.2, bloom: 0.8 },
  { alt: -4, zenith: '#132460', mid: '#46468c', horizon: '#d4787a', glow: '#ff7a52', glowAmt: 0.75, sun: '#000000', sunAmt: 0, cloud: '#ff6878', cloudAmt: 1.1, stars: 0.1, city: 0.8, exposure: 1.1, bloom: 0.7 },
  { alt: -1, zenith: '#1d3272', mid: '#86588e', horizon: '#ff965a', glow: '#ff8a40', glowAmt: 1, sun: '#ff6a28', sunAmt: 0.4, cloud: '#ff7a44', cloudAmt: 1.4, stars: 0, city: 0.55, exposure: 1, bloom: 0.6 },
  { alt: 2, zenith: '#28488a', mid: '#ad7290', horizon: '#ffad68', glow: '#ffa050', glowAmt: 1, sun: '#ff9446', sunAmt: 1.6, cloud: '#ffae6c', cloudAmt: 1.5, stars: 0, city: 0.25, exposure: 0.9, bloom: 0.5 },
  { alt: 6, zenith: '#30609e', mid: '#c49898', horizon: '#f2b98a', glow: '#ffc890', glowAmt: 0.62, sun: '#ffbc7c', sunAmt: 2.4, cloud: '#ffdcb0', cloudAmt: 1.3, stars: 0, city: 0.05, exposure: 0.66, bloom: 0.3 },
  { alt: 15, zenith: '#3970b6', mid: '#88aed6', horizon: '#cfd9e2', glow: '#fff0d8', glowAmt: 0.28, sun: '#ffeedb', sunAmt: 3, cloud: '#ffffff', cloudAmt: 1.15, stars: 0, city: 0, exposure: 0.64, bloom: 0.14 },
  { alt: 30, zenith: '#2e67b4', mid: '#76a6d6', horizon: '#c6daea', glow: '#fff6e8', glowAmt: 0.2, sun: '#fff6ec', sunAmt: 3.2, cloud: '#ffffff', cloudAmt: 1.1, stars: 0, city: 0, exposure: 0.68, bloom: 0.12 },
  { alt: 90, zenith: '#2a62b0', mid: '#70a2d4', horizon: '#c2d8ea', glow: '#fff8f0', glowAmt: 0.18, sun: '#fff8f0', sunAmt: 3.3, cloud: '#ffffff', cloudAmt: 1.1, stars: 0, city: 0, exposure: 0.66, bloom: 0.12 },
];

const COLOR_FIELDS = ['zenith', 'mid', 'horizon', 'glow', 'sun', 'cloud'] as const;
const NUM_FIELDS = ['glowAmt', 'sunAmt', 'cloudAmt', 'stars', 'city', 'exposure', 'bloom'] as const;
type ColorField = (typeof COLOR_FIELDS)[number];
type NumField = (typeof NUM_FIELDS)[number];

export type Look = Record<ColorField, THREE.Color> & Record<NumField, number>;

const PARSED = KEYS.map((k) => {
  const out = { alt: k.alt } as { alt: number } & Look;
  for (const f of COLOR_FIELDS) out[f] = new THREE.Color(k[f]);
  for (const f of NUM_FIELDS) out[f] = k[f];
  return out;
});

export function createLook(): Look {
  const look = {} as Look;
  for (const f of COLOR_FIELDS) look[f] = new THREE.Color();
  for (const f of NUM_FIELDS) look[f] = 0;
  return look;
}

/** Fill `out` with the look for a sun altitude in degrees. */
export function lookAt(altDeg: number, out: Look): Look {
  let i = 0;
  while (i < PARSED.length - 2 && altDeg >= PARSED[i + 1].alt) i++;
  const a = PARSED[i];
  const b = PARSED[i + 1];
  const t = Math.min(1, Math.max(0, (altDeg - a.alt) / (b.alt - a.alt)));
  for (const f of COLOR_FIELDS) out[f].copy(a[f]).lerp(b[f], t);
  for (const f of NUM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * t;
  return out;
}

/** Share of windows lit at a given time (minutes past midnight, JST). */
export function windowsLit(minutes: number) {
  const h = minutes / 60;
  const pts: [number, number][] = [
    [0, 0.3], [1.5, 0.16], [4, 0.1], [6, 0.22], [8, 0.18], [12, 0.12],
    [16, 0.2], [18, 0.5], [21, 0.55], [23, 0.4], [24, 0.3],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    if (h <= pts[i + 1][0]) {
      const t = (h - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return 0.3;
}

/** Name of the light, as photographers say it. */
export function phaseName(altDeg: number, minutes: number) {
  if (altDeg < -12) return '夜';
  if (altDeg < -4) return 'ブルーアワー';
  if (altDeg < 6) return 'マジックアワー';
  if (altDeg < 20) return minutes < 720 ? '朝の光' : '夕方の光';
  return '昼';
}

/** Approximate color temperature of the light, for the HUD. */
export function kelvin(altDeg: number) {
  const pts: [number, number][] = [[-12, 12000], [-6, 9000], [-3, 4000], [0, 2500], [6, 3500], [15, 4800], [30, 5500], [90, 5800]];
  if (altDeg < -12) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (altDeg < pts[i + 1][0]) {
      const t = (altDeg - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return Math.round((pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t) / 100) * 100;
    }
  }
  return 5800;
}
