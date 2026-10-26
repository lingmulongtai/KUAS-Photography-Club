import type { FilterEffect, LensCharacter } from './pipeline';
import type { Text } from './i18n';

/**
 * Lenses and filters for the studio. The lenses are typical ones a club member
 * meets (a kit zoom, the cheap 50mm, pro zooms, a macro, a fast wide prime for stars);
 * their flaws are exaggerated a little so that they show on a phone screen.
 */

export type LensId = 'kit' | 'fifty' | 'wide' | 'std' | 'tele' | 'portrait' | 'macro' | 'astro' | 'free';

export type Grade = 'entry' | 'standard' | 'pro' | 'special' | 'ideal';

export const GRADES: Record<Grade, Text> = {
  entry: { ja: '入門', en: 'Entry' },
  standard: { ja: '定番', en: 'Standard' },
  pro: { ja: '高級', en: 'Pro' },
  special: { ja: '特殊', en: 'Special' },
  ideal: { ja: '理想', en: 'Ideal' },
};

export interface Lens {
  id: LensId;
  name: Text;
  /** A short label for chips. */
  short: Text;
  grade: Grade;
  min: number;
  max: number;
  /** Widest f-number at the wide and the long end (a kit zoom gets darker as it zooms). */
  fmin: [number, number];
  /** Largest magnification (1 = life size); sets how close it can focus. */
  maxMag: number;
  blades: number;
  character: Omit<LensCharacter, 'fmin'>;
  note: Text;
}

export const LENSES: Lens[] = [
  {
    id: 'kit',
    name: { ja: 'キットズーム 28–85mm F3.5–5.6', en: 'Kit zoom 28–85mm f/3.5–5.6' },
    short: { ja: 'キットズーム', en: 'Kit zoom' },
    grade: 'entry',
    min: 28,
    max: 85,
    fmin: [3.5, 5.6],
    maxMag: 0.3,
    blades: 7,
    character: { ca: 0.0032, soft: 2.4, vignette: 0.55, flare: 1 },
    note: {
      ja: 'カメラについてくる安いズーム。開放だと四隅がにじみ、輪郭に色ズレ（フリンジ）が出る。逆光に弱い。',
      en: 'The cheap zoom that comes with the camera. Wide open the corners are soft and edges get coloured fringes. Weak against the light.',
    },
  },
  {
    id: 'fifty',
    name: { ja: '単焦点 50mm F1.8', en: '50mm f/1.8 prime' },
    short: { ja: '50mm F1.8', en: '50mm f/1.8' },
    grade: 'entry',
    min: 50,
    max: 50,
    fmin: [1.8, 1.8],
    maxMag: 0.15,
    blades: 7,
    character: { ca: 0.0016, soft: 1.4, vignette: 0.5, flare: 0.6 },
    note: {
      ja: '安くて明るい「撒き餌レンズ」。ボケは大きいが、開放では少し甘く、絞ると7角形の光条が出る。',
      en: 'The cheap, bright “nifty fifty”. Big bokeh, a little soft wide open, and seven-sided sunstars when stopped down.',
    },
  },
  {
    id: 'wide',
    name: { ja: '広角ズーム 16–35mm F4', en: 'Wide zoom 16–35mm f/4' },
    short: { ja: '広角ズーム', en: 'Wide zoom' },
    grade: 'standard',
    min: 16,
    max: 35,
    fmin: [4, 4],
    maxMag: 0.23,
    blades: 9,
    character: { ca: 0.0011, soft: 0.6, vignette: 0.45, flare: 0.5 },
    note: { ja: '風景や建物に。広く写り、手前のものが大きく、奥が小さく写る。', en: 'For landscapes and buildings. Takes in a lot; near things look big and far things small.' },
  },
  {
    id: 'std',
    name: { ja: '標準ズーム 24–70mm F2.8', en: 'Standard zoom 24–70mm f/2.8' },
    short: { ja: '標準ズーム F2.8', en: 'Std zoom f/2.8' },
    grade: 'pro',
    min: 24,
    max: 70,
    fmin: [2.8, 2.8],
    maxMag: 0.25,
    blades: 9,
    character: { ca: 0.0005, soft: 0.3, vignette: 0.3, flare: 0.3 },
    note: {
      ja: 'プロの定番。どの焦点距離でも F2.8 で、開放から四隅までシャープ。コーティングが良くフレアが少ない。',
      en: 'The professional workhorse: f/2.8 at every focal length, sharp to the corners wide open, good coatings and little flare.',
    },
  },
  {
    id: 'tele',
    name: { ja: '望遠ズーム 70–200mm F2.8', en: 'Telephoto zoom 70–200mm f/2.8' },
    short: { ja: '望遠ズーム', en: 'Tele zoom' },
    grade: 'pro',
    min: 70,
    max: 200,
    fmin: [2.8, 2.8],
    maxMag: 0.21,
    blades: 9,
    character: { ca: 0.0005, soft: 0.3, vignette: 0.25, flare: 0.3 },
    note: {
      ja: '遠くのものを大きく。背景が圧縮されて迫り、ボケも大きい。手ぶれしやすいので速いシャッターで。',
      en: 'Makes distant things big. The background is compressed and blurs a lot. Shake shows easily, so use a fast shutter.',
    },
  },
  {
    id: 'portrait',
    name: { ja: '単焦点 85mm F1.4', en: '85mm f/1.4 prime' },
    short: { ja: '85mm F1.4', en: '85mm f/1.4' },
    grade: 'pro',
    min: 85,
    max: 85,
    fmin: [1.4, 1.4],
    maxMag: 0.12,
    blades: 11,
    character: { ca: 0.0007, soft: 0.6, vignette: 0.45, flare: 0.35 },
    note: { ja: '人物の定番。とろけるようなボケ。最短撮影距離が 85cm ほどと長い。', en: 'The portrait classic, with creamy bokeh. It cannot focus closer than about 85 cm.' },
  },
  {
    id: 'macro',
    name: { ja: 'マクロ 100mm F2.8（等倍）', en: 'Macro 100mm f/2.8 (1:1)' },
    short: { ja: 'マクロ100mm', en: 'Macro 100mm' },
    grade: 'special',
    min: 100,
    max: 100,
    fmin: [2.8, 2.8],
    maxMag: 1,
    blades: 9,
    character: { ca: 0.0004, soft: 0.25, vignette: 0.25, flare: 0.35 },
    note: {
      ja: '実物と同じ大きさまで寄れる（等倍）。寄るとピントの合う幅が数ミリになり、実効F値も暗くなる。',
      en: 'Focuses close enough to show things life size (1:1). Up close the zone of focus is a few millimetres and the effective f-number gets darker.',
    },
  },
  {
    id: 'astro',
    name: { ja: '超広角 単焦点 14mm F1.8', en: 'Ultra-wide 14mm f/1.8 prime' },
    short: { ja: '14mm F1.8', en: '14mm f/1.8' },
    grade: 'special',
    min: 14,
    max: 14,
    fmin: [1.8, 1.8],
    maxMag: 0.1,
    blades: 9,
    character: { ca: 0.0012, soft: 1, vignette: 0.75, flare: 0.5 },
    note: {
      ja: '星景写真の定番。暗い星まで写せる明るさと、空を大きく入れる広さ。周辺は暗くなりやすい。',
      en: 'The night-sky favourite: bright enough for faint stars and wide enough for a big sky. The corners tend to go dark.',
    },
  },
  {
    id: 'free',
    name: { ja: '何でもレンズ 14–200mm F1.4（等倍）', en: 'Anything lens 14–200mm f/1.4 (1:1)' },
    short: { ja: '何でもレンズ', en: 'Anything lens' },
    grade: 'ideal',
    min: 14,
    max: 200,
    fmin: [1.4, 1.4],
    maxMag: 1,
    blades: 9,
    character: { ca: 0, soft: 0, vignette: 0.2, flare: 0.3 },
    note: { ja: '実在しない理想のレンズ。設定の違いだけを見たいときに。', en: 'An ideal lens that does not exist, for when you only want to see what the settings do.' },
  },
];

export const lensById = (id: LensId) => LENSES.find((l) => l.id === id) ?? LENSES[0];

/** Widest f-number at this focal length. */
export function widest(lens: Lens, mm: number) {
  if (lens.max === lens.min) return lens.fmin[0];
  const k = Math.log(mm / lens.min) / Math.log(lens.max / lens.min);
  const f = lens.fmin[0] * (lens.fmin[1] / lens.fmin[0]) ** Math.min(1, Math.max(0, k));
  // round to the third stops a camera shows
  const thirds = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6];
  return thirds.reduce((a, b) => (Math.abs(Math.log(b / f)) < Math.abs(Math.log(a / f)) ? b : a));
}

/** Closest focus distance (m from the lens) at this focal length: u = f(1 + 1/m). */
export const closestFocus = (lens: Lens, mm: number) => (mm / 1000) * (1 + 1 / lens.maxMag);

export const lensCharacter = (lens: Lens, mm: number): LensCharacter => ({ ...lens.character, fmin: widest(lens, mm) });

export type FilterId = 'none' | 'nd8' | 'nd64' | 'nd1000' | 'cpl' | 'soft' | 'black' | 'white' | 'cross';

export interface Filter {
  id: FilterId;
  name: Text;
  /** Light it takes away, in stops. */
  stops: number;
  effect: FilterEffect | null;
  /** Darkens a blue sky (polariser). */
  polarizer?: boolean;
  note: Text;
}

const none: FilterEffect = { glow: 0, haze: 0, bloom: 0, lift: 0, cross: 0, crossLines: 2, sat: 0 };

export const FILTERS: Filter[] = [
  { id: 'none', name: { ja: 'なし', en: 'None' }, stops: 0, effect: null, note: { ja: '', en: '' } },
  {
    id: 'nd8',
    name: { ja: 'ND8', en: 'ND8' },
    stops: 3,
    effect: null,
    note: {
      ja: '光を 1/8（3段）に減らす。明るい場所で絞りを開けたい、少し遅いシャッターを使いたいときに。',
      en: 'Cuts the light to 1/8 (3 stops), for a wide aperture or a slightly slower shutter in bright light.',
    },
  },
  {
    id: 'nd64',
    name: { ja: 'ND64', en: 'ND64' },
    stops: 6,
    effect: null,
    note: { ja: '光を 1/64（6段）に。日中でも 1/2 秒くらいのスローシャッターができる。', en: 'Cuts the light to 1/64 (6 stops): about 1/2 s even in daylight.' },
  },
  {
    id: 'nd1000',
    name: { ja: 'ND1000', en: 'ND1000' },
    stops: 10,
    effect: null,
    note: {
      ja: '光を 1/1000（10段）に。昼でも数秒〜30秒の長秒露光。動くものが消え、雲や水が流れる。',
      en: 'Cuts the light to 1/1000 (10 stops): exposures of seconds even at noon. Moving things vanish; clouds and water flow.',
    },
  },
  {
    id: 'cpl',
    name: { ja: 'C-PL（偏光）', en: 'CPL (polariser)' },
    stops: 1.5,
    effect: { ...none, sat: 0.22 },
    polarizer: true,
    note: {
      ja: '反射を取り、青空を濃くする。回すと効き方が変わり、太陽から90°の方向の空でいちばん効く。',
      en: 'Removes reflections and deepens a blue sky. Turn it to change the effect; it works best on the sky 90° from the sun.',
    },
  },
  {
    id: 'soft',
    name: { ja: 'ソフト', en: 'Soft' },
    stops: 0,
    effect: { ...none, glow: 0.38, bloom: 0.5 },
    note: { ja: '全体をふんわりにじませる。ポートレートや花を柔らかく。', en: 'A gentle glow over everything, for soft portraits and flowers.' },
  },
  {
    id: 'black',
    name: { ja: 'ブラックミスト', en: 'Black mist' },
    stops: 0,
    effect: { ...none, haze: 0.07, bloom: 0.55 },
    note: {
      ja: '光のまわりだけをにじませ、黒は締まったまま。映画のような空気感。夜景のライトに効く。',
      en: 'Blooms only around lights and keeps blacks deep, for a filmic look. Great on night lights.',
    },
  },
  {
    id: 'white',
    name: { ja: 'ホワイトミスト', en: 'White mist' },
    stops: 0,
    effect: { ...none, haze: 0.3, bloom: 0.35, lift: 0.05 },
    note: { ja: '霧がかかったように白っぽく、コントラストが下がる。やさしい雰囲気に。', en: 'A misty, milky look with lower contrast, for a gentle mood.' },
  },
  {
    id: 'cross',
    name: { ja: 'クロス（4本）', en: 'Cross (4 points)' },
    stops: 0,
    effect: { ...none, cross: 1, crossLines: 2 },
    note: { ja: '光の点から十字の光条が伸びる。夜景やイルミネーションで。', en: 'Points of light grow four-pointed stars. For night scenes and illuminations.' },
  },
];

export const filterById = (id: FilterId) => FILTERS.find((f) => f.id === id) ?? FILTERS[0];
