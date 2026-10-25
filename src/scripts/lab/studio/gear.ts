import type { FilterEffect, LensCharacter } from '../pipeline';

/**
 * Lenses and filters for the studio prototype. The lenses are typical ones a club member
 * meets (a kit zoom, the cheap 50mm, pro zooms, a macro, a fast wide prime for stars);
 * their flaws are exaggerated a little so that they show on a phone screen.
 */

export type LensId = 'kit' | 'fifty' | 'wide' | 'std' | 'tele' | 'portrait' | 'macro' | 'astro' | 'free';

export interface Lens {
  id: LensId;
  name: string;
  /** A short label for chips. */
  short: string;
  grade: '入門' | '定番' | '高級' | '特殊' | '試作';
  min: number;
  max: number;
  /** Widest f-number at the wide and the long end (a kit zoom gets darker as it zooms). */
  fmin: [number, number];
  /** Largest magnification (1 = life size); sets how close it can focus. */
  maxMag: number;
  blades: number;
  character: Omit<LensCharacter, 'fmin'>;
  note: string;
}

export const LENSES: Lens[] = [
  {
    id: 'kit',
    name: 'キットズーム 28–85mm F3.5–5.6',
    short: 'キットズーム',
    grade: '入門',
    min: 28,
    max: 85,
    fmin: [3.5, 5.6],
    maxMag: 0.3,
    blades: 7,
    character: { ca: 0.0032, soft: 2.4, vignette: 0.55, flare: 1 },
    note: 'カメラについてくる安いズーム。開放だと四隅がにじみ、輪郭に色ズレ（フリンジ）が出る。逆光に弱い。',
  },
  {
    id: 'fifty',
    name: '単焦点 50mm F1.8',
    short: '50mm F1.8',
    grade: '入門',
    min: 50,
    max: 50,
    fmin: [1.8, 1.8],
    maxMag: 0.15,
    blades: 7,
    character: { ca: 0.0016, soft: 1.4, vignette: 0.5, flare: 0.6 },
    note: '安くて明るい「撒き餌レンズ」。ボケは大きいが、開放では少し甘く、絞ると7角形の光条が出る。',
  },
  {
    id: 'wide',
    name: '広角ズーム 16–35mm F4',
    short: '広角ズーム',
    grade: '定番',
    min: 16,
    max: 35,
    fmin: [4, 4],
    maxMag: 0.23,
    blades: 9,
    character: { ca: 0.0011, soft: 0.6, vignette: 0.45, flare: 0.5 },
    note: '風景や建物に。広く写り、手前のものが大きく、奥が小さく写る。',
  },
  {
    id: 'std',
    name: '標準ズーム 24–70mm F2.8',
    short: '標準ズーム F2.8',
    grade: '高級',
    min: 24,
    max: 70,
    fmin: [2.8, 2.8],
    maxMag: 0.25,
    blades: 9,
    character: { ca: 0.0005, soft: 0.3, vignette: 0.3, flare: 0.3 },
    note: 'プロの定番。どの焦点距離でも F2.8 で、開放から四隅までシャープ。コーティングが良くフレアが少ない。',
  },
  {
    id: 'tele',
    name: '望遠ズーム 70–200mm F2.8',
    short: '望遠ズーム',
    grade: '高級',
    min: 70,
    max: 200,
    fmin: [2.8, 2.8],
    maxMag: 0.21,
    blades: 9,
    character: { ca: 0.0005, soft: 0.3, vignette: 0.25, flare: 0.3 },
    note: '遠くのものを大きく。背景が圧縮されて迫り、ボケも大きい。手ぶれしやすいので速いシャッターで。',
  },
  {
    id: 'portrait',
    name: '単焦点 85mm F1.4',
    short: '85mm F1.4',
    grade: '高級',
    min: 85,
    max: 85,
    fmin: [1.4, 1.4],
    maxMag: 0.12,
    blades: 11,
    character: { ca: 0.0007, soft: 0.6, vignette: 0.45, flare: 0.35 },
    note: '人物の定番。とろけるようなボケ。最短撮影距離が 85cm ほどと長い。',
  },
  {
    id: 'macro',
    name: 'マクロ 100mm F2.8（等倍）',
    short: 'マクロ100mm',
    grade: '特殊',
    min: 100,
    max: 100,
    fmin: [2.8, 2.8],
    maxMag: 1,
    blades: 9,
    character: { ca: 0.0004, soft: 0.25, vignette: 0.25, flare: 0.35 },
    note: '実物と同じ大きさまで寄れる（等倍）。寄るとピントの合う幅が数ミリになり、実効F値も暗くなる。',
  },
  {
    id: 'astro',
    name: '超広角 単焦点 14mm F1.8',
    short: '14mm F1.8',
    grade: '特殊',
    min: 14,
    max: 14,
    fmin: [1.8, 1.8],
    maxMag: 0.1,
    blades: 9,
    character: { ca: 0.0012, soft: 1, vignette: 0.75, flare: 0.5 },
    note: '星景写真の定番。暗い星まで写せる明るさと、空を大きく入れる広さ。周辺は暗くなりやすい。',
  },
  {
    id: 'free',
    name: '何でもレンズ（試作用：14–200mm F1.4・等倍）',
    short: '何でもレンズ',
    grade: '試作',
    min: 14,
    max: 200,
    fmin: [1.4, 1.4],
    maxMag: 1,
    blades: 9,
    character: { ca: 0, soft: 0, vignette: 0.2, flare: 0.3 },
    note: '実在しない理想のレンズ。設定の違いだけを見たいときに。',
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
  name: string;
  /** Light it takes away, in stops. */
  stops: number;
  effect: FilterEffect | null;
  /** Darkens a blue sky (polariser). */
  polarizer?: boolean;
  note: string;
}

const none: FilterEffect = { glow: 0, haze: 0, bloom: 0, lift: 0, cross: 0, crossLines: 2, sat: 0 };

export const FILTERS: Filter[] = [
  { id: 'none', name: 'なし', stops: 0, effect: null, note: '' },
  { id: 'nd8', name: 'ND8', stops: 3, effect: null, note: '光を 1/8（3段）に減らす。明るい場所で絞りを開けたい、少し遅いシャッターを使いたいときに。' },
  { id: 'nd64', name: 'ND64', stops: 6, effect: null, note: '光を 1/64（6段）に。日中でも 1/2 秒くらいのスローシャッターができる。' },
  { id: 'nd1000', name: 'ND1000', stops: 10, effect: null, note: '光を 1/1000（10段）に。昼でも数秒〜30秒の長秒露光。動くものが消え、雲や水が流れる。' },
  { id: 'cpl', name: 'C-PL（偏光）', stops: 1.5, effect: { ...none, sat: 0.22 }, polarizer: true, note: '反射を取り、青空を濃くする。回すと効き方が変わり、太陽から90°の方向の空でいちばん効く。' },
  { id: 'soft', name: 'ソフト', stops: 0, effect: { ...none, glow: 0.38, bloom: 0.5 }, note: '全体をふんわりにじませる。ポートレートや花を柔らかく。' },
  { id: 'black', name: 'ブラックミスト', stops: 0, effect: { ...none, haze: 0.07, bloom: 0.55 }, note: '光のまわりだけをにじませ、黒は締まったまま。映画のような空気感。夜景のライトに効く。' },
  { id: 'white', name: 'ホワイトミスト', stops: 0, effect: { ...none, haze: 0.3, bloom: 0.35, lift: 0.05 }, note: '霧がかかったように白っぽく、コントラストが下がる。やさしい雰囲気に。' },
  { id: 'cross', name: 'クロス（4本）', stops: 0, effect: { ...none, cross: 1, crossLines: 2 }, note: '光の点から十字の光条が伸びる。夜景やイルミネーションで。' },
];

export const filterById = (id: FilterId) => FILTERS.find((f) => f.id === id) ?? FILTERS[0];
