import { World } from '../world';
import { Rig } from '../rig';
import { apertureText, autoShutter, depthOfField, distanceText, shutterText } from '../optics';
import { bindLadders, bindSegments, drawHistogram, lazyStage, setText, whenReady } from '../ui';
import { sideEffects, verdict } from './exposure';
import type { BackdropId } from '../assets';
import type { SubjectId } from '../subjects';

/**
 * The "one studio" structure: every setting on one camera, in one scene, with a shutter
 * button that keeps the pictures you take on a contact sheet.
 */
document.querySelectorAll<HTMLElement>('[data-studio]').forEach((root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const af = root.querySelector<HTMLElement>('.af');
  const info = root.querySelector('[data-info]');
  const verdictEl = root.querySelector('[data-verdict]');
  const meter = root.querySelector<HTMLElement>('.meter');
  const hist = root.querySelector<HTMLCanvasElement>('[data-hist]');
  const tips = root.querySelector<HTMLElement>('[data-tips]');
  const sheet = root.querySelector<HTMLElement>('[data-sheet]');
  const shutter = root.querySelector<HTMLButtonElement>('[data-shutter]');
  const flash = root.querySelector<HTMLElement>('[data-flash]');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true, leaves: true, torii: root.dataset.torii === 'true' });
    const rig = new Rig(renderer, world, { mm: 50, N: 4, t: 1 / 500, iso: 100, shake: 1 });
    whenReady(stage, world.ready);
    let afMode: 'subject' | 'tap' = 'subject';
    const setLadder = bindLadders(root, (k, v) => rig.set({ [k]: v }));
    bindSegments(root, 'subject', (v) => {
      world.setSubject(v as SubjectId);
      afMode = 'subject';
      rig.set({ focus: null });
      if (af) Object.assign(af.style, { left: '50%', top: '50%' });
    });
    bindSegments(root, 'bg', async (v) => {
      await world.setBackdrop(v as BackdropId);
      // start each scene near a correct exposure, as a camera in A mode would
      const t = autoShutter(world.ev, rig.target.N, rig.target.iso);
      rig.set({ t });
      setLadder('t', t);
    });
    bindSegments(root, 'hold', (v) => rig.set({ shake: v === 'hand' ? 1 : 0 }));
    // look around by dragging; a tap (no drag) focuses there
    let down: { x: number; y: number; lx: number; ly: number } | null = null;
    stage.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input')) return;
      down = { x: e.clientX, y: e.clientY, lx: rig.look.x, ly: rig.look.y };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!down) return;
      const r = stage.getBoundingClientRect();
      rig.look.x = Math.max(-0.8, Math.min(0.8, down.lx - ((e.clientX - down.x) / r.width) * 2));
      rig.look.y = Math.max(-0.3, Math.min(0.3, down.ly + ((e.clientY - down.y) / r.height) * 0.8));
    });
    stage.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
      down = null;
      if (moved) return;
      const r = stage.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      const d = rig.pickFocus(u, v);
      if (d && af) {
        afMode = 'tap';
        rig.set({ focus: d });
        af.style.left = `${u * 100}%`;
        af.style.top = `${v * 100}%`;
      }
    });
    let take = false;
    shutter?.addEventListener('click', () => (take = true));
    let frame = 0;
    let shots = 0;
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        const stops = rig.pipeline.lastStops;
        if (take && sheet) {
          take = false;
          shots++;
          const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
          const fig = document.createElement('figure');
          const img = new Image();
          img.src = url;
          img.alt = `撮影 ${shots}枚目`;
          const cap = document.createElement('figcaption');
          cap.textContent = `#${shots}  ${Math.round(s.mm)}mm ${shutterText(s.t)} ${apertureText(s.N)} ISO${s.iso}`;
          fig.append(img, cap);
          sheet.prepend(fig);
          while (sheet.children.length > 8) sheet.lastElementChild?.remove();
          flash?.classList.remove('on');
          void flash?.offsetWidth;
          flash?.classList.add('on');
        }
        setText(info, `${Math.round(s.mm)}mm   ${shutterText(s.t)}   ${apertureText(s.N)}   ISO ${s.iso}`);
        setText(verdictEl, verdict(stops));
        meter?.style.setProperty('--stops', String(Math.max(-3.2, Math.min(3.2, stops))));
        meter?.classList.toggle('off', Math.abs(stops) >= 0.34);
        if (hist && frame++ % 12 === 0) drawHistogram(hist, rig.pipeline.histogram(48));
        if (tips && frame % 15 === 1) {
          const e = sideEffects(s.mm, s.N, s.t, s.iso);
          const fd = s.focus ?? rig.autoFocus();
          const dof = depthOfField(s.mm, s.N, fd);
          const lines = [
            `明るさ：${verdict(stops)}${Math.abs(stops) >= 0.34 ? (stops > 0 ? '（シャッターを速く・絞る・ISOを下げる）' : '（シャッターを遅く・開ける・ISOを上げる）') : ''}`,
            `ブレ：${s.shake ? e.shake : '三脚なので手ブレなし'}（風車は${s.t >= 1 / 60 ? '流れて写る' : s.t <= 1 / 1000 ? '止まって写る' : '少し流れる'}）`,
            `ボケ：ピント ${distanceText(fd)}、くっきり写るのは前後 ${dof.far === Infinity ? '∞まで' : distanceText(dof.far - dof.near)}。${e.bokeh}`,
            `ノイズ：${e.noise}`,
            `焦点距離：被写体まで ${distanceText(rig.subjectDistance())}。${s.mm <= 28 ? '近いので遠近感が強く、背景が広く入る' : s.mm >= 100 ? '離れているので平たく写り、背景が迫る' : '見た目に近い自然な遠近感'}`,
            afMode === 'tap' ? 'ピント：タップした場所に合わせています' : 'ピント：被写体（目・レンズ・カップ）に自動で合わせています',
          ];
          tips.innerHTML = lines.map((l) => `<li>${l}</li>`).join('');
        }
      },
    };
  });
});

