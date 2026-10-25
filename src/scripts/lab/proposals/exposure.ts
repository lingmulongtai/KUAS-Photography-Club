import { World } from '../world';
import { Rig, dragLook } from '../rig';
import { APERTURE_STOPS, ISO_LADDER, SHUTTER_STOPS, apertureText, autoAperture, autoShutter, cameraEV, shutterText, nearest } from '../optics';
import { bindLadders, bindSegments, drawHistogram, eachProposal, lazyStage, setText, whenReady } from '../ui';
import type { BackdropId } from '../assets';

export const verdict = (stops: number) => {
  const a = Math.abs(stops);
  if (a < 0.34) return '適正露出';
  return `${a.toFixed(1).replace('.0', '')}段 ${stops > 0 ? '明るすぎ' : '暗すぎ'}`;
};

/** What each setting costs, in plain words. */
export function sideEffects(mm: number, N: number, t: number, iso: number) {
  const shake = t > 1 / Math.max(30, mm) ? (t > 4 / mm ? '手ブレしやすい（三脚がほしい）' : '手ブレに注意') : t <= 1 / 500 ? '動きもピタッと止まる' : 'ふつうに止まる';
  const bokeh = N <= 2 ? '背景が大きくぼける' : N <= 4 ? '背景がほどよくぼける' : N <= 8 ? '背景もそこそこ写る' : '奥までくっきり';
  const noise = iso <= 200 ? 'ノイズはほぼなし' : iso <= 800 ? 'ノイズは少しだけ' : iso <= 3200 ? 'ノイズが目立ってくる' : 'ザラザラが目立つ';
  return { shake, bokeh, noise };
}

/* 露出 A: the back of a camera */
eachProposal('exposure-a', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const info = root.querySelector('[data-info]');
  const meter = root.querySelector<HTMLElement>('.meter');
  const hist = root.querySelector<HTMLCanvasElement>('[data-hist]');
  const verdictEl = root.querySelector('[data-verdict]');
  const fx = { shake: root.querySelector('[data-fx="shake"]'), bokeh: root.querySelector('[data-fx="bokeh"]'), noise: root.querySelector('[data-fx="noise"]') };
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true, leaves: true });
    const rig = new Rig(renderer, world, { mm: 50, N: 8, t: 1 / 125, iso: 100, shake: 1 });
    whenReady(stage, world.ready);
    dragLook(stage, rig);
    const dial = (id: string, stops: readonly number[], key: 't' | 'N' | 'iso') => {
      const input = root.querySelector<HTMLInputElement>(`#${id}`);
      input?.addEventListener('input', () => rig.set({ [key]: stops[Number(input.value)] }));
    };
    dial('exa-ss', SHUTTER_STOPS, 't');
    dial('exa-f', APERTURE_STOPS, 'N');
    dial('exa-iso', ISO_LADDER, 'iso');
    root.querySelector<HTMLButtonElement>('[data-toggle="zebra"]')?.addEventListener('click', (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      rig.set({ zebra: on });
    });
    bindSegments(root, 'hold', (v) => rig.set({ shake: v === 'hand' ? 1 : 0 }));
    bindSegments(root, 'bg', (v) => world.setBackdrop(v as BackdropId));
    let frame = 0;
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        const stops = rig.pipeline.lastStops;
        setText(info, `M   ${shutterText(s.t)}   ${apertureText(s.N)}   ISO ${s.iso}`);
        meter?.style.setProperty('--stops', String(Math.max(-3.2, Math.min(3.2, stops))));
        meter?.classList.toggle('off', Math.abs(stops) >= 0.34);
        setText(verdictEl, verdict(stops));
        const e = sideEffects(s.mm, s.N, s.t, s.iso);
        setText(fx.shake, s.shake ? e.shake : '三脚なので手ブレなし');
        setText(fx.bokeh, e.bokeh);
        setText(fx.noise, e.noise);
        if (hist && (frame++ % 12 === 0 || !dt)) drawHistogram(hist, rig.pipeline.histogram(48));
      },
    };
  });
});

/* 露出 B: the exposure triangle, with one setting following the others */
eachProposal('exposure-b', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const dots = {
    t: root.querySelector<SVGCircleElement>('[data-dot="t"]'),
    N: root.querySelector<SVGCircleElement>('[data-dot="N"]'),
    iso: root.querySelector<SVGCircleElement>('[data-dot="iso"]'),
  };
  const verdictEl = root.querySelector('[data-verdict]');
  const fx = { shake: root.querySelector('[data-fx="shake"]'), bokeh: root.querySelector('[data-fx="bokeh"]'), noise: root.querySelector('[data-fx="noise"]') };
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'autumn', subject: 'mannequin', pinwheel: true, leaves: true });
    const rig = new Rig(renderer, world, { mm: 70, N: 4, t: 1 / 500, iso: 100, shake: 1, frame: 0.9 });
    whenReady(stage, world.ready);
    let follow: 't' | 'N' | 'iso' | 'none' = 'iso';
    const setLadder = bindLadders(root, (k, v) => {
      rig.set({ [k]: v });
      const s = rig.target;
      if (follow !== 'none' && follow !== k) {
        const ev = world.ev;
        if (follow === 'iso') rig.set({ iso: nearest(ISO_LADDER, 100 * 2 ** (cameraEV(s.N, s.t, 100) - ev)) });
        if (follow === 't') rig.set({ t: autoShutter(ev, s.N, s.iso) });
        if (follow === 'N') rig.set({ N: autoAperture(ev, s.t, s.iso) });
        setLadder(follow, rig.target[follow]);
      }
    });
    bindSegments(root, 'follow', (v) => (follow = v as typeof follow));
    // Points along the triangle's sides: shutter on the left, aperture on the right, ISO along the bottom.
    const A = [150, 22];
    const L = [24, 240];
    const R = [276, 240];
    const along = (p: number[], q: number[], k: number) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    const place = (el: SVGCircleElement | null, xy: number[]) => {
      el?.setAttribute('cx', String(xy[0]));
      el?.setAttribute('cy', String(xy[1]));
    };
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        const kt = SHUTTER_STOPS.indexOf(nearest(SHUTTER_STOPS, s.t)) / (SHUTTER_STOPS.length - 1);
        const kn = APERTURE_STOPS.indexOf(nearest(APERTURE_STOPS, s.N)) / (APERTURE_STOPS.length - 1);
        const ki = ISO_LADDER.indexOf(nearest(ISO_LADDER, s.iso)) / (ISO_LADDER.length - 1);
        place(dots.t, along(A, L, kt));
        place(dots.N, along(A, R, kn));
        place(dots.iso, along(L, R, ki));
        setText(verdictEl, verdict(rig.pipeline.lastStops));
        const e = sideEffects(s.mm, s.N, s.t, s.iso);
        setText(fx.shake, e.shake);
        setText(fx.bokeh, e.bokeh);
        setText(fx.noise, e.noise);
      },
    };
  });
});

/* 露出 C: light as water filling a bucket */
eachProposal('exposure-c', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const svg = root.querySelector<SVGSVGElement>('[data-bucket]')!;
  const stream = svg.querySelector<SVGRectElement>('[data-stream]')!;
  const water = svg.querySelector<SVGRectElement>('[data-water]')!;
  const bucket = svg.querySelector<SVGPathElement>('[data-shape]')!;
  const tap = svg.querySelector<SVGRectElement>('[data-tap]')!;
  const label = root.querySelector('[data-bucket-label]');
  const verdictEl = root.querySelector('[data-verdict]');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'sunset', subject: 'stilllife' });
    const rig = new Rig(renderer, world, { mm: 50, N: 4, t: 1 / 250, iso: 200, shake: 0 });
    whenReady(stage, world.ready);
    bindLadders(root, (k, v) => {
      rig.set({ [k]: v });
      pour = 0;
    });
    let pour = 0;
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        const stops = rig.pipeline.lastStops;
        // tap width ~ aperture area, pouring time ~ shutter, bucket width ~ 1/ISO
        const tapW = 6 + 46 * (1.4 / s.N) ** 2 * 0.9;
        const pourTime = 0.4 + (Math.log2(s.t * 4000) / Math.log2(8 * 4000)) * 2.6;
        const bw = 40 + 120 / Math.sqrt(s.iso / 100);
        pour = dt ? pour + dt : pourTime + 1;
        const cycle = pourTime + 1.6;
        if (pour > cycle) pour = 0;
        const k = Math.min(1, pour / pourTime);
        const full = Math.max(0.04, Math.min(1.25, 2 ** stops * 0.62));
        const level = full * k;
        tap.setAttribute('width', tapW.toFixed(1));
        tap.setAttribute('x', (150 - tapW / 2).toFixed(1));
        stream.setAttribute('width', tapW.toFixed(1));
        stream.setAttribute('x', (150 - tapW / 2).toFixed(1));
        stream.style.opacity = pour < pourTime ? '0.85' : '0';
        bucket.setAttribute('d', `M${150 - bw / 2} 120 L${150 - bw / 2 + 6} 250 L${150 + bw / 2 - 6} 250 L${150 + bw / 2} 120`);
        const top = 250 - Math.min(1.25, level) * 130 * 0.8;
        water.setAttribute('x', String(150 - bw / 2 + 4));
        water.setAttribute('width', String(bw - 8));
        water.setAttribute('y', top.toFixed(1));
        water.setAttribute('height', (250 - top).toFixed(1));
        water.classList.toggle('over', level > 1.08);
        setText(label, `蛇口の太さ＝絞り ${apertureText(s.N)} ／ 出している時間＝シャッター ${shutterText(s.t)} ／ バケツの細さ＝ISO ${s.iso}`);
        setText(verdictEl, verdict(stops));
      },
    };
  });
});

/* 露出 D: a bracket of five frames */
eachProposal('exposure-d', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const cells = Array.from(root.querySelectorAll<HTMLElement>('[data-cell]'));
  const note = root.querySelector('[data-note]');
  const offsets = [-2, -1, 0, 1, 2];
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'sunset', subject: 'bust', pinwheel: true });
    const base = { mm: 50, N: 5.6, t: 1 / 125, iso: 400 };
    const rigs = offsets.map(() => new Rig(renderer, world, { ...base, shake: 0 }, { maxCoc: 10, maxSubframes: 4 }));
    whenReady(stage, world.ready);
    let by: 't' | 'N' | 'iso' = 't';
    let chosen = 2;
    const apply = () => {
      const ev0 = cameraEV(base.N, base.t, base.iso);
      const correct = world.ev - ev0;
      rigs.forEach((r, i) => {
        const d = offsets[i] - correct;
        const s = { ...base };
        if (by === 't') s.t = nearest(SHUTTER_STOPS, base.t * 2 ** d);
        if (by === 'N') s.N = nearest(APERTURE_STOPS, base.N / Math.SQRT2 ** d);
        if (by === 'iso') s.iso = nearest(ISO_LADDER, base.iso * 2 ** d);
        r.set(s);
        r.snap();
      });
    };
    world.ready.then(apply);
    bindSegments(root, 'by', (v) => {
      by = v as typeof by;
      apply();
    });
    cells.forEach((c, i) =>
      c.addEventListener('click', () => {
        chosen = i;
        cells.forEach((x, j) => x.setAttribute('aria-pressed', String(j === i)));
      }),
    );
    let w = 2;
    let h = 2;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        h = ch;
        rigs.forEach((r) => r.resize(cw / 3, ch / 2, dpr));
      },
      render(t, dt) {
        renderer.setRenderTarget(null);
        renderer.setClearColor('#0d0f12');
        renderer.clear();
        rigs.forEach((r, i) => {
          const x = (i % 3) * (w / 3);
          const y = (1 - Math.floor(i / 3)) * (h / 2);
          r.render(t, dt, { x: x + 2, y: y + 2, w: w / 3 - 4, h: h / 2 - 4 });
          const s = r.now;
          setText(cells[i].querySelector('b'), `${offsets[i] > 0 ? '+' : offsets[i] < 0 ? '−' : '±'}${Math.abs(offsets[i])}`);
          setText(cells[i].querySelector('span'), `${shutterText(s.t)} ${apertureText(s.N)} ISO${s.iso}`);
        });
        const s = rigs[chosen].now;
        const e = sideEffects(50, s.N, s.t, s.iso);
        const which = by === 't' ? `シャッター ${shutterText(s.t)}：風車は${s.t >= 1 / 30 ? '流れて写る' : s.t <= 1 / 500 ? '止まって写る' : '少し流れる'}` : by === 'N' ? `絞り ${apertureText(s.N)}：${e.bokeh}` : `ISO ${s.iso}：${e.noise}`;
        setText(note, `${offsets[chosen] === 0 ? '適正' : `${Math.abs(offsets[chosen])}段 ${offsets[chosen] > 0 ? '明るい' : '暗い'}`}の1枚。${which}。`);
      },
    };
  });
});

/* 露出 E: the mode dial — what the camera decides for you */
eachProposal('exposure-e', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const dialFace = root.querySelector<HTMLElement>('[data-mode-face]');
  const autoBadges = Array.from(root.querySelectorAll<HTMLElement>('[data-auto]'));
  const verdictEl = root.querySelector('[data-verdict]');
  const modeNote = root.querySelector('[data-mode-note]');
  const meter = root.querySelector<HTMLElement>('.meter');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'night', subject: 'horse', pinwheel: true });
    const rig = new Rig(renderer, world, { mm: 50, N: 2.8, t: 1 / 60, iso: 1600, shake: 1 });
    whenReady(stage, world.ready);
    dragLook(stage, rig);
    let mode: 'P' | 'A' | 'S' | 'M' = 'A';
    let comp = 0;
    const notes = {
      P: 'P（プログラム）：絞りもシャッターもカメラ任せ。あなたは ISO と明るさの補正だけ。',
      A: 'A（絞り優先）：ボケ具合をあなたが決め、シャッターはカメラが合わせる。いちばん使われるモード。',
      S: 'S（シャッター優先）：ブレの止め方をあなたが決め、絞りはカメラが合わせる。スポーツや乗り物に。',
      M: 'M（マニュアル）：全部あなたが決める。露出計を見て、自分で合わせる。',
    };
    let setLadder: (k: string, v: number) => void = () => {};
    const solve = () => {
      const s = rig.target;
      const ev = world.ev + comp * -1;
      if (mode === 'A') rig.set({ t: autoShutter(ev, s.N, s.iso) });
      if (mode === 'S') rig.set({ N: autoAperture(ev, s.t, s.iso) });
      if (mode === 'P') {
        const N = nearest(APERTURE_STOPS, Math.max(2.8, Math.min(8, 2 ** ((ev - 6) / 3))));
        rig.set({ N, t: autoShutter(ev, N, s.iso) });
      }
      setLadder('t', rig.target.t);
      setLadder('N', rig.target.N);
      autoBadges.forEach((b) => {
        const k = b.dataset.auto;
        const auto = (mode === 'A' && k === 't') || (mode === 'S' && k === 'N') || (mode === 'P' && (k === 't' || k === 'N'));
        b.hidden = !auto;
        b.closest('[data-ladder]')?.classList.toggle('is-auto', auto);
        const input = b.closest('[data-ladder]')?.querySelector('input');
        if (input) input.disabled = auto;
      });
      setText(modeNote, notes[mode]);
      dialFace?.style.setProperty('--turn', String(['P', 'A', 'S', 'M'].indexOf(mode)));
    };
    setLadder = bindLadders(root, (k, v) => {
      if (k === 'comp') comp = v;
      else rig.set({ [k]: v });
      solve();
    });
    bindSegments(root, 'mode', (v) => {
      mode = v as typeof mode;
      solve();
    });
    bindSegments(root, 'bg', async (v) => {
      await world.setBackdrop(v as BackdropId);
      solve();
    });
    world.ready.then(solve);
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const stops = rig.pipeline.lastStops;
        meter?.style.setProperty('--stops', String(Math.max(-3.2, Math.min(3.2, stops))));
        meter?.classList.toggle('off', Math.abs(stops - comp) >= 0.34);
        setText(verdictEl, mode === 'M' ? verdict(stops) : comp ? `補正 ${comp > 0 ? '+' : '−'}${Math.abs(comp)}` : 'カメラが適正に合わせています');
      },
    };
  });
});

