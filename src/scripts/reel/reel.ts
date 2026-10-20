import { TAU, cardPose, easeOutQuart, layoutFor, photoFor, ringPose, type ReelLayout } from './pose';
import type { ReelCard } from '../../data/reel-placeholders';

/*
 * The photo reel at the top of the trips page. On arrival the cards are dealt round a small
 * ring while a counter shows how many photos have loaded; once both are done the ring opens
 * around the viewer and keeps turning slowly. Drag, swipe, the arrow keys or the buttons turn
 * it; a spring follows so it never snaps. Sixteen cards (twelve on phones) show any number of
 * photos: each card takes the next photo while it is behind the viewer.
 *
 * Plain CSS 3D transforms. Card poses come from pose.ts.
 */


const DEAL_MS = 1500;
const REVEAL_MS = 1700;
/** reveal anyway if photos are this slow */
const WAIT_MS = 4500;
const AUTO_SPIN = 0.07;
const SEEN_KEY = 'kuas-reel-seen';

export function mountReel(root: HTMLElement) {
  const photos = JSON.parse(root.dataset.photos ?? '[]') as ReelCard[];
  const stage = root.querySelector<HTMLElement>('[data-reel-stage]')!;
  const ring = root.querySelector<HTMLElement>('[data-reel-ring]')!;
  const slots = Array.from(ring.querySelectorAll<HTMLAnchorElement>('[data-slot]'));
  const digits = Array.from(root.querySelectorAll<HTMLElement>('[data-digit]'));
  const caption = root.querySelector<HTMLElement>('[data-scramble]');
  const skip = root.querySelector<HTMLButtonElement>('[data-skip]');
  if (!photos.length || !slots.length) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // storage blocked: just play the entrance
  }

  let layout: ReelLayout = layoutFor(stage.clientWidth || 1280);
  let phase: 'deal' | 'reveal' | 'open' = reduced || seen ? 'open' : 'deal';
  let formation = phase === 'open' ? 1 : 0;
  let expansion = phase === 'open' ? 1 : 0;
  let spin = 0;
  let target = 0;
  const start = performance.now();
  let revealAt = 0;

  /* ---- what each slot shows ---- */
  const shown = slots.map(() => -1);
  const show = (slot: number, index: number) => {
    if (shown[slot] === index) return;
    shown[slot] = index;
    const p = photos[index];
    const el = slots[slot];
    const img = el.querySelector('img')!;
    const art = el.querySelector<HTMLElement>('[data-art]')!;
    el.classList.toggle('is-art', !p.src);
    if (p.src) {
      img.hidden = false;
      img.src = p.src;
      img.alt = p.alt;
      art.hidden = true;
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      img.alt = '';
      art.hidden = false;
      art.style.setProperty('--art', p.art ?? '');
      art.querySelector('[data-art-name]')!.textContent = p.title;
    }
    el.querySelector('[data-title]')!.textContent = p.title;
    el.querySelector('[data-meta]')!.textContent = p.meta;
    if (p.href) el.href = p.href;
    else el.removeAttribute('href');
    el.setAttribute('aria-label', `${p.title} ${p.meta}`);
  };

  /* ---- loading progress: the first photos on the ring ---- */
  let loaded = 0;
  let ready = false;
  const firstCount = Math.min(layout.count, slots.length);
  const counted = new Set<HTMLImageElement>();
  const progress = () => {
    const pct = Math.round((loaded / firstCount) * 100);
    const text = String(pct).padStart(3, '0');
    digits.forEach((d, i) => d.style.setProperty('--d', text[i]));
    if (loaded >= firstCount) ready = true;
  };
  for (let i = 0; i < firstCount; i++) {
    show(i, photoFor(i, 0, layout.count, photos.length));
    const img = slots[i].querySelector('img')!;
    const done = () => {
      if (counted.has(img)) return;
      counted.add(img);
      loaded++;
      progress();
    };
    // drawn cards have nothing to load
    if (!photos[photoFor(i, 0, layout.count, photos.length)].src || (img.complete && img.naturalWidth)) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  }
  progress();

  // the caption types itself in from scrambled letters
  if (caption && phase === 'deal') {
    const word = caption.textContent ?? '';
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      caption.textContent = [...word].map((c, i) => (c === ' ' || i < tick / 2 ? c : glyphs[(Math.random() * glyphs.length) | 0])).join('');
      if (tick / 2 >= word.length) clearInterval(timer);
    }, 45);
  }

  /* ---- entrance ---- */
  const finishEntrance = () => {
    if (phase !== 'open') {
      phase = 'open';
      formation = 1;
      expansion = 1;
    }
    root.classList.add('is-open');
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // fine
    }
  };
  if (phase === 'open') finishEntrance();
  else root.classList.add('is-entering');
  skip?.addEventListener('click', finishEntrance);
  const onKey = (e: KeyboardEvent) => {
    if (phase !== 'open' && (e.key === 'Escape' || e.key === 'Tab')) finishEntrance();
  };
  addEventListener('keydown', onKey);

  /* ---- turning it ---- */
  const step = TAU / layout.count;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let hover = false;
  let idleUntil = 0;
  const pxToAngle = () => 1 / (layout.perspective * 1.15);
  stage.addEventListener('pointerdown', (e) => {
    if (phase !== 'open' || (e.target as HTMLElement).closest('button')) return;
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    stage.setPointerCapture(e.pointerId);
    root.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    target += dx * pxToAngle();
    if (reduced) spin = target;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    idleUntil = performance.now() + 2500;
    root.classList.remove('is-dragging');
    // land on a card
    target = Math.round(target / step) * step;
    if (reduced) spin = target;
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  // a drag is not a click on the card under the pointer
  stage.addEventListener('click', (e) => {
    if (moved > 6) {
      e.preventDefault();
      e.stopPropagation();
    }
    moved = 0;
  }, true);
  // sideways wheel (trackpads) turns the ring; vertical wheel still scrolls the page
  stage.addEventListener('wheel', (e) => {
    if (phase !== 'open' || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    target -= e.deltaX * pxToAngle();
    idleUntil = performance.now() + 2500;
    if (reduced) spin = target;
  }, { passive: false });
  const turn = (by: number) => {
    target = Math.round(target / step) * step + by * step;
    idleUntil = performance.now() + 4000;
    if (reduced) spin = target;
  };
  root.querySelector('[data-prev]')?.addEventListener('click', () => turn(1));
  root.querySelector('[data-next]')?.addEventListener('click', () => turn(-1));
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') turn(1);
    else if (e.key === 'ArrowRight') turn(-1);
    else return;
    e.preventDefault();
  });
  stage.addEventListener('pointerenter', () => (hover = true));
  stage.addEventListener('pointerleave', () => (hover = false));
  // bring a card that gets keyboard focus round to the front
  slots.forEach((el, i) =>
    el.addEventListener('focus', () => {
      const p = cardPose(i, layout, { formation, expansion, spin });
      target = spin - p.angle;
      idleUntil = performance.now() + 4000;
      if (reduced) spin = target;
    }),
  );

  addEventListener('resize', () => {
    layout = layoutFor(stage.clientWidth || 1280);
  });

  /* ---- frame loop, paused while off screen ---- */
  let visible = true;
  let running = false;
  const run = () => {
    if (running || !visible) return;
    running = true;
    prev = performance.now();
    requestAnimationFrame(frame);
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  }).observe(root);

  const last = { tilt: '', roll: '', p: '', w: '' };
  const transforms = slots.map(() => '');
  const opacities = slots.map(() => '');
  let prev = performance.now();
  function frame(now: number) {
    if (!visible) {
      running = false;
      return;
    }
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    if (phase === 'deal') {
      formation = Math.min(1, (now - start) / DEAL_MS);
      if (formation >= 1 && (ready || now - start > WAIT_MS)) {
        phase = 'reveal';
        revealAt = now;
      }
    }
    if (phase === 'reveal') {
      const x = Math.min(1, (now - revealAt) / REVEAL_MS);
      expansion = easeOutQuart(x);
      if (x > 0.55) root.classList.add('is-open');
      if (x >= 1) finishEntrance();
    }
    if (phase !== 'deal' && !reduced) {
      if (!dragging && !hover && now > idleUntil && !root.contains(document.activeElement)) target -= AUTO_SPIN * dt;
      spin += (target - spin) * (1 - Math.exp(-dt * 6));
    }

    const r = ringPose(layout, expansion);
    const set = (key: keyof typeof last, el: HTMLElement, prop: string, value: string) => {
      if (last[key] !== value) {
        last[key] = value;
        el.style.setProperty(prop, value);
      }
    };
    set('tilt', ring, '--tilt', `${r.tilt.toFixed(3)}deg`);
    set('roll', ring, '--roll', `${r.roll.toFixed(3)}deg`);
    set('p', stage, '--p', `${r.perspective.toFixed(1)}px`);
    set('w', root, '--card-w', `${layout.width}px`);
    for (let i = 0; i < slots.length; i++) {
      const el = slots[i];
      if (i >= layout.count) {
        if (opacities[i] !== '0') {
          opacities[i] = '0';
          el.style.visibility = 'hidden';
          el.tabIndex = -1;
        }
        continue;
      }
      const pose = cardPose(i, layout, { formation, expansion, spin }, r);
      if (!pose.visible) show(i, photoFor(i, pose.cycle, layout.count, photos.length));
      if (transforms[i] !== pose.transform) {
        transforms[i] = pose.transform;
        el.style.transform = pose.transform;
      }
      const o = pose.visible ? pose.opacity.toFixed(3) : '0';
      if (opacities[i] !== o) {
        opacities[i] = o;
        el.style.opacity = o;
        el.style.visibility = pose.visible ? '' : 'hidden';
      }
      // only the cards in front can take focus
      const front = phase === 'open' && pose.visible && Math.abs(pose.angle) < 0.9;
      if (el.tabIndex !== (front ? 0 : -1)) el.tabIndex = front ? 0 : -1;
      el.toggleAttribute('aria-hidden', !front);
    }
    requestAnimationFrame(frame);
  }
  run();
}
