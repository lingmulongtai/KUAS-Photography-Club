import * as THREE from 'three';

/**
 * A WebGL demo that lives inside a `.stage` element.
 * The stage runtime owns the renderer, sizing, visibility and the animation clock;
 * a demo only knows how to resize and draw one frame.
 */
export interface Demo {
  /** Clock value (seconds) to start from, so the first still frame looks good. */
  t0?: number;
  resize(width: number, height: number, dpr: number): void;
  /** `dt` is 0 for still frames (first paint, resize, reduced motion). */
  render(t: number, dt: number): void;
}

export type DemoFactory = (renderer: THREE.WebGLRenderer, el: HTMLElement) => Demo;

export interface StageOptions {
  maxDpr?: number;
  antialias?: boolean;
  /** Keep animating while scrolled out of view (default false). */
  alwaysOn?: boolean;
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface StageState {
  el: HTMLElement;
  demo: Demo;
  t: number;
  visible: boolean;
  alwaysOn: boolean;
  w: number;
  h: number;
}

const stages = new Map<HTMLElement, StageState>();
let loopStarted = false;
let observer: IntersectionObserver | null = null;

function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      const still = reducedMotion();
      stages.forEach((st) => {
        if (!st.visible && !st.alwaysOn) return;
        const d = still ? 0 : dt;
        st.t += d;
        st.demo.render(st.t, d);
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function getObserver() {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const st = stages.get(entry.target as HTMLElement);
          if (st) st.visible = entry.isIntersecting;
        }
      },
      { rootMargin: '160px 0px' },
    );
  }
  return observer;
}

/** Create a renderer for `el`'s canvas and run `factory`'s demo in it. Falls back to a still background on failure. */
export function mountStage(el: HTMLElement, factory: DemoFactory, options: StageOptions = {}): Demo | null {
  const canvas = el.querySelector('canvas');
  if (!canvas) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: options.antialias ?? true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    console.warn('WebGL unavailable', err);
    el.classList.add('no-gl');
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, options.maxDpr ?? 1.75);
  renderer.setPixelRatio(dpr);

  let demo: Demo;
  try {
    demo = factory(renderer, el);
  } catch (err) {
    console.error(err);
    el.classList.add('no-gl');
    renderer.dispose();
    return null;
  }

  const st: StageState = { el, demo, t: demo.t0 ?? 0, visible: false, alwaysOn: !!options.alwaysOn, w: 0, h: 0 };
  stages.set(el, st);

  const fit = () => {
    const r = el.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width));
    const h = Math.max(2, Math.round(r.height));
    if (w === st.w && h === st.h) return;
    st.w = w;
    st.h = h;
    renderer.setSize(w, h, false);
    demo.resize(w, h, dpr);
    demo.render(st.t, 0);
  };
  fit();
  new ResizeObserver(fit).observe(el);
  getObserver().observe(el);
  el.classList.add('live');
  startLoop();
  return demo;
}

/** Mount every `.stage[data-demo=name]` on the page with the matching factory. */
export function mountAll(name: string, factory: DemoFactory, options?: StageOptions) {
  document.querySelectorAll<HTMLElement>(`.stage[data-demo="${name}"]`).forEach((el) => mountStage(el, factory, options));
}

/* ---------- pointer helper ---------- */

export interface Pointer {
  /** -1..1, left to right */
  x: number;
  /** -1..1, bottom to top */
  y: number;
  inside: boolean;
}

export function trackPointer(el: HTMLElement): Pointer {
  const p: Pointer = { x: 0, y: 0, inside: false };
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    p.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    p.y = 1 - ((e.clientY - r.top) / r.height) * 2;
    p.inside = true;
  });
  el.addEventListener('pointerleave', () => {
    p.inside = false;
  });
  return p;
}

/** Fraction of the element (0..1, y up) under a pointer event. */
export function eventUV(el: HTMLElement, e: PointerEvent | MouseEvent): [number, number] {
  const r = el.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
}

export function setText(el: Element | null, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}

export function press(buttons: HTMLElement[], active: HTMLElement) {
  buttons.forEach((b) => b.setAttribute('aria-pressed', b === active ? 'true' : 'false'));
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
