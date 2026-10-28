// Adapted from Glisse by Kelvin Zhang (MIT), refraction.ts at 61c1f6c.
// License: licenses/glisse-MIT.txt. The scene itself is never copied or read back.

const SVG = 'http://www.w3.org/2000/svg';
const MAX_PIXELS = 40_000;
const MAX_LENSES = 8;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Glisse's glass profile and rim map, at one sample per CSS pixel. */
export function glassMap(width: number, height: number, radius: number) {
  width = Math.round(width); height = Math.round(height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(radius) || width < 1 || height < 1 || width * height > MAX_PIXELS) return null;
  radius = clamp(radius, 0, Math.min(width, height) / 2);
  const bezel = clamp(Math.min(width, height) * .12, 4, 10);
  const thickness = clamp(Math.min(width, height) * .2, 8, 24);
  const samples = new Float32Array(128);
  let maximum = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = Math.max(.001, i / (samples.length - 1));
    const surface = (1 - (1 - t) ** 4) ** .25;
    const incident = Math.atan((1 - t) ** 3 / surface ** 3);
    const refracted = Math.asin(Math.sin(incident) / 1.5);
    samples[i] = Math.tan(incident - refracted) * (thickness + surface * bezel);
    maximum = Math.max(maximum, samples[i]);
  }
  const field = new Uint8ClampedArray(width * height * 4);
  const shine = new Uint8ClampedArray(field.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + .5 - width / 2, py = y + .5 - height / 2;
    const qx = Math.abs(px) - (width / 2 - radius), qy = Math.abs(py) - (height / 2 - radius);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), length = Math.hypot(ox, oy);
    const distance = radius - (length + Math.min(Math.max(qx, qy), 0));
    const nx = length > 0 ? ox / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
    const ny = length > 0 ? oy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py);
    let shift = 0;
    if (distance >= 0 && distance < bezel) {
      const sample = distance / bezel * (samples.length - 1), lower = Math.floor(sample);
      shift = samples[lower] + (samples[Math.min(lower + 1, samples.length - 1)] - samples[lower]) * (sample - lower);
    }
    const i = (y * width + x) * 4;
    field[i] = Math.round(127.5 - nx * shift / maximum * 127.5);
    field[i + 1] = Math.round(127.5 - ny * shift / maximum * 127.5);
    field[i + 2] = 128; field[i + 3] = 255;
    const light = -(nx + ny) * Math.SQRT1_2;
    const glint = Math.max(light, 0) ** 3, reflected = Math.max(-light, 0) ** 3;
    const rim = Math.exp(-(((distance - .4) / .38) ** 2));
    const bloom = Math.exp(-((distance / (bezel * .22)) ** 2));
    shine[i] = shine[i + 1] = shine[i + 2] = 255;
    shine[i + 3] = distance >= 0 ? Math.round(clamp(rim * (.045 + .52 * glint + .2 * reflected) + bloom * .02 * glint, 0, 1) * 255) : 0;
  }
  return { width, height, field, shine, scale: maximum * 2 };
}

type Lens = { filter: SVGFilterElement; filterValue: string; rim: string; users: number };
const lenses = new Map<string, Lens>();
let defs: SVGDefsElement | undefined;
let nextId = 0;

function svg(name: string, attributes: Record<string, string | number>) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function makeLens(width: number, height: number, radius: number): Lens | null {
  const map = glassMap(width, height, radius);
  if (!map) return null;
  const canvas = document.createElement('canvas');
  canvas.width = map.width; canvas.height = map.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(map.width, map.height);
  image.data.set(map.field); context.putImageData(image, 0, 0);
  const displacement = canvas.toDataURL();
  image.data.set(map.shine); context.putImageData(image, 0, 0);
  const rim = canvas.toDataURL();
  if (!defs?.isConnected) {
    const root = svg('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    root.style.cssText = 'position:absolute;pointer-events:none';
    defs = svg('defs', {}) as SVGDefsElement;
    root.append(defs); document.body.append(root);
  }
  const id = `kuas-glisse-${nextId++}`;
  const box = { x: 0, y: 0, width: map.width, height: map.height };
  const filter = svg('filter', { id, ...box, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }) as SVGFilterElement;
  filter.append(svg('feImage', { href: displacement, ...box, preserveAspectRatio: 'none', result: 'field' }));
  filter.append(svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'field', scale: map.scale, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }));
  filter.append(svg('feGaussianBlur', { in: 'bent', stdDeviation: .4, result: 'displaced' }));
  filter.append(svg('feColorMatrix', { in: 'displaced', type: 'saturate', values: 1.5 }));
  defs.append(filter);
  return { filter, filterValue: `url("#${id}")`, rim: `url("${rim}")`, users: 0 };
}

/** Apply a bounded, cached lens; SVG backdrop filters are supported by Chromium. */
export function mountGlassRefraction(element: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
  const chromium = /Chrom(?:e|ium)\//.test(navigator.userAgent);
  let active: Lens | undefined;
  let timer = 0;
  let idle = 0;
  let stopped = false;
  const release = () => {
    if (active) active.users--;
    active = undefined;
    element.style.removeProperty('--glisse-filter');
    element.style.removeProperty('--glisse-rim');
    delete element.dataset.glisseRefraction;
  };
  const fit = () => {
    idle = 0;
    if (stopped || reduced.matches || !element.isConnected) { release(); return; }
    const width = element.offsetWidth, height = element.offsetHeight;
    if (!width || !height) { release(); return; }
    const corner = getComputedStyle(element).borderTopLeftRadius;
    const radius = corner.endsWith('%') ? Math.min(width, height) * parseFloat(corner) / 100 : parseFloat(corner);
    const key = `${width}:${height}:${radius}`;
    let lens = lenses.get(key);
    if (!lens) {
      if (lenses.size >= MAX_LENSES) {
        const unused = [...lenses].find(([, value]) => value.users === 0);
        if (!unused) { release(); return; }
        unused[1].filter.remove(); lenses.delete(unused[0]);
      }
      try { lens = makeLens(width, height, radius) ?? undefined; } catch { lens = undefined; }
      if (!lens) { release(); return; }
      lenses.set(key, lens);
    }
    if (active !== lens) { release(); active = lens; lens.users++; }
    element.style.setProperty('--glisse-filter', lens.filterValue);
    element.style.setProperty('--glisse-rim', lens.rim);
    element.dataset.glisseRefraction = 'ready';
  };
  const cancel = () => { clearTimeout(timer); if (idle && 'cancelIdleCallback' in window) cancelIdleCallback(idle); idle = 0; };
  const schedule = () => {
    cancel();
    if (!chromium || reduced.matches || !CSS.supports('backdrop-filter', 'url("#x")')) { release(); return; }
    timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) idle = requestIdleCallback(fit, { timeout: 1000 });
      else fit();
    }, 180);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  reduced.addEventListener('change', schedule);
  schedule();
  return () => { stopped = true; cancel(); observer.disconnect(); reduced.removeEventListener('change', schedule); release(); };
}
