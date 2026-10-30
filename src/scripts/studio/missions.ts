import type { BackdropId } from './assets';
import type { SubjectId } from './subjects';
import { distanceText } from './optics.ts';
import type { Angle, StudioSettings } from './camera';
import type { FlashState, LightSpec } from './lights';
import type { Pick, Text } from './i18n';

/**
 * お題 (challenges): small shooting tests. Each one puts the photographer somewhere with the
 * wrong gear or settings on purpose, and checks the picture they take.
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
  place: Text;
  title: Text;
  goal: Text;
  setup: Setup;
  /** What is still missing (empty when passed), in the page's language. */
  check(f: ShotFacts, t: Pick): string[];
}

const exposed = (f: ShotFacts, t: Pick, tol = 0.8) => (Math.abs(f.meter) <= tol ? [] : [f.meter > 0 ? t('明るすぎる', 'too bright') : t('暗すぎる', 'too dark')]);

export const MISSIONS: Mission[] = [
  {
    id: 'macro',
    place: { ja: '花畑', en: 'Flower field' },
    title: { ja: '一輪に寄って撮る（マクロ）', en: 'Close up on one flower (macro)' },
    goal: { ja: 'コスモス1輪を画面いっぱいに。花の芯にピントを合わせ、風でブレないように。', en: 'Fill the frame with one cosmos, focus on its centre, and keep the wind from blurring it.' },
    setup: { place: 'flowers', subject: 'flower', settings: { lens: 'kit', mm: 50, N: 5.6, t: 1 / 250, iso: 200, hold: 'hand' }, angle: 'high', dist: 1.4 },
    check: (f, t) => [
      ...(f.place === 'flowers' && f.subject === 'flower' ? [] : [t('花畑のコスモスを撮る', 'shoot the cosmos in the flower field')]),
      ...(f.distance <= 0.4 ? [] : [t(`もっと寄る（いま ${distanceText(f.distance)}、40cm 以内に）`, `get closer (now ${distanceText(f.distance)}; within 40 cm)`)]),
      ...(f.subjectSharp ? [] : [t('花の芯にピントを合わせる', 'focus on the centre of the flower')]),
      ...(f.t <= 1 / 125 ? [] : [t('風で揺れるので 1/125 より速く', 'faster than 1/125, it sways in the wind')]),
      ...exposed(f, t),
    ],
  },
  {
    id: 'field',
    place: { ja: '花畑', en: 'Flower field' },
    title: { ja: '花畑の全体を入れる', en: 'Take in the whole field' },
    goal: { ja: '広角で、手前の花から奥の山までくっきり写す。', en: 'Go wide and keep everything sharp, from the nearest flowers to the hills.' },
    setup: { place: 'flowers', subject: 'flower', settings: { lens: 'tele', mm: 135, N: 2.8, t: 1 / 1000, iso: 100, hold: 'hand' }, angle: 'level', dist: 2.5 },
    check: (f, t) => [
      ...(f.place === 'flowers' ? [] : [t('花畑で撮る', 'shoot in the flower field')]),
      ...(f.mm <= 24 ? [] : [t('24mm 以下の広角にする', 'go wide: 24 mm or less')]),
      ...(f.N >= 8 ? [] : [t('F8 以上に絞って奥までピントを', 'stop down to f/8 or more for depth')]),
      ...(f.distance >= 1.5 ? [] : [t('少し下がる', 'step back a little')]),
      ...exposed(f, t),
    ],
  },
  {
    id: 'compress',
    place: { ja: '夜の路地', en: 'Night lane' },
    title: { ja: '望遠で背景を引き寄せる', en: 'Pull the background in with a long lens' },
    goal: { ja: '離れて望遠で撮ると、後ろの建物が大きく迫って見える（圧縮効果）。人形の大きさは同じくらいのまま。', en: 'Step far back and zoom in: the buildings behind loom large (compression) while the mannequin stays about the same size.' },
    setup: { place: 'street', subject: 'mannequin', settings: { lens: 'tele', mm: 70, N: 4, t: 1 / 125, iso: 3200, hold: 'tripod' }, angle: 'level', dist: 3 },
    check: (f, t) => [
      ...(f.place === 'street' || f.place === 'night' || f.place === 'garden' ? [] : [t('夜の路地・夜の街・日本庭園のどれかで撮る', 'shoot in the night lane, the city or the garden')]),
      ...(f.mm >= 135 ? [] : [t('135mm 以上の望遠にする', 'zoom to 135 mm or longer')]),
      ...(f.distance >= 7 ? [] : [t(`もっと下がる（いま ${distanceText(f.distance)}、7m 以上）`, `step further back (now ${distanceText(f.distance)}; 7m or more)`)]),
      ...(f.subjectSharp ? [] : [t('人形にピントを', 'focus on the mannequin')]),
      ...exposed(f, t),
    ],
  },
  {
    id: 'milky',
    place: { ja: '星空', en: 'Starry sky' },
    title: { ja: '天の川を点の星で撮る', en: 'The Milky Way with pin-sharp stars' },
    goal: { ja: '星が流れない長さで、天の川を明るく。ピントは無限遠（∞）。', en: 'A bright Milky Way, short enough that the stars do not trail. Focus at infinity (∞).' },
    setup: { place: 'stars', subject: 'tree', settings: { lens: 'kit', mm: 28, N: 3.5, t: 1 / 60, iso: 800, hold: 'hand', focusMode: 'af' }, angle: 'level', dist: 14, yaw: Math.PI, look: { x: 0, y: 0.32 } },
    check: (f, t) => [
      ...(f.place === 'stars' ? [] : [t('星空の高原で撮る', 'shoot under the starry sky')]),
      ...(f.tripod ? [] : [t('三脚に載せる', 'use a tripod')]),
      ...(f.focus >= 30 ? [] : [t('ピントを ∞ に（MF）', 'focus at ∞ (MF)')]),
      ...(f.t <= (500 / f.mm) * 1.05 ? [] : [t(`星が流れない ${Math.floor(500 / f.mm)}秒以内に`, `${Math.floor(500 / f.mm)} s or less so the stars stay points`)]),
      ...exposed(f, t, 1),
    ],
  },
  {
    id: 'trails',
    place: { ja: '星空', en: 'Starry sky' },
    title: { ja: '星の軌跡（ぐるぐる）を撮る', en: 'Star trails' },
    goal: { ja: '北の空を向き、インターバル撮影で何十枚も撮って「比較明」で重ねる。', en: 'Face the northern sky, take dozens of frames with the interval timer and stack them with “lighten”.' },
    setup: { place: 'stars', subject: 'tree', settings: { lens: 'astro', mm: 14, N: 1.8, t: 20, iso: 1600, hold: 'tripod', focusMode: 'mf', mf: 100 }, angle: 'level', dist: 16, yaw: Math.PI, look: { x: 0, y: 0.3 } },
    check: (f, t) => [
      ...(f.place === 'stars' ? [] : [t('星空の高原で撮る', 'shoot under the starry sky')]),
      ...(f.stack && f.stack.mode === 'lighten' && f.stack.count >= 30 ? [] : [t('インターバル撮影 30枚以上・比較明合成', 'interval shooting, 30 frames or more, lighten')]),
      ...(f.tripod ? [] : [t('三脚に載せる', 'use a tripod')]),
      ...(f.focus >= 30 ? [] : [t('ピントを ∞ に', 'focus at ∞')]),
    ],
  },
  {
    id: 'meteor',
    place: { ja: '星空', en: 'Starry sky' },
    title: { ja: '流れ星を写す', en: 'Catch a meteor' },
    goal: { ja: '流れ星はいつ流れるか分からない。長く開けて何枚も撮り、写った1枚を残す。', en: 'Nobody knows when a meteor will fall. Use long exposures, take many, and keep the one that caught it.' },
    setup: { place: 'stars', subject: 'tree', settings: { lens: 'astro', mm: 14, N: 1.8, t: 20, iso: 3200, hold: 'tripod', focusMode: 'mf', mf: 100 }, angle: 'level', dist: 16, yaw: Math.PI * 0.75, look: { x: 0, y: 0.35 } },
    check: (f, t) => [
      ...(f.place === 'stars' ? [] : [t('星空の高原で撮る', 'shoot under the starry sky')]),
      ...(f.meteors > 0 ? [] : [t('流れ星が写っていない（インターバル撮影だと確率が上がる）', 'no meteor yet (interval shooting improves the odds)')]),
    ],
  },
  {
    id: 'bokeh',
    place: { ja: '夜の街', en: 'City night' },
    title: { ja: '夜景を玉ボケにする', en: 'Turn city lights into bokeh balls' },
    goal: { ja: '被写体に近づき、F値を小さく。後ろの街の光を大きな丸いボケに。', en: 'Get close to the subject and open the aperture, so the city lights behind become big round bokeh.' },
    setup: { place: 'night', subject: 'bust', settings: { lens: 'kit', mm: 28, N: 8, t: 1 / 15, iso: 1600, hold: 'hand' }, angle: 'level', dist: 3.2 },
    check: (f, t) => [
      ...(f.place === 'night' || f.place === 'street' ? [] : [t('夜の街か路地で撮る', 'shoot in the city or the night lane')]),
      ...(f.N <= 2.8 ? [] : [t('F2.8 以下に開ける', 'open up to f/2.8 or wider')]),
      ...(f.mm >= 50 ? [] : [t('50mm 以上にする', 'use 50 mm or longer')]),
      ...(f.subjectSharp ? [] : [t('被写体にピントを', 'focus on the subject')]),
      ...exposed(f, t),
    ],
  },
  {
    id: 'sunstar',
    place: { ja: '秋の逆光', en: 'Autumn backlight' },
    title: { ja: '太陽を光条（光の筋）にする', en: 'Make the sun a sunstar' },
    goal: { ja: '太陽を画面に入れて、絞ってウニのような光条を出す。', en: 'Put the sun in the frame and stop down until it grows a spiky sunstar.' },
    setup: { place: 'autumn', subject: 'horse', settings: { lens: 'std', mm: 35, N: 2.8, t: 1 / 1000, iso: 100, hold: 'tripod' }, angle: 'level', dist: 1.4, look: { x: -0.12, y: 0.1 } },
    check: (f, t) => [
      ...(f.place === 'autumn' || f.place === 'flowers' || f.place === 'street' ? [] : [t('秋の林か花畑で撮る（太陽が写る場所）', 'shoot in the autumn woods or the flower field (where the sun shows)')]),
      ...(f.sunInFrame ? [] : [t('太陽を画面に入れる', 'get the sun in the frame')]),
      ...(f.N >= 11 ? [] : [t('F11 以上に絞る', 'stop down to f/11 or more')]),
      ...exposed(f, t, 1.2),
    ],
  },
  {
    id: 'snow',
    place: { ja: '雪の森', en: 'Snowy forest' },
    title: { ja: '雪を白く写す', en: 'Keep the snow white' },
    goal: { ja: 'カメラまかせだと雪は灰色になる。メーターを＋1段くらいにして、白い雪に。', en: 'Left to the camera, snow comes out grey. Set the meter to about +1 to keep it white.' },
    setup: { place: 'snow', subject: 'mannequin', settings: { lens: 'std', mm: 50, N: 8, t: 1 / 1000, iso: 100, hold: 'hand' }, angle: 'level', dist: 3.4 },
    check: (f, t) => [
      ...(f.place === 'snow' ? [] : [t('雪の森で撮る', 'shoot in the snowy forest')]),
      ...(f.meter >= 0.5 && f.meter <= 1.7 ? [] : [f.meter < 0.5 ? t('もっと明るく（メーター＋1段前後）', 'brighter (meter around +1)') : t('明るすぎ（＋1.7段まで）', 'too bright (up to +1.7)')]),
      ...(f.clipped < 0.15 ? [] : [t('白飛びしすぎ', 'too many blown highlights')]),
    ],
  },
  {
    id: 'light',
    place: { ja: 'スタジオ', en: 'Studio' },
    title: { ja: '2灯でライティング', en: 'Two-light setup' },
    goal: { ja: '暗いスタジオで、メインのライトと反対側の補助ライトを置いて、影をやわらげる。', en: 'In the dark studio, add a fill light opposite the main light to soften the shadows.' },
    setup: { place: 'lightroom', subject: 'bust', settings: { lens: 'portrait', mm: 85, N: 4, t: 1 / 125, iso: 400, hold: 'tripod' }, angle: 'level', dist: 1.6, lights: [{ kind: 'soft', x: -1.1, z: 0.9, level: 1 }] },
    check: (f, t) => [
      ...(f.place === 'lightroom' ? [] : [t('ライティングスタジオで撮る', 'shoot in the lighting studio')]),
      ...(f.lights >= 2 ? [] : [t('ライトを2灯にする（真上の図の「＋ライト」）', 'use two lights (“+ Light” on the top view)')]),
      ...(f.iso <= 400 ? [] : [t('ISO 400 以下で', 'ISO 400 or lower')]),
      ...exposed(f, t, 0.7),
    ],
  },
  {
    id: 'slowsync',
    place: { ja: '夜の路地', en: 'Night lane' },
    title: { ja: 'フラッシュで人も夜景も写す', en: 'Flash for the subject, the night for the rest' },
    goal: { ja: 'フラッシュで手前を照らし、シャッターを遅くして背景の明かりも写す（スローシンクロ）。', en: 'Light the subject with flash and slow the shutter so the lights behind show too (slow sync).' },
    setup: { place: 'street', subject: 'mannequin', settings: { lens: 'std', mm: 35, N: 4, t: 1 / 250, iso: 800, hold: 'tripod' }, angle: 'level', dist: 3.2, flash: { mode: 'off' } },
    check: (f, t) => [
      ...(f.place === 'street' || f.place === 'night' ? [] : [t('夜の路地か夜の街で撮る', 'shoot in the night lane or the city')]),
      ...(f.flashOn ? [] : [t('フラッシュを使う', 'use the flash')]),
      ...(f.flashShort ? [t('フラッシュが届いていない', 'the flash does not reach')] : []),
      ...(f.t >= 1 / 15 ? [] : [t('シャッターを 1/15 より遅く', 'a shutter slower than 1/15')]),
      ...exposed(f, t, 1),
    ],
  },
  {
    id: 'pinwheel',
    place: { ja: '日本庭園', en: 'Garden' },
    title: { ja: '昼間に風車を流して写す', en: 'Blur a pinwheel in daylight' },
    goal: { ja: '明るい昼でも、ND フィルターで光を減らせば遅いシャッターが使える。', en: 'Even at midday, an ND filter cuts the light enough for a slow shutter.' },
    setup: { place: 'garden', subject: 'bust', settings: { lens: 'std', mm: 50, N: 8, t: 1 / 250, iso: 100, hold: 'hand' }, angle: 'level', dist: 2.2, pinwheel: true },
    check: (f, t) => [
      ...(f.place === 'garden' || f.place === 'flowers' || f.place === 'autumn' ? [] : [t('昼の場所で撮る', 'shoot somewhere in daylight')]),
      ...(f.pinwheel ? [] : [t('風車を置く', 'put out the pinwheel')]),
      ...(f.t >= 1 / 4 ? [] : [t('シャッターを 1/4 秒より遅く', 'a shutter slower than 1/4 s')]),
      ...(f.tripod ? [] : [t('三脚に載せる', 'use a tripod')]),
      ...(f.filterStops >= 3 ? [] : [t('ND フィルターを付ける', 'fit an ND filter')]),
      ...exposed(f, t),
    ],
  },
];

/** Which challenges each topic page offers in the studio. */
export const TOPIC_MISSIONS: Record<string, string[]> = {
  'shutter-speed': ['pinwheel', 'trails', 'slowsync', 'meteor'],
  aperture: ['bokeh', 'field', 'sunstar', 'macro'],
  'focal-length': ['compress', 'field', 'macro'],
};
