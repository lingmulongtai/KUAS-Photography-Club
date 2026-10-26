import { APERTURE_STOPS, ISO_LADDER, SHUTTER_FULL, apertureText, depthOfField, distanceText, nearest, shutterText } from './optics.ts';
import type { MeterReading } from './pipeline';
import type { BackdropId } from './assets';
import type { StudioSettings } from './camera';
import { closestFocus, widest, type Lens, type Filter } from './gear.ts';
import type { FlashResult, FlashState } from './lights';
import { picker, tr, type Lang } from './i18n.ts';

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
  lang: Lang;
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

const fmtStops = (x: number, lang: Lang) => `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}${lang === 'en' ? ' stops' : '段'}`;

export function coach(c: CoachInput): Advice[] {
  const out: Advice[] = [];
  const t = picker(c.lang);
  const { s, meter } = c;
  const stars = c.place === 'stars';
  const m = meter.stops;
  const topic = {
    light: t('明るさ', 'Brightness'),
    noise: t('ノイズ', 'Noise'),
    sharp: t('シャープさ', 'Sharpness'),
    lens: t('レンズ', 'Lens'),
    blur: t('ブレ', 'Blur'),
    focus: t('ピント', 'Focus'),
    stars: t('星', 'Stars'),
    flash: t('フラッシュ', 'Flash'),
    flare: t('フレア', 'Flare'),
    filter: t('フィルター', 'Filter'),
    all: t('全体', 'Overall'),
  };

  // brightness
  if (Math.abs(m) >= 0.7) {
    const over = m > 0;
    const fixes: string[] = [];
    const t2 = nearest(SHUTTER_FULL, s.t / 2 ** m);
    if (t2 !== s.t) fixes.push(t(`シャッターを ${shutterText(t2)} に`, `set the shutter to ${shutterText(t2)}`));
    const N2 = nearest(APERTURE_STOPS, c.N * 2 ** (m / 2));
    if (N2 !== nearest(APERTURE_STOPS, c.N) && N2 >= widest(c.lens, c.mm)) fixes.push(t(`F値を ${apertureText(N2)} に`, `set the aperture to ${apertureText(N2)}`));
    const iso2 = nearest(ISO_LADDER, s.iso / 2 ** m);
    if (iso2 !== s.iso) fixes.push(t(`ISO を ${iso2} に`, `set ISO to ${iso2}`));
    const stops = fmtStops(m, c.lang);
    out.push({
      level: Math.abs(m) >= 1.5 ? 'bad' : 'warn',
      topic: topic.light,
      title: over ? t(`明るすぎます（${stops}）`, `Too bright (${stops})`) : t(`暗すぎます（${stops}）`, `Too dark (${stops})`),
      body: fixes.length
        ? t(`${fixes.join('、または ')}すると、ちょうどよくなります。`, `To fix it, ${fixes.join(', or ')}.`)
        : over
          ? t('これ以上暗くできません。ND フィルターを付けましょう。', 'The camera cannot go any darker. Fit an ND filter.')
          : t('これ以上明るくできません。ライトかフラッシュを足しましょう。', 'The camera cannot go any brighter. Add a light or the flash.'),
    });
  } else if (meter.clipped > 0.04) {
    out.push({
      level: 'warn',
      topic: topic.light,
      title: t('白飛びしています', 'Highlights are blown'),
      body: t(
        '明るい部分が真っ白で、あとから戻せません。全体は適正なので、空や照明を入れない構図にするか、少しだけ暗く（−0.7段）撮ると残せます。',
        'The brightest parts are pure white and cannot be recovered. The overall exposure is fine, so leave the sky or the lamps out of the frame, or shoot a little darker (−0.7).',
      ),
    });
  }
  if (c.place === 'snow' && m > 0.4 && m < 1.6 && meter.clipped < 0.12) {
    out.push({
      level: 'tip',
      topic: topic.light,
      title: t('雪は「明るすぎ」に見えて正解', 'With snow, “too bright” is right'),
      body: t(
        'カメラは何でも灰色に写そうとするので、真っ白な雪だと暗く撮ろうとします。雪を白く写すには、メーターが＋1段前後を指すくらいがちょうどいい（露出補正プラス）。',
        'A meter tries to make everything grey, so it darkens white snow. To keep snow white, aim for about +1 on the meter (plus exposure compensation).',
      ),
    });
  }

  // noise
  if (stars ? s.iso >= 12800 : s.iso >= 3200) {
    const slower = !stars && s.hold === 'tripod';
    out.push({
      level: s.iso >= (stars ? 25600 : 12800) ? 'bad' : 'warn',
      topic: topic.noise,
      title: t(`ISO ${s.iso} はノイズが目立ちます`, `ISO ${s.iso} is noisy`),
      body: slower
        ? t('三脚を使っているので、シャッターを遅くすれば ISO を下げられます（動くものがなければ）。', 'You are on a tripod, so a slower shutter lets you lower the ISO (if nothing is moving).')
        : stars
          ? t(
              '星空では ISO 3200〜6400 が目安。それより上げるなら、インターバル撮影で何枚か撮って「加算平均」で重ねるとノイズが減ります（星の位置はソフトで合わせる想定）。',
              'For stars, ISO 3200–6400 is the usual range. To go higher, take several frames with the interval timer and stack them with “average” to cut the noise (aligning the stars in software).',
            )
          : t('F値を小さく（開放側に）するか、ライトやフラッシュで光を足せば ISO を下げられます。', 'Open the aperture (a smaller f-number) or add light with a lamp or the flash to lower the ISO.'),
    });
  }

  // aperture extremes
  if (c.N >= 16) {
    out.push({
      level: 'warn',
      topic: topic.sharp,
      title: t(`F値が高すぎます（${apertureText(c.N)}）`, `The f-number is too high (${apertureText(c.N)})`),
      body: t(
        '絞りすぎると光の回り込み（回折）で、全体が少しにじみます。いちばんシャープなのは F8〜11 くらい。奥までピントがほしいときも F11 までで足りることが多いです。',
        'Stopped down this far, diffraction softens the whole picture. Lenses are sharpest around f/8–11, and f/11 is usually enough even for depth.',
      ),
    });
  }
  const fmin = widest(c.lens, c.mm);
  if (c.lens.character.soft > 1 && c.N < fmin * 1.4 && !stars) {
    const lens = tr(c.lens.short, c.lang);
    const better = apertureText(Math.min(8, fmin * 2));
    out.push({
      level: 'tip',
      topic: topic.lens,
      title: t(`${lens}の開放は四隅が甘い`, `The ${lens} is soft wide open`),
      body: t(
        `安いレンズは絞りを開けきると、四隅のにじみや輪郭の色ズレ（フリンジ）が出ます。${better} くらいまで絞ると見違えます。`,
        `Cheap lenses wide open show soft corners and coloured fringes on edges. Stop down to about ${better} and it looks much better.`,
      ),
    });
  }

  // camera shake
  const eq = c.mm;
  const safe = s.hold === 'ibis' ? 8 / eq : 1 / eq;
  if (s.hold !== 'tripod' && s.t > safe * 1.01) {
    const limit = shutterText(nearest(SHUTTER_FULL, safe));
    out.push({
      level: s.t > safe * 4 ? 'bad' : 'warn',
      topic: topic.blur,
      title: t('手ぶれしそうです', 'Camera shake likely'),
      body: t(
        `${Math.round(eq)}mm の手持ちなら ${limit} より速いシャッターが目安${s.hold === 'ibis' ? '（手ぶれ補正込み）' : ''}。三脚を使うか、ISO を上げてシャッターを速くしましょう。`,
        `Handheld at ${Math.round(eq)} mm, aim for faster than ${limit}${s.hold === 'ibis' ? ' (with stabilisation)' : ''}. Use a tripod, or raise the ISO for a faster shutter.`,
      ),
    });
  }
  if (c.moving && s.t >= 1 / 60 && !stars) {
    const what =
      c.place === 'flowers'
        ? t('風で揺れる花', 'flowers in the wind')
        : c.place === 'snow'
          ? t('降る雪', 'falling snow')
          : c.pinwheel
            ? t('風車', 'the pinwheel')
            : t('動くもの', 'moving things');
    out.push({
      level: 'tip',
      topic: topic.blur,
      title: t(`${what}が流れて写ります`, `${what[0].toUpperCase()}${what.slice(1)} will blur`),
      body: t(
        `${shutterText(s.t)} は、動くものが線のように流れる遅さ。止めたいなら 1/250 より速く、流れを見せたいなら三脚でもっと遅く。`,
        `At ${shutterText(s.t)}, moving things streak. To freeze them go faster than 1/250; to show the motion, go slower on a tripod.`,
      ),
    });
  }

  // focus
  if (c.tooClose) {
    const near = distanceText(closestFocus(c.lens, c.mm));
    out.push({
      level: 'bad',
      topic: topic.focus,
      title: t('近すぎてピントが合いません', 'Too close to focus'),
      body: t(`このレンズが合わせられるのは ${near} まで。少し離れるか、マクロレンズに替えましょう。`, `This lens focuses no closer than ${near}. Step back, or switch to the macro lens.`),
    });
  }
  const dof = depthOfField(c.mm, c.N, c.focus);
  const off = c.subjectDistance < dof.near * 0.97 || c.subjectDistance > dof.far * 1.03;
  if (!c.tooClose && s.focusMode === 'mf' && off && !stars) {
    out.push({
      level: 'warn',
      topic: topic.focus,
      title: t(`${c.subjectName}にピントが合っていません`, `The ${c.subjectName.toLowerCase()} is out of focus`),
      body: t(
        `ピントは ${distanceText(c.focus)}、${c.subjectName}は ${distanceText(c.subjectDistance)}。ピントリングを回すか、ピーキング（赤い縁取り）を見ながら合わせましょう。`,
        `Focus is at ${distanceText(c.focus)}; the subject is at ${distanceText(c.subjectDistance)}. Turn the focus ring, or watch the peaking (red outlines) while you adjust.`,
      ),
    });
  }
  if (c.subjectDistance < 0.6 && !c.tooClose) {
    const depth = dof.far - dof.near;
    const size = depth < 0.01 ? `${(depth * 1000).toFixed(1)}mm` : distanceText(depth);
    out.push({
      level: depth < 0.004 ? 'warn' : 'tip',
      topic: topic.focus,
      title: t(`ピントの合う幅は ${size}`, `Only ${size} is in focus`),
      body: t(
        '寄るほどピントの合う幅は薄くなります。花の芯から花びらの先までほしければ F8〜F11 に絞り、その分シャッターか ISO で明るさを補いましょう。寄った分、実効F値も暗くなっています。',
        'The closer you get, the thinner the zone of focus. For the centre and the petal tips both sharp, stop down to f/8–11 and make up the light with the shutter or ISO. Up close the effective f-number is darker too.',
      ),
    });
  }

  // night sky
  if (stars) {
    const limit = 500 / c.mm;
    if (s.t > limit * 1.05) {
      out.push({
        level: 'warn',
        topic: topic.stars,
        title: t('星が流れて写ります', 'The stars will trail'),
        body: t(
          `「500ルール」では ${Math.round(c.mm)}mm なら ${Math.floor(limit)}秒まで。点で写したいならシャッターを短く、線（星の軌跡）にしたいならインターバル撮影で何十枚も重ねます。`,
          `By the “500 rule”, ${Math.round(c.mm)} mm allows up to ${Math.floor(limit)} s. For points, shorten the exposure; for lines (star trails), stack dozens of frames with the interval timer.`,
        ),
      });
    }
    if (c.focus < 30) {
      out.push({
        level: 'warn',
        topic: topic.focus,
        title: t('星にピントを合わせましょう', 'Focus on the stars'),
        body: t('ピントが手前に合っていて、星がぼやけた丸になっています。MF にして ∞（無限遠）に合わせるのが星空の基本。', 'Focus is set close, so the stars are blurry discs. Switch to MF and set infinity (∞): the basic rule for the night sky.'),
      });
    }
    if (m < -1 && s.t < 15) {
      out.push({
        level: 'tip',
        topic: topic.stars,
        title: t('星空の目安は F2.8・20秒・ISO 6400', 'A starting point: f/2.8, 20 s, ISO 6400'),
        body: t('星の光はとても弱いので、レンズを開け、長く開け、感度を上げます。明るい単焦点（14mm F1.8 など）があると有利です。', 'Starlight is very faint: open the lens, expose for long, and raise the ISO. A bright prime (such as 14mm f/1.8) helps a lot.'),
      });
    }
  }

  // flash
  if (c.flash.mode !== 'off') {
    if (c.flashResult.overSync) {
      out.push({
        level: 'warn',
        topic: topic.flash,
        title: t('シャッターがシンクロ速度より速い', 'Faster than the flash sync speed'),
        body: t(
          `フラッシュがきちんと光るのは ${shutterText(1 / 250)} まで。速くすると「ハイスピードシンクロ」になり、光が弱く届く距離も短くなります。`,
          `The flash syncs fully up to ${shutterText(1 / 250)}. Faster than that it uses high-speed sync: weaker light that reaches less far.`,
        ),
      });
    }
    if (c.flashResult.short) {
      const reach = distanceText(c.flashResult.reach);
      out.push({
        level: 'bad',
        topic: topic.flash,
        title: t('フラッシュの光が届きません', 'The flash does not reach'),
        body: t(`この設定でフラッシュが届くのは約 ${reach}。近づくか、F値を小さく、ISO を上げましょう。`, `With these settings the flash reaches about ${reach}. Move closer, open the aperture or raise the ISO.`),
      });
    }
    if (c.flash.mode === 'manual' && Math.abs(m) < 0.7) {
      const power = Math.round(1 / c.flash.power);
      const dist = distanceText(c.flashResult.reach * Math.sqrt(c.flash.power));
      out.push({
        level: 'tip',
        topic: topic.flash,
        title: t('マニュアル発光の計算', 'Manual flash maths'),
        body: t(
          `ガイドナンバー 36 ÷ F値 = 届く距離。いまは発光量 1/${power} で約 ${dist} がちょうどよく写る距離です。`,
          `Guide number 36 ÷ f-number = distance. At 1/${power} power, about ${dist} is the right distance now.`,
        ),
      });
    }
    if (['night', 'street', 'stars'].includes(c.place) && s.t <= 1 / 60) {
      out.push({
        level: 'tip',
        topic: topic.flash,
        title: t('背景が真っ暗になりがち', 'The background will go black'),
        body: t(
          'フラッシュは近くしか照らしません。シャッターを 1/15〜1 秒に遅くする「スローシンクロ」で、背景の夜景も写せます（三脚があると安心）。',
          'Flash only lights what is near. Slow the shutter to 1/15–1 s (“slow sync”) to bring in the night behind (a tripod helps).',
        ),
      });
    }
  }

  // flare and filters
  if (c.flare > 0.15) {
    out.push({
      level: 'tip',
      topic: topic.flare,
      title: t('強い光でフレアとゴーストが出ています', 'Strong light is causing flare and ghosts'),
      body:
        (c.lens.grade === 'entry'
          ? t('安いレンズはコーティングが弱く、光の玉（ゴースト）やかぶりが強く出ます。', 'Cheap lenses have weaker coatings, so ghosts and veiling glare are strong. ')
          : t('良いレンズでも、太陽が入るとゴーストは出ます。', 'Even good lenses show ghosts when the sun is in the frame. ')) +
        t(
          '構図を少しずらす・手で光をさえぎる・あえて入れて雰囲気にする、のどれか。絞ると太陽が光条（光の筋）になります。',
          'Shift the framing a little, shade the lens with your hand, or keep it for the mood. Stop down and the sun becomes a sunstar.',
        ),
    });
  }
  if (c.filter.polarizer && !stars) {
    out.push({
      level: 'tip',
      topic: topic.filter,
      title: t('C-PL は回して使う', 'Turn the polariser'),
      body: t(
        '「回転」を動かすと空の濃さが変わります。太陽から 90° の方向の青空でいちばん効き、逆光や順光ではほとんど効きません。光は 1.5 段ほど減ります。',
        'Move “rotation” to change how deep the sky gets. It works best on blue sky 90° from the sun and hardly at all towards or away from it. It takes about 1.5 stops of light.',
      ),
    });
  }
  if (c.filter.stops >= 6 && Math.abs(m) < 1) {
    const name = tr(c.filter.name, c.lang);
    out.push({
      level: 'tip',
      topic: topic.filter,
      title: t(`${name}で長秒露光`, `Long exposures with the ${name}`),
      body: t('明るい場所でも何秒も開けられます。三脚に載せて、動くもの（花・雪・風車）がどう流れるか見てみましょう。', 'You can expose for seconds even in bright light. Put the camera on a tripod and watch how moving things (flowers, snow, the pinwheel) flow.'),
    });
  }

  if (!out.some((a) => a.level === 'bad' || a.level === 'warn')) {
    out.unshift({
      level: 'good',
      topic: topic.all,
      title: t('いい設定です', 'Good settings'),
      body: stars
        ? t('このまま撮ってみましょう。星の軌跡を撮るなら、下の「連写・合成」でインターバル撮影を。', 'Take the shot. For star trails, use interval shooting under “Drive & stack”.')
        : t('このままシャッターを押してみましょう。気になったら設定を1つずつ変えて、違いを撮り比べると身につきます。', 'Press the shutter. Then change one setting at a time and compare the shots: that is how it sticks.'),
    });
  }
  const rank: Record<Level, number> = { bad: 0, warn: 1, good: 2, tip: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
