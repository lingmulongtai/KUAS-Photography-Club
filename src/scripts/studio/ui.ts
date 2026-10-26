import type * as THREE from 'three';
import { mountStage, type Demo } from '../gl/stage';

/** Flash compensation and the like: +1, −0.7, ±0. */
export const evText = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 1)}`;

/** Buttons with `data-seg="name" data-value="…"` act as a radio group. */
export function bindSegments(root: ParentNode, name: string, onChange: (value: string) => void) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(`[data-seg="${name}"]`));
  const select = (b: HTMLButtonElement) => buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      select(b);
      onChange(b.dataset.value!);
    }),
  );
  return (value: string) => {
    const b = buttons.find((x) => x.dataset.value === value);
    if (b) select(b);
  };
}

/** Mount a WebGL demo on `el` when it first comes near the viewport. */
export function lazyStage(el: HTMLElement, factory: (renderer: THREE.WebGLRenderer, el: HTMLElement) => Demo) {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      mountStage(el, factory, { maxDpr: 1.5, antialias: false });
    },
    { rootMargin: '400px 0px' },
  );
  io.observe(el);
}

/** Hide the loading veil once the scene's assets are in. */
export function whenReady(el: HTMLElement, ready: Promise<unknown>) {
  ready
    .then(() => el.classList.add('is-ready'))
    .catch((err) => {
      console.error(err);
      el.classList.add('is-failed');
    });
}

export function setText(el: Element | null | undefined, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Draw a histogram into a canvas. */
export function drawHistogram(canvas: HTMLCanvasElement, bins: Float32Array) {
  const g = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 1; i < 4; i++) g.fillRect((w * i) / 4, 0, 1, h);
  g.beginPath();
  g.moveTo(0, h);
  bins.forEach((v, i) => g.lineTo((i / (bins.length - 1)) * w, h - v * (h - 2)));
  g.lineTo(w, h);
  g.closePath();
  g.fillStyle = 'rgba(243,239,230,.75)';
  g.fill();
  if (bins[bins.length - 1] > 0.05) {
    g.fillStyle = '#ff5a4f';
    g.fillRect(w - 3, 0, 3, h);
  }
  if (bins[0] > 0.05) {
    g.fillStyle = '#4fa3ff';
    g.fillRect(0, 0, 3, h);
  }
}
