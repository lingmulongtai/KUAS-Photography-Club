import { LIGHT_COLORS, type LightSpec } from './lights';

/**
 * The floor plan ("立ち位置"): the subject, the camera with its angle of view, the lights,
 * and where the sun (or north) is. Drag the camera or a light to move it.
 */

export interface MapState {
  aim: { x: number; z: number };
  subject: string;
  camera: { x: number; z: number; heading: number; hfov: number };
  lights: LightSpec[];
  selected: number | null;
  /** Direction towards the sun on the floor, or null. */
  sun: { x: number; z: number } | null;
  /** Show north (for the night sky). */
  north: boolean;
  /** Flowers to draw as dots (x, z pairs). */
  dots: Float32Array | null;
}

export interface MapHandlers {
  camera(x: number, z: number): void;
  light(id: number, x: number, z: number): void;
  select(id: number | null): void;
}

/** Colours come from the page (CSS custom properties on the canvas), so the plan follows the site's light and dark themes. */
interface Palette {
  bg: string;
  grid: string;
  ink: string;
  muted: string;
  accent: string;
}

export class FloorMap {
  private g: CanvasRenderingContext2D;
  private scale = 60;
  private center = { x: 0, z: 0 };
  private drag: { kind: 'camera' } | { kind: 'light'; id: number } | null = null;
  private last: MapState | null = null;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private on: MapHandlers) {
    this.g = canvas.getContext('2d')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    const up = () => (this.drag = null);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  private toWorld(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { x: this.center.x + (px - r.width / 2) / this.scale, z: this.center.z + (py - r.height / 2) / this.scale, px, py };
  }

  private toScreen(x: number, z: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.width / 2 + (x - this.center.x) * this.scale, y: r.height / 2 + (z - this.center.z) * this.scale };
  }

  private down(e: PointerEvent) {
    const s = this.last;
    if (!s) return;
    const p = this.toWorld(e);
    const near = (x: number, z: number, r: number) => {
      const q = this.toScreen(x, z);
      return Math.hypot(q.x - p.px, q.y - p.py) < r;
    };
    const light = s.lights.find((l) => near(l.x, l.z, 18));
    if (light) {
      this.drag = { kind: 'light', id: light.id };
      this.on.select(light.id);
    } else if (near(s.camera.x, s.camera.z, 26)) {
      this.drag = { kind: 'camera' };
    } else {
      // a tap elsewhere moves the camera there
      this.drag = { kind: 'camera' };
      this.on.camera(p.x, p.z);
    }
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private move(e: PointerEvent) {
    if (!this.drag) return;
    const p = this.toWorld(e);
    if (this.drag.kind === 'camera') this.on.camera(p.x, p.z);
    else this.on.light(this.drag.id, p.x, p.z);
  }

  private palette(): Palette {
    const cs = getComputedStyle(this.canvas);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
      bg: v('--map-bg', '#f7fbfb'),
      grid: v('--map-grid', '#d4e7e9'),
      ink: v('--map-ink', '#1b363d'),
      muted: v('--map-muted', '#557079'),
      accent: v('--map-accent', '#3a9ca6'),
    };
  }

  draw(s: MapState) {
    this.last = s;
    const P = this.palette();
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr) || dpr !== this.dpr) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.dpr = dpr;
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // frame the subject, the camera and the lights; zoom smoothly (not while dragging)
    if (!this.drag) {
      const pts = [s.aim, { x: s.camera.x, z: s.camera.z }, ...s.lights];
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 0.5);
      const want = Math.min(w, h) / (extent * 1.6 + 0.4);
      this.scale += (want - this.scale) * 0.15;
      this.center.x += (cx - this.center.x) * 0.15;
      this.center.z += (cz - this.center.z) * 0.15;
    }

    // grid: 10 cm, 1 m or 5 m depending on the zoom
    const stepM = this.scale > 300 ? 0.1 : this.scale > 30 ? 1 : 5;
    g.strokeStyle = P.grid;
    g.lineWidth = 1;
    const x0 = this.center.x - w / 2 / this.scale;
    const z0 = this.center.z - h / 2 / this.scale;
    g.beginPath();
    for (let x = Math.ceil(x0 / stepM) * stepM; x < x0 + w / this.scale; x += stepM) {
      const sx = this.toScreen(x, 0).x;
      g.moveTo(sx, 0);
      g.lineTo(sx, h);
    }
    for (let z = Math.ceil(z0 / stepM) * stepM; z < z0 + h / this.scale; z += stepM) {
      const sy = this.toScreen(0, z).y;
      g.moveTo(0, sy);
      g.lineTo(w, sy);
    }
    g.stroke();

    if (s.dots) {
      g.fillStyle = 'rgba(214,96,150,.55)';
      for (let i = 0; i < s.dots.length; i += 2) {
        const q = this.toScreen(s.dots[i], s.dots[i + 1]);
        if (q.x < -4 || q.y < -4 || q.x > w + 4 || q.y > h + 4) continue;
        g.fillRect(q.x - 1, q.y - 1, 2, 2);
      }
    }

    // the camera's angle of view
    const cam = this.toScreen(s.camera.x, s.camera.z);
    const L = Math.max(w, h) * 1.5;
    const a0 = s.camera.heading - s.camera.hfov / 2;
    const a1 = s.camera.heading + s.camera.hfov / 2;
    const dir = (a: number) => ({ x: Math.sin(a), y: Math.cos(a) });
    g.fillStyle = withAlpha(P.accent, 0.16);
    g.strokeStyle = withAlpha(P.accent, 0.85);
    g.beginPath();
    g.moveTo(cam.x, cam.y);
    g.lineTo(cam.x + dir(a0).x * L, cam.y + dir(a0).y * L);
    g.lineTo(cam.x + dir(a1).x * L, cam.y + dir(a1).y * L);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cam.x + dir(a0).x * L, cam.y + dir(a0).y * L);
    g.lineTo(cam.x, cam.y);
    g.lineTo(cam.x + dir(a1).x * L, cam.y + dir(a1).y * L);
    g.stroke();

    // lights and their beams
    for (const l of s.lights) {
      const p = this.toScreen(l.x, l.z);
      const t = this.toScreen(s.aim.x, s.aim.z);
      const ang = Math.atan2(t.y - p.y, t.x - p.x);
      const col = LIGHT_COLORS[l.color][0];
      // daylight is near white: draw its beam warmer so it shows on a light plan
      const beam = l.color === 'day' ? '#f2c25c' : col;
      const spread = l.kind === 'soft' ? 0.6 : 0.25;
      const len = Math.hypot(t.x - p.x, t.y - p.y) * 1.15;
      const grad = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, len);
      grad.addColorStop(0, withAlpha(beam, 0.45));
      grad.addColorStop(1, withAlpha(beam, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.arc(p.x, p.y, len, ang - spread, ang + spread);
      g.closePath();
      g.fill();
      g.save();
      g.translate(p.x, p.y);
      g.rotate(ang);
      g.fillStyle = col;
      g.strokeStyle = l.id === s.selected ? P.accent : P.ink;
      g.lineWidth = l.id === s.selected ? 3 : 1.5;
      g.beginPath();
      if (l.kind === 'soft') g.rect(-5, -12, 10, 24);
      else g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }

    // subject
    const sp = this.toScreen(s.aim.x, s.aim.z);
    g.fillStyle = P.ink;
    g.beginPath();
    g.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
    g.fill();
    g.font = `700 11px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = P.ink;
    g.fillText(s.subject, sp.x, sp.y - 12);

    // the camera
    g.save();
    g.translate(cam.x, cam.y);
    g.rotate(-s.camera.heading);
    g.fillStyle = P.ink;
    g.strokeStyle = P.bg;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(-13, -9, 26, 14, 3);
    g.fill();
    g.stroke();
    g.fillStyle = P.accent;
    g.fillRect(-6, 5, 12, 8);
    g.restore();

    // sun or north
    g.font = `700 11px ${FONT}`;
    if (s.sun) {
      const len = Math.hypot(s.sun.x, s.sun.z) || 1;
      const ux = s.sun.x / len;
      const uz = s.sun.z / len;
      const r = Math.min(w, h) / 2 - 16;
      const x = w / 2 + ux * r;
      const y = h / 2 + uz * r;
      g.fillStyle = SUN;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(SUN, 0.6);
      g.beginPath();
      g.moveTo(x - ux * 12, y - uz * 12);
      g.lineTo(x - ux * 34, y - uz * 34);
      g.stroke();
      g.fillText('光源', x, y - 11);
    }
    if (s.north) {
      g.fillStyle = P.accent;
      g.fillText('北 ↑（北極星）', w / 2, 14);
      g.fillText('南（天の川）↓', w / 2, h - 6);
    }

    // scale bar
    const bar = stepM * this.scale;
    g.strokeStyle = P.muted;
    g.fillStyle = P.muted;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(10, h - 10);
    g.lineTo(10 + bar, h - 10);
    g.stroke();
    g.textAlign = 'left';
    g.fillText(stepM < 1 ? '10cm' : `${stepM}m`, 12 + bar, h - 6);
  }
}

const FONT = '"Zen Kaku Gothic New", system-ui, sans-serif';
const SUN = '#e0a11b';

/** A CSS colour (#rgb, #rrggbb or rgb()) with an alpha. */
function withAlpha(color: string, a: number) {
  let r = 0;
  let g = 0;
  let b = 0;
  if (color.startsWith('#')) {
    const h = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : color;
    const n = parseInt(h.slice(1, 7), 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = color.match(/[\d.]+/g);
    if (m) [r, g, b] = m.map(Number);
  }
  return `rgba(${r},${g},${b},${a})`;
}
