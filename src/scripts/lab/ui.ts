import type * as THREE from 'three';
import { mountStage, type Demo } from '../gl/stage';
import { apertureText, distanceText, shutterText } from './optics';

export type Format = 'mm' | 'f' | 'ss' | 'iso' | 'm' | 'ev' | 'x' | 'raw';

export const format = (kind: Format, v: number): string => {
  switch (kind) {
    case 'mm':
      return `${Math.round(v)}mm`;
    case 'f':
      return apertureText(v);
    case 'ss':
      return shutterText(v);
    case 'iso':
      return `ISO ${v}`;
    case 'm':
      return distanceText(v);
    case 'ev':
      return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 1)}`;
    case 'x':
      return `×${v}`;
    default:
      return String(v);
  }
};

/**
 * Wire up every `[data-ladder]` slider inside `root` (see LabSlider.astro).
 * Returns a setter that moves a slider without firing `onChange`.
 */
export function bindLadders(root: ParentNode, onChange: (key: string, value: number) => void) {
  const map = new Map<string, { input: HTMLInputElement; stops: number[]; out: Element | null; kind: Format }>();
  root.querySelectorAll<HTMLElement>('[data-ladder]').forEach((wrap) => {
    const input = wrap.querySelector('input')!;
    const stops = JSON.parse(wrap.dataset.stops ?? '[]') as number[];
    const kind = (wrap.dataset.format ?? 'raw') as Format;
    const out = wrap.querySelector('output');
    const key = wrap.dataset.ladder!;
    map.set(key, { input, stops, out, kind });
    const sync = () => {
      const v = stops[Number(input.value)];
      if (out) out.textContent = format(kind, v);
      wrap.style.setProperty('--p', String(Number(input.value) / Math.max(1, stops.length - 1)));
      return v;
    };
    sync();
    input.addEventListener('input', () => onChange(key, sync()));
  });
  return (key: string, value: number) => {
    const s = map.get(key);
    if (!s) return;
    const linear = s.stops.some((v) => v <= 0);
    const gap = (a: number, b: number) => (linear ? Math.abs(a - b) : Math.abs(Math.log(a / b)));
    let best = 0;
    s.stops.forEach((v, i) => {
      if (gap(v, value) < gap(s.stops[best], value)) best = i;
    });
    s.input.value = String(best);
    if (s.out) s.out.textContent = format(s.kind, s.stops[best]);
    s.input.closest<HTMLElement>('[data-ladder]')?.style.setProperty('--p', String(best / Math.max(1, s.stops.length - 1)));
  };
}

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

/** Run `fn` for every element matching `[data-proposal=id]`. */
export function eachProposal(id: string, fn: (root: HTMLElement) => void) {
  document.querySelectorAll<HTMLElement>(`[data-proposal="${id}"]`).forEach(fn);
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
