import { World } from '../world';
import { Rig, dragLook, type RigSettings } from '../rig';
import { apertureText, shutterText } from '../optics';
import { bindLadders, bindSegments, eachProposal, lazyStage, setText, whenReady } from '../ui';
import { verdict } from './exposure';
import type { BackdropId } from '../assets';

/* 構成 B: one page per topic — the index shows each topic as a live picture */
eachProposal('structure-b', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const looks: Partial<RigSettings>[] = [
    { mm: 50, N: 8, t: 1 / 250, iso: 100 },
    { mm: 50, N: 11, t: 1 / 4, iso: 100, shake: 0 },
    { mm: 135, N: 1.4, t: 1 / 2000, iso: 100 },
    { mm: 50, N: 8, t: 1 / 250, iso: 25600 },
    { mm: 16, N: 8, t: 1 / 250, iso: 100 },
  ];
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true, leaves: true, torii: true });
    const rigs = looks.map((l) => new Rig(renderer, world, { ...l, autoExpose: true }, { maxSubframes: 6, maxCoc: 10 }));
    whenReady(stage, world.ready);
    let w = 2;
    let h = 2;
    let cols = 3;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        h = ch;
        cols = cw < 560 ? 2 : 3;
        root.querySelector<HTMLElement>('.topic-grid')?.setAttribute('data-cols', String(cols));
        const rows = Math.ceil(6 / cols);
        rigs.forEach((r) => r.resize(cw / cols, ch / rows, dpr));
      },
      render(t, dt) {
        const rows = Math.ceil(6 / cols);
        renderer.setRenderTarget(null);
        renderer.setClearColor('#0d0f12');
        renderer.clear();
        rigs.forEach((r, i) => {
          r.look.x = Math.sin(t * 0.2 + i) * 0.25;
          const cw = w / cols;
          const ch = h / rows;
          r.render(t, dt, { x: (i % cols) * cw + 3, y: (rows - 1 - Math.floor(i / cols)) * ch + 3, w: cw - 6, h: ch - 6 });
        });
      },
    };
  });
});

/* 構成 C: one long page, scrolling walks through the settings */
eachProposal('structure-c', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-step]'));
  const readout = root.querySelector('[data-readout]');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true, torii: true });
    const rig = new Rig(renderer, world, { mm: 50, N: 5.6, t: 1 / 250, iso: 100, autoExpose: true });
    whenReady(stage, world.ready);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          steps.forEach((s) => s.classList.toggle('on', s === el));
          const set = JSON.parse(el.dataset.step!) as Partial<RigSettings> & { bg?: BackdropId };
          const { bg, ...patch } = set;
          rig.set(patch);
          if (bg && bg !== world.backdrop.id) world.setBackdrop(bg);
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.forEach((s) => io.observe(s));
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        setText(readout, `${Math.round(s.mm)}mm ${shutterText(s.t)} ${apertureText(s.N)} ISO ${s.iso}`);
      },
    };
  });
});

/* 構成 D: missions to clear */
eachProposal('structure-d', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-mission]'));
  const card = root.querySelector<HTMLElement>('[data-card]');
  const cardTitle = root.querySelector('[data-card-title]');
  const cardHint = root.querySelector('[data-card-hint]');
  const verdictEl = root.querySelector('[data-verdict]');
  const missions = [
    { title: '鳥居をとろけさせて、胸像の目にピントを合わせよう', hint: 'ヒント：望遠にして、絞りを開ける（F値を小さく）', ok: (s: RigSettings, stops: number) => s.N <= 2 && s.mm >= 85 && Math.abs(stops) < 0.5 },
    { title: '風車の羽根をピタッと止めよう（明るさは適正のまま）', hint: 'ヒント：シャッターを速くして、暗くなったぶんを絞りか ISO で取り戻す', ok: (s: RigSettings, stops: number) => s.t <= 1 / 1000 && Math.abs(stops) < 0.5 },
    { title: '三脚を立てて、風車をくるくる流して写そう', hint: 'ヒント：シャッターを遅く。明るすぎたら絞る', ok: (s: RigSettings, stops: number) => s.t >= 1 / 15 && s.shake === 0 && Math.abs(stops) < 0.5 },
  ];
  let current = 0;
  const cleared = new Set<number>();
  const show = () => {
    const m = missions[current];
    setText(cardTitle, `ミッション ${current + 1}：${m.title}`);
    setText(cardHint, m.hint);
    items.forEach((it, i) => {
      it.classList.toggle('now', i === current);
      it.classList.toggle('done', cleared.has(i));
    });
    card?.classList.toggle('clear', cleared.has(current));
  };
  items.forEach((it, i) => it.addEventListener('click', () => { current = i; show(); }));
  root.querySelector('[data-next]')?.addEventListener('click', () => { current = (current + 1) % missions.length; show(); });
  show();
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true, torii: true });
    const rig = new Rig(renderer, world, { mm: 35, N: 8, t: 1 / 125, iso: 200, shake: 1 });
    whenReady(stage, world.ready);
    dragLook(stage, rig);
    bindLadders(root, (k, v) => rig.set({ [k]: v }));
    bindSegments(root, 'hold', (v) => rig.set({ shake: v === 'hand' ? 1 : 0 }));
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const stops = rig.pipeline.lastStops;
        setText(verdictEl, verdict(stops));
        if (missions[current].ok(rig.target, stops) && !cleared.has(current)) {
          cleared.add(current);
          show();
        }
      },
    };
  });
});

/* 構成 E: two cameras, one scene, a divider to compare */
eachProposal('structure-e', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const handle = root.querySelector<HTMLElement>('[data-divider]')!;
  const labelA = root.querySelector('[data-label="a"]');
  const labelB = root.querySelector('[data-label="b"]');
  const pairs: Record<string, [Partial<RigSettings>, Partial<RigSettings>, string, string]> = {
    bokeh: [{ mm: 85, N: 1.4, t: 1 / 250 }, { mm: 85, N: 11, t: 1 / 250 }, 'F1.4：背景がとろける', 'F11：奥までくっきり'],
    focal: [{ mm: 20, N: 5.6 }, { mm: 135, N: 5.6 }, '20mm で近づく', '135mm で離れる'],
    motion: [{ mm: 50, N: 4, t: 1 / 2000, shake: 0 }, { mm: 50, N: 4, t: 1 / 8, shake: 0 }, '1/2000 秒：止まる', '1/8 秒：流れる'],
    iso: [{ mm: 50, N: 4, iso: 100 }, { mm: 50, N: 4, iso: 12800 }, 'ISO 100：なめらか', 'ISO 12800：ザラザラ'],
  };
  let split = 0.5;
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true, leaves: true, torii: true });
    const a = new Rig(renderer, world, { ...pairs.bokeh[0], autoExpose: true });
    const b = new Rig(renderer, world, { ...pairs.bokeh[1], autoExpose: true });
    whenReady(stage, world.ready);
    const pick = (k: string) => {
      const [pa, pb, la, lb] = pairs[k];
      a.set({ ...pa });
      b.set({ ...pb });
      setText(labelA, la);
      setText(labelB, lb);
    };
    pick('bokeh');
    bindSegments(root, 'pair', pick);
    let drag = false;
    stage.addEventListener('pointerdown', (e) => {
      drag = true;
      stage.setPointerCapture(e.pointerId);
      const r = stage.getBoundingClientRect();
      split = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width));
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = stage.getBoundingClientRect();
      split = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width));
    });
    stage.addEventListener('pointerup', () => (drag = false));
    let w = 2;
    let h = 2;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        h = ch;
        a.resize(cw, ch, dpr);
        b.resize(cw, ch, dpr);
      },
      render(t, dt) {
        const x = Math.round(w * split);
        a.render(t, dt, undefined, null, { x: 0, y: 0, w: x, h });
        b.render(t, dt, undefined, null, { x, y: 0, w: w - x, h });
        handle.style.left = `${split * 100}%`;
      },
    };
  });
});
