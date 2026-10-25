import { World } from '../world';
import { Rig, dragLook } from '../rig';
import { apertureText, depthOfField, distanceText } from '../optics';
import { bindLadders, bindSegments, eachProposal, lazyStage, setText, whenReady } from '../ui';
import type { SubjectId } from '../subjects';

/** x position (0..1) of a distance on a log axis from 0.3 m to 60 m. */
const axis = (d: number) => Math.max(0, Math.min(1, Math.log(d / 0.3) / Math.log(60 / 0.3)));

/* ボケ A: a side view of the zone that is sharp */
eachProposal('depth-a', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const band = root.querySelector<SVGRectElement>('[data-band]')!;
  const focusLine = root.querySelector<SVGLineElement>('[data-focus-line]')!;
  const subj = root.querySelector<SVGGElement>('[data-subj]')!;
  const gates = root.querySelector<SVGGElement>('[data-gates]')!;
  const nearT = root.querySelector('[data-near]');
  const farT = root.querySelector('[data-far]');
  const readout = root.querySelector('[data-readout]');
  const X0 = 40;
  const X1 = 600;
  const x = (d: number) => X0 + axis(d) * (X1 - X0);
  for (let i = 0; i < 34; i += 3) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    g.setAttribute('width', '3');
    g.setAttribute('height', '30');
    g.setAttribute('y', '62');
    g.dataset.i = String(i);
    gates.appendChild(g);
  }
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', torii: true });
    const rig = new Rig(renderer, world, { mm: 85, N: 2.8, autoExpose: true });
    whenReady(stage, world.ready);
    dragLook(stage, rig);
    let focusOffset = 0;
    bindLadders(root, (k, v) => {
      if (k === 'shift') focusOffset = v;
      else rig.set({ [k]: v });
    });
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        const d = rig.subjectDistance(rig.target);
        rig.set({ focus: Math.max(0.3, d + focusOffset) });
        rig.render(t, dt);
        const s = rig.now;
        const fd = s.focus ?? d;
        const dof = depthOfField(s.mm, s.N, fd);
        const xn = x(dof.near);
        const xf = dof.far === Infinity ? X1 + 20 : x(dof.far);
        band.setAttribute('x', xn.toFixed(1));
        band.setAttribute('width', Math.max(2, xf - xn).toFixed(1));
        focusLine.setAttribute('x1', x(fd).toFixed(1));
        focusLine.setAttribute('x2', x(fd).toFixed(1));
        subj.setAttribute('transform', `translate(${x(rig.subjectDistance()).toFixed(1)} 0)`);
        gates.querySelectorAll('rect').forEach((r) => r.setAttribute('x', x(rig.subjectDistance() + 2.2 + 0.9 * Number(r.dataset.i)).toFixed(1)));
        setText(nearT, distanceText(dof.near));
        setText(farT, dof.far === Infinity ? '∞' : distanceText(dof.far));
        setText(readout, `${Math.round(s.mm)}mm ${apertureText(s.N)} ・ ピント ${distanceText(fd)} ・ くっきり写る範囲 ${dof.far === Infinity ? '∞まで' : distanceText(dof.far - dof.near)}`);
      },
    };
  });
});

/* ボケ B: tap a chess piece to focus on it */
eachProposal('depth-b', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const af = root.querySelector<HTMLElement>('.af');
  const readout = root.querySelector('[data-readout]');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'autumn', subject: 'chess' });
    const rig = new Rig(renderer, world, { mm: 85, N: 2, autoExpose: true, yaw: 0.5, pitch: -0.16, frame: 0.3 });
    whenReady(stage, world.ready);
    bindLadders(root, (k, v) => rig.set({ [k]: v }));
    stage.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button,input')) return;
      const r = stage.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      const d = rig.pickFocus(u, v);
      if (d) {
        rig.set({ focus: d });
        if (af) {
          af.style.left = `${u * 100}%`;
          af.style.top = `${v * 100}%`;
          af.classList.remove('hit');
          void af.offsetWidth;
          af.classList.add('hit');
        }
      }
    });
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        const fd = s.focus ?? rig.autoFocus();
        const dof = depthOfField(s.mm, s.N, fd);
        setText(readout, `${apertureText(s.N)} ・ ピント ${distanceText(fd)} ・ 前後 ${Math.round((dof.far - dof.near) * 100)}cm がくっきり`);
      },
    };
  });
});

/* ボケ C: aperture blades and the shape of bokeh */
eachProposal('depth-c', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const iris = root.querySelector<SVGGElement>('[data-iris]')!;
  const hole = root.querySelector<SVGPolygonElement>('[data-hole]')!;
  const readout = root.querySelector('[data-readout]');
  let blades = 9;
  const drawIris = (N: number) => {
    const r = 70 * (1.4 / N) ** 0.85;
    const n = blades || 48;
    const amt = blades ? Math.min(1, Math.max(0, (Math.log2(N) - 1) / 2.2)) : 0;
    const pts: string[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const seg = (Math.PI * 2) / n;
      const xx = ((a - 0.3) % seg + seg) % seg - seg / 2;
      const poly = Math.cos(seg / 2) / Math.cos(xx);
      const rr = r * (1 + (poly - 1) * amt);
      pts.push(`${(100 + Math.cos(a) * rr).toFixed(1)},${(100 + Math.sin(a) * rr).toFixed(1)}`);
    }
    hole.setAttribute('points', pts.join(' '));
    iris.style.setProperty('--rot', `${(1.4 / N) * 40}deg`);
  };
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'night', subject: 'horse' });
    const rig = new Rig(renderer, world, { mm: 135, N: 2.8, autoExpose: true, frame: 0.5, blades: 9, pitch: -0.12 });
    whenReady(stage, world.ready);
    dragLook(stage, rig);
    bindLadders(root, (k, v) => rig.set({ [k]: v }));
    bindSegments(root, 'blades', (v) => {
      blades = Number(v);
      rig.set({ blades });
    });
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        drawIris(rig.now.N);
        setText(readout, `${apertureText(rig.now.N)} ・ ${blades ? `絞り羽根 ${blades}枚` : '円形絞り'}`);
      },
    };
  });
});

/* ボケ D: a focus ring with distance and depth-of-field scales, and focus peaking */
eachProposal('depth-d', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const ring = root.querySelector<HTMLElement>('[data-ring]')!;
  const track = root.querySelector<HTMLElement>('[data-ring-track]')!;
  const dofMarks = root.querySelector<HTMLElement>('[data-dof]')!;
  const readout = root.querySelector('[data-readout]');
  // ring position 0..1 maps to 1/distance, as on a real lens
  const MIN = 0.35;
  const toDist = (p: number) => 1 / (1 / MIN - p * (1 / MIN));
  const toPos = (d: number) => (d === Infinity ? 1 : 1 - MIN / d);
  let pos = toPos(1.05);
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'studio', subject: 'stilllife' });
    const rig = new Rig(renderer, world, { mm: 50, N: 2, autoExpose: true, peaking: true, frame: 0.5, pitch: 0.05 });
    whenReady(stage, world.ready);
    bindLadders(root, (k, v) => rig.set({ [k]: v }));
    root.querySelector<HTMLButtonElement>('[data-toggle="peak"]')?.addEventListener('click', (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      rig.set({ peaking: on });
    });
    let drag: { x: number; pos: number } | null = null;
    ring.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, pos };
      ring.setPointerCapture(e.pointerId);
    });
    ring.addEventListener('pointermove', (e) => {
      if (!drag) return;
      pos = Math.max(0, Math.min(0.995, drag.pos - (e.clientX - drag.x) / ring.clientWidth));
    });
    ring.addEventListener('pointerup', () => (drag = null));
    ring.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') pos = Math.min(0.995, pos + 0.02);
      if (e.key === 'ArrowRight') pos = Math.max(0, pos - 0.02);
    });
    ring.addEventListener('wheel', (e) => {
      e.preventDefault();
      pos = Math.max(0, Math.min(0.995, pos + e.deltaY * 0.0006));
    }, { passive: false });
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        const fd = toDist(pos);
        rig.set({ focus: fd });
        rig.render(t, dt);
        // the scale slides under the fixed index mark in the middle
        track.style.transform = `translateX(${(0.5 - pos) * 100}%)`;
        const dof = depthOfField(rig.now.mm, rig.now.N, rig.now.focus ?? fd);
        const span = toPos(dof.far) - toPos(dof.near);
        dofMarks.style.width = `${Math.max(0.6, span * 100)}%`;
        dofMarks.style.left = `${(toPos(dof.near) - pos + 0.5) * 100}%`;
        setText(readout, `ピント ${distanceText(fd)} ・ ${apertureText(rig.now.N)} ・ くっきり ${distanceText(dof.near)}〜${dof.far === Infinity ? '∞' : distanceText(dof.far)}`);
      },
    };
  });
  // distance labels along the ring
  [0.35, 0.45, 0.6, 0.8, 1, 1.5, 2, 3, 5, 10, Infinity].forEach((d) => {
    const s = document.createElement('span');
    s.textContent = d === Infinity ? '∞' : d < 1 ? String(d) : String(d);
    s.style.left = `${toPos(d) * 100}%`;
    track.appendChild(s);
  });
});

/* ボケ E: phone, APS-C and full frame side by side */
eachProposal('depth-e', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-sensor]'));
  const sensors = [
    { name: 'スマホ（1/1.3型）', crop: 4.6 },
    { name: 'APS-C', crop: 1.5 },
    { name: 'フルサイズ', crop: 1 },
  ];
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'mannequin' });
    const rigs = sensors.map((s) => new Rig(renderer, world, { mm: 50 / s.crop, crop: s.crop, N: 1.8, autoExpose: true, frame: 1 }, { maxSubframes: 1, maxCoc: 14 }));
    whenReady(stage, world.ready);
    bindLadders(root, (k, v) => rigs.forEach((r) => r.set(k === 'N' ? { N: v } : {})));
    bindSegments(root, 'subject', (v) => world.setSubject(v as SubjectId));
    let w = 2;
    let h = 2;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        h = ch;
        rigs.forEach((r) => r.resize(cw / 3, ch, dpr));
      },
      render(t, dt) {
        rigs.forEach((r, i) => {
          r.look.x = Math.sin(t * 0.25) * 0.12;
          r.render(t, dt, { x: (i * w) / 3, y: 0, w: w / 3 - (i < 2 ? 2 : 0), h });
          const s = r.now;
          setText(labels[i].querySelector('b'), sensors[i].name);
          setText(labels[i].querySelector('span'), `${(s.mm).toFixed(s.mm < 20 ? 1 : 0)}mm ${apertureText(s.N)}（フルサイズ換算 ${apertureText(s.N * sensors[i].crop)} 相当）`);
        });
      },
    };
  });
});
