import type { BackdropId } from '../assets';
import type { SubjectId } from '../subjects';
import { distanceText } from '../optics';
import type { Angle, StudioSettings } from './camera';
import type { FlashState, LightSpec } from './lights';

/**
 * お題: small shooting tests. Each one puts the photographer somewhere with the wrong
 * gear or settings on purpose, and checks the picture they take.
 */

export interface Setup {
  place: BackdropId;
  subject: SubjectId;
  settings: Partial<StudioSettings>;
  angle?: Angle;
  dist: number;
  yaw?: number;
  look?: { x: number; y: number };
  flash?: Partial<FlashState>;
  lights?: Partial<LightSpec>[];
  pinwheel?: boolean;
}

export interface ShotFacts {
  place: BackdropId;
  subject: SubjectId;
  mm: number;
  N: number;
  t: number;
  iso: number;
  tripod: boolean;
  filterStops: number;
  focus: number;
  /** Camera to subject (m). */
  distance: number;
  subjectSharp: boolean;
  meter: number;
  clipped: number;
  stack: { count: number; mode: 'lighten' | 'average' } | null;
  meteors: number;
  sunInFrame: boolean;
  lights: number;
  flashOn: boolean;
  flashShort: boolean;
  pinwheel: boolean;
}

export interface Mission {
  id: string;
  place: string;
  title: string;
  goal: string;
  setup: Setup;
  /** What is still missing (empty when passed). */
  check(f: ShotFacts): string[];
}

const exposed = (f: ShotFacts, tol = 0.8) => (Math.abs(f.meter) <= tol ? [] : [f.meter > 0 ? '明るすぎる' : '暗すぎる']);

export const MISSIONS: Mission[] = [
  {
    id: 'macro',
    place: '花畑',
    title: '一輪に寄って撮る（マクロ）',
    goal: 'コスモス1輪を画面いっぱいに。花の芯にピントを合わせ、風でブレないように。',
    setup: { place: 'flowers', subject: 'flower', settings: { lens: 'kit', mm: 50, N: 5.6, t: 1 / 250, iso: 200, hold: 'hand' }, angle: 'high', dist: 1.4 },
    check: (f) => [
      ...(f.place === 'flowers' && f.subject === 'flower' ? [] : ['花畑のコスモスを撮る']),
      ...(f.distance <= 0.4 ? [] : [`もっと寄る（いま ${distanceText(f.distance)}、40cm 以内に）`]),
      ...(f.subjectSharp ? [] : ['花の芯にピントを合わせる']),
      ...(f.t <= 1 / 125 ? [] : ['風で揺れるので 1/125 より速く']),
      ...exposed(f),
    ],
  },
  {
    id: 'field',
    place: '花畑',
    title: '花畑の全体を入れる',
    goal: '広角で、手前の花から奥の山までくっきり写す。',
    setup: { place: 'flowers', subject: 'flower', settings: { lens: 'tele', mm: 135, N: 2.8, t: 1 / 1000, iso: 100, hold: 'hand' }, angle: 'level', dist: 2.5 },
    check: (f) => [
      ...(f.place === 'flowers' ? [] : ['花畑で撮る']),
      ...(f.mm <= 24 ? [] : ['24mm 以下の広角にする']),
      ...(f.N >= 8 ? [] : ['F8 以上に絞って奥までピントを']),
      ...(f.distance >= 1.5 ? [] : ['少し下がる']),
      ...exposed(f),
    ],
  },
  {
    id: 'milky',
    place: '星空',
    title: '天の川を点の星で撮る',
    goal: '星が流れない長さで、天の川を明るく。ピントは無限遠（∞）。',
    setup: { place: 'stars', subject: 'tree', settings: { lens: 'kit', mm: 28, N: 3.5, t: 1 / 60, iso: 800, hold: 'hand', focusMode: 'af' }, angle: 'level', dist: 14, yaw: Math.PI, look: { x: 0, y: 0.32 } },
    check: (f) => [
      ...(f.place === 'stars' ? [] : ['星空の高原で撮る']),
      ...(f.tripod ? [] : ['三脚に載せる']),
      ...(f.focus >= 30 ? [] : ['ピントを ∞ に（MF）']),
      ...(f.t <= (500 / f.mm) * 1.05 ? [] : [`星が流れない ${Math.floor(500 / f.mm)}秒以内に`]),
      ...exposed(f, 1),
    ],
  },
  {
    id: 'trails',
    place: '星空',
    title: '星の軌跡（ぐるぐる）を撮る',
    goal: '北の空を向き、インターバル撮影で何十枚も撮って「比較明」で重ねる。',
    setup: { place: 'stars', subject: 'tree', settings: { lens: 'astro', mm: 14, N: 1.8, t: 20, iso: 1600, hold: 'tripod', focusMode: 'mf', mf: 100 }, angle: 'level', dist: 16, yaw: Math.PI, look: { x: 0, y: 0.3 } },
    check: (f) => [
      ...(f.place === 'stars' ? [] : ['星空の高原で撮る']),
      ...(f.stack && f.stack.mode === 'lighten' && f.stack.count >= 30 ? [] : ['インターバル撮影 30枚以上・比較明合成']),
      ...(f.tripod ? [] : ['三脚に載せる']),
      ...(f.focus >= 30 ? [] : ['ピントを ∞ に']),
    ],
  },
  {
    id: 'meteor',
    place: '星空',
    title: '流れ星を写す',
    goal: '流れ星はいつ流れるか分からない。長く開けて何枚も撮り、写った1枚を残す。',
    setup: { place: 'stars', subject: 'tree', settings: { lens: 'astro', mm: 14, N: 1.8, t: 20, iso: 3200, hold: 'tripod', focusMode: 'mf', mf: 100 }, angle: 'level', dist: 16, yaw: Math.PI * 0.75, look: { x: 0, y: 0.35 } },
    check: (f) => [...(f.place === 'stars' ? [] : ['星空の高原で撮る']), ...(f.meteors > 0 ? [] : ['流れ星が写っていない（インターバル撮影だと確率が上がる）'])],
  },
  {
    id: 'bokeh',
    place: '夜の街',
    title: '夜景を玉ボケにする',
    goal: '被写体に近づき、F値を小さく。後ろの街の光を大きな丸いボケに。',
    setup: { place: 'night', subject: 'bust', settings: { lens: 'kit', mm: 28, N: 8, t: 1 / 15, iso: 1600, hold: 'hand' }, angle: 'level', dist: 3.2 },
    check: (f) => [
      ...(f.place === 'night' || f.place === 'street' ? [] : ['夜の街か路地で撮る']),
      ...(f.N <= 2.8 ? [] : ['F2.8 以下に開ける']),
      ...(f.mm >= 50 ? [] : ['50mm 以上にする']),
      ...(f.subjectSharp ? [] : ['被写体にピントを']),
      ...exposed(f),
    ],
  },
  {
    id: 'sunstar',
    place: '秋の逆光',
    title: '太陽を光条（光の筋）にする',
    goal: '太陽を画面に入れて、絞ってウニのような光条を出す。',
    setup: { place: 'autumn', subject: 'horse', settings: { lens: 'std', mm: 35, N: 2.8, t: 1 / 1000, iso: 100, hold: 'tripod' }, angle: 'level', dist: 1.4, look: { x: -0.12, y: 0.1 } },
    check: (f) => [
      ...(f.place === 'autumn' || f.place === 'flowers' || f.place === 'street' ? [] : ['秋の林か花畑で撮る（太陽が写る場所）']),
      ...(f.sunInFrame ? [] : ['太陽を画面に入れる']),
      ...(f.N >= 11 ? [] : ['F11 以上に絞る']),
      ...exposed(f, 1.2),
    ],
  },
  {
    id: 'snow',
    place: '雪の森',
    title: '雪を白く写す',
    goal: 'カメラまかせだと雪は灰色になる。メーターを＋1段くらいにして、白い雪に。',
    setup: { place: 'snow', subject: 'mannequin', settings: { lens: 'std', mm: 50, N: 8, t: 1 / 1000, iso: 100, hold: 'hand' }, angle: 'level', dist: 3.4 },
    check: (f) => [
      ...(f.place === 'snow' ? [] : ['雪の森で撮る']),
      ...(f.meter >= 0.5 && f.meter <= 1.7 ? [] : [f.meter < 0.5 ? 'もっと明るく（メーター＋1段前後）' : '明るすぎ（＋1.7段まで）']),
      ...(f.clipped < 0.15 ? [] : ['白飛びしすぎ']),
    ],
  },
  {
    id: 'light',
    place: 'スタジオ',
    title: '2灯でライティング',
    goal: '暗いスタジオで、メインのライトと反対側の補助ライトを置いて、影をやわらげる。',
    setup: { place: 'lightroom', subject: 'bust', settings: { lens: 'portrait', mm: 85, N: 4, t: 1 / 125, iso: 400, hold: 'tripod' }, angle: 'level', dist: 1.6, lights: [{ kind: 'soft', x: -1.1, z: 0.9, level: 1 }] },
    check: (f) => [
      ...(f.place === 'lightroom' ? [] : ['ライティングスタジオで撮る']),
      ...(f.lights >= 2 ? [] : ['ライトを2灯にする（真上の図の「＋ライト」）']),
      ...(f.iso <= 400 ? [] : ['ISO 400 以下で']),
      ...exposed(f, 0.7),
    ],
  },
  {
    id: 'slowsync',
    place: '夜の路地',
    title: 'フラッシュで人も夜景も写す',
    goal: 'フラッシュで手前を照らし、シャッターを遅くして背景の明かりも写す（スローシンクロ）。',
    setup: { place: 'street', subject: 'mannequin', settings: { lens: 'std', mm: 35, N: 4, t: 1 / 250, iso: 800, hold: 'tripod' }, angle: 'level', dist: 3.2, flash: { mode: 'off' } },
    check: (f) => [
      ...(f.place === 'street' || f.place === 'night' ? [] : ['夜の路地か夜の街で撮る']),
      ...(f.flashOn ? [] : ['フラッシュを使う']),
      ...(f.flashShort ? ['フラッシュが届いていない'] : []),
      ...(f.t >= 1 / 15 ? [] : ['シャッターを 1/15 より遅く']),
      ...exposed(f, 1),
    ],
  },
  {
    id: 'pinwheel',
    place: '日本庭園',
    title: '昼間に風車を流して写す',
    goal: '明るい昼でも、ND フィルターで光を減らせば遅いシャッターが使える。',
    setup: { place: 'garden', subject: 'bust', settings: { lens: 'std', mm: 50, N: 8, t: 1 / 250, iso: 100, hold: 'hand' }, angle: 'level', dist: 2.2, pinwheel: true },
    check: (f) => [
      ...(f.place === 'garden' || f.place === 'flowers' || f.place === 'autumn' ? [] : ['昼の場所で撮る']),
      ...(f.pinwheel ? [] : ['風車を置く']),
      ...(f.t >= 1 / 4 ? [] : ['シャッターを 1/4 秒より遅く']),
      ...(f.tripod ? [] : ['三脚に載せる']),
      ...(f.filterStops >= 3 ? [] : ['ND フィルターを付ける']),
      ...exposed(f),
    ],
  },
];
