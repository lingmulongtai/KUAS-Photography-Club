import { APERTURE_STOPS, ISO_LADDER, SHUTTER_FULL, apertureText, depthOfField, distanceText, nearest, shutterText } from '../optics';
import type { MeterReading } from '../pipeline';
import type { BackdropId } from '../assets';
import type { StudioSettings } from './camera';
import { closestFocus, widest, type Lens, type Filter } from './gear';
import type { FlashResult, FlashState } from './lights';

/**
 * The coach: looks at the settings and the picture and says, in plain words, what is
 * wrong and what to change, with real numbers ("1/500 にする").
 */

export type Level = 'bad' | 'warn' | 'tip' | 'good';

export interface Advice {
  level: Level;
  /** Which part of the picture it is about: brightness, blur, focus… */
  topic: string;
  title: string;
  body: string;
}

export interface CoachInput {
  s: StudioSettings;
  mm: number;
  N: number;
  lens: Lens;
  filter: Filter;
  place: BackdropId;
  meter: MeterReading;
  focus: number;
  tooClose: boolean;
  subjectDistance: number;
  subjectName: string;
  flash: FlashState;
  flashResult: FlashResult;
  flare: number;
  moving: boolean;
  /** Pinwheel on show. */
  pinwheel: boolean;
}

const fmtStops = (x: number) => `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}段`;

export function coach(c: CoachInput): Advice[] {
  const out: Advice[] = [];
  const { s, meter } = c;
  const stars = c.place === 'stars';
  const m = meter.stops;

  // brightness
  if (Math.abs(m) >= 0.7) {
    const over = m > 0;
    const fixes: string[] = [];
    const t2 = nearest(SHUTTER_FULL, s.t / 2 ** m);
    if (t2 !== s.t) fixes.push(`シャッターを ${shutterText(t2)} に`);
    const N2 = nearest(APERTURE_STOPS, c.N * 2 ** (m / 2));
    if (N2 !== nearest(APERTURE_STOPS, c.N) && N2 >= widest(c.lens, c.mm)) fixes.push(`F値を ${apertureText(N2)} に`);
    const iso2 = nearest(ISO_LADDER, s.iso / 2 ** m);
    if (iso2 !== s.iso) fixes.push(`ISO を ${iso2} に`);
    out.push({
      level: Math.abs(m) >= 1.5 ? 'bad' : 'warn',
      topic: '明るさ',
      title: over ? `明るすぎます（${fmtStops(m)}）` : `暗すぎます（${fmtStops(m)}）`,
      body: fixes.length ? `${fixes.join('、または ')}すると、ちょうどよくなります。` : over ? 'これ以上暗くできません。ND フィルターを付けましょう。' : 'これ以上明るくできません。ライトかフラッシュを足しましょう。',
    });
  } else if (meter.clipped > 0.04) {
    out.push({ level: 'warn', topic: '明るさ', title: '白飛びしています', body: '明るい部分が真っ白で、あとから戻せません。全体は適正なので、空や照明を入れない構図にするか、少しだけ暗く（−0.7段）撮ると残せます。' });
  }
  if (c.place === 'snow' && m > 0.4 && m < 1.6 && meter.clipped < 0.12) {
    out.push({ level: 'tip', topic: '明るさ', title: '雪は「明るすぎ」に見えて正解', body: 'カメラは何でも灰色に写そうとするので、真っ白な雪だと暗く撮ろうとします。雪を白く写すには、メーターが＋1段前後を指すくらいがちょうどいい（露出補正プラス）。' });
  }

  // noise
  if (stars ? s.iso >= 12800 : s.iso >= 3200) {
    const slower = !stars && s.hold === 'tripod';
    out.push({
      level: s.iso >= (stars ? 25600 : 12800) ? 'bad' : 'warn',
      topic: 'ノイズ',
      title: `ISO ${s.iso} はノイズが目立ちます`,
      body: slower ? '三脚を使っているので、シャッターを遅くすれば ISO を下げられます（動くものがなければ）。' : stars ? '星空では ISO 3200〜6400 が目安。それより上げるなら、インターバル撮影で何枚か撮って「加算平均」で重ねるとノイズが減ります（星の位置はソフトで合わせる想定）。' : 'F値を小さく（開放側に）するか、ライトやフラッシュで光を足せば ISO を下げられます。',
    });
  }

  // aperture extremes
  if (c.N >= 16) {
    out.push({ level: 'warn', topic: 'シャープさ', title: `F値が高すぎます（${apertureText(c.N)}）`, body: '絞りすぎると光の回り込み（回折）で、全体が少しにじみます。いちばんシャープなのは F8〜11 くらい。奥までピントがほしいときも F11 までで足りることが多いです。' });
  }
  const fmin = widest(c.lens, c.mm);
  if (c.lens.character.soft > 1 && c.N < fmin * 1.4 && !stars) {
    out.push({ level: 'tip', topic: 'レンズ', title: `${c.lens.short}の開放は四隅が甘い`, body: `安いレンズは絞りを開けきると、四隅のにじみや輪郭の色ズレ（フリンジ）が出ます。${apertureText(Math.min(8, fmin * 2))} くらいまで絞ると見違えます。` });
  }

  // camera shake
  const eq = c.mm;
  const safe = s.hold === 'ibis' ? 8 / eq : 1 / eq;
  if (s.hold !== 'tripod' && s.t > safe * 1.01) {
    out.push({
      level: s.t > safe * 4 ? 'bad' : 'warn',
      topic: 'ブレ',
      title: '手ぶれしそうです',
      body: `${Math.round(eq)}mm の手持ちなら ${shutterText(nearest(SHUTTER_FULL, safe))} より速いシャッターが目安${s.hold === 'ibis' ? '（手ぶれ補正込み）' : ''}。三脚を使うか、ISO を上げてシャッターを速くしましょう。`,
    });
  }
  if (c.moving && s.t >= 1 / 60 && !stars) {
    const what = c.place === 'flowers' ? '風で揺れる花' : c.place === 'snow' ? '降る雪' : c.pinwheel ? '風車' : '動くもの';
    out.push({ level: 'tip', topic: 'ブレ', title: `${what}が流れて写ります`, body: `${shutterText(s.t)} は、動くものが線のように流れる遅さ。止めたいなら 1/250 より速く、流れを見せたいなら三脚でもっと遅く。` });
  }

  // focus
  if (c.tooClose) {
    out.push({ level: 'bad', topic: 'ピント', title: '近すぎてピントが合いません', body: `このレンズが合わせられるのは ${distanceText(closestFocus(c.lens, c.mm))} まで。少し離れるか、マクロレンズに替えましょう。` });
  }
  const dof = depthOfField(c.mm, c.N, c.focus);
  const off = c.subjectDistance < dof.near * 0.97 || c.subjectDistance > dof.far * 1.03;
  if (!c.tooClose && s.focusMode === 'mf' && off && !stars) {
    out.push({ level: 'warn', topic: 'ピント', title: `${c.subjectName}にピントが合っていません`, body: `ピントは ${distanceText(c.focus)}、${c.subjectName}は ${distanceText(c.subjectDistance)}。ピントリングを回すか、ピーキング（赤い縁取り）を見ながら合わせましょう。` });
  }
  if (c.subjectDistance < 0.6 && !c.tooClose) {
    const depth = dof.far - dof.near;
    out.push({ level: depth < 0.004 ? 'warn' : 'tip', topic: 'ピント', title: `ピントの合う幅は ${depth < 0.01 ? (depth * 1000).toFixed(1) + 'mm' : distanceText(depth)}`, body: '寄るほどピントの合う幅は薄くなります。花の芯から花びらの先までほしければ F8〜F11 に絞り、その分シャッターか ISO で明るさを補いましょう。寄った分、実効F値も暗くなっています。' });
  }

  // night sky
  if (stars) {
    const limit = 500 / c.mm;
    if (s.t > limit * 1.05) {
      out.push({ level: 'warn', topic: '星', title: '星が流れて写ります', body: `「500ルール」では ${Math.round(c.mm)}mm なら ${Math.floor(limit)}秒まで。点で写したいならシャッターを短く、線（星の軌跡）にしたいならインターバル撮影で何十枚も重ねます。` });
    }
    if (c.focus < 30) {
      out.push({ level: 'warn', topic: 'ピント', title: '星にピントを合わせましょう', body: 'ピントが手前に合っていて、星がぼやけた丸になっています。MF にして ∞（無限遠）に合わせるのが星空の基本。' });
    }
    if (m < -1 && s.t < 15) {
      out.push({ level: 'tip', topic: '星', title: '星空の目安は F2.8・20秒・ISO 6400', body: '星の光はとても弱いので、レンズを開け、長く開け、感度を上げます。明るい単焦点（14mm F1.8 など）があると有利です。' });
    }
  }

  // flash
  if (c.flash.mode !== 'off') {
    if (c.flashResult.overSync) {
      out.push({ level: 'warn', topic: 'フラッシュ', title: `シャッターがシンクロ速度より速い`, body: `フラッシュがきちんと光るのは ${shutterText(1 / 250)} まで。速くすると「ハイスピードシンクロ」になり、光が弱く届く距離も短くなります。` });
    }
    if (c.flashResult.short) {
      out.push({ level: 'bad', topic: 'フラッシュ', title: 'フラッシュの光が届きません', body: `この設定でフラッシュが届くのは約 ${distanceText(c.flashResult.reach)}。近づくか、F値を小さく、ISO を上げましょう。` });
    }
    if (c.flash.mode === 'manual' && Math.abs(m) < 0.7) {
      out.push({ level: 'tip', topic: 'フラッシュ', title: 'マニュアル発光の計算', body: `ガイドナンバー 36 ÷ F値 = 届く距離。いまは発光量 1/${Math.round(1 / c.flash.power)} で約 ${distanceText(c.flashResult.reach * Math.sqrt(c.flash.power))} がちょうどよく写る距離です。` });
    }
    if (['night', 'street', 'stars'].includes(c.place) && s.t <= 1 / 60) {
      out.push({ level: 'tip', topic: 'フラッシュ', title: '背景が真っ暗になりがち', body: 'フラッシュは近くしか照らしません。シャッターを 1/15〜1 秒に遅くする「スローシンクロ」で、背景の夜景も写せます（三脚があると安心）。' });
    }
  }

  // flare and filters
  if (c.flare > 0.15) {
    out.push({
      level: 'tip',
      topic: 'フレア',
      title: '強い光でフレアとゴーストが出ています',
      body: `${c.lens.grade === '入門' ? '安いレンズはコーティングが弱く、光の玉（ゴースト）やかぶりが強く出ます。' : '良いレンズでも、太陽が入るとゴーストは出ます。'}構図を少しずらす・手で光をさえぎる・あえて入れて雰囲気にする、のどれか。絞ると太陽が光条（光の筋）になります。`,
    });
  }
  if (c.filter.polarizer && !stars) {
    out.push({ level: 'tip', topic: 'フィルター', title: 'C-PL は回して使う', body: '「回転」を動かすと空の濃さが変わります。太陽から 90° の方向の青空でいちばん効き、逆光や順光ではほとんど効きません。光は 1.5 段ほど減ります。' });
  }
  if (c.filter.stops >= 6 && Math.abs(m) < 1) {
    out.push({ level: 'tip', topic: 'フィルター', title: `${c.filter.name}で長秒露光`, body: '明るい場所でも何秒も開けられます。三脚に載せて、動くもの（花・雪・風車）がどう流れるか見てみましょう。' });
  }

  if (!out.some((a) => a.level === 'bad' || a.level === 'warn')) {
    out.unshift({ level: 'good', topic: '全体', title: 'いい設定です', body: stars ? 'このまま撮ってみましょう。星の軌跡を撮るなら、下の「連写・合成」でインターバル撮影を。' : 'このままシャッターを押してみましょう。気になったら設定を1つずつ変えて、違いを撮り比べると身につきます。' });
  }
  const rank: Record<Level, number> = { bad: 0, warn: 1, good: 2, tip: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
