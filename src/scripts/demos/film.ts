import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { HASH, VS_QUAD, fullscreenQuad, quadCamera } from '../gl/shaders';

export interface FilmPhoto {
  src: string;
  /** Printed in the corner like a 90s compact camera, e.g. "'25 06 14". */
  stamp?: string;
  portrait?: boolean;
}

const FRAMES = 8;
const PITCH = 512;
const SH = 512;
const IW = 468;
const IH = 312;
const IY = (SH - IH) / 2;

/* ---------- the orange seven-segment date imprint ---------- */

const SEG: Record<string, string> = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

function stamp(g: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const dh = h * 0.06;
  const dw = dh * 0.55;
  const t = dh * 0.13;
  const gap = dw * 0.45;
  const rect: Record<string, number[]> = {
    a: [t * 0.5, 0, dw - t, t],
    b: [dw - t, t * 0.5, t, dh / 2 - t * 0.5],
    c: [dw - t, dh / 2, t, dh / 2 - t * 0.5],
    d: [t * 0.5, dh - t, dw - t, t],
    e: [0, dh / 2, t, dh / 2 - t * 0.5],
    f: [0, t * 0.5, t, dh / 2 - t * 0.5],
    g: [t * 0.5, dh / 2 - t / 2, dw - t, t],
  };
  let total = 0;
  for (const ch of text) total += ch === ' ' ? dw * 0.8 : ch === "'" ? dw * 0.45 : dw + gap;
  let x = w - h * 0.07 - total;
  const y = h - h * 0.07 - dh;
  g.save();
  g.fillStyle = '#ffa04a';
  g.shadowColor = 'rgba(255,110,30,.9)';
  g.shadowBlur = dh * 0.35;
  for (const ch of text) {
    if (ch === ' ') {
      x += dw * 0.8;
      continue;
    }
    if (ch === "'") {
      g.fillRect(x, y, t, dh * 0.3);
      x += dw * 0.45;
      continue;
    }
    g.save();
    g.translate(x + dh * 0.1, y);
    g.transform(1, 0, -0.1, 1, 0, 0);
    for (const sg of SEG[ch] ?? '') {
      const q = rect[sg];
      g.fillRect(q[0] + t * 0.08, q[1] + t * 0.08, q[2] - t * 0.16, q[3] - t * 0.16);
    }
    g.restore();
    x += dw + gap;
  }
  g.restore();
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draw one photo into a frame of the atlas; vertical shots lie sideways, as on a real negative strip. */
function drawFrame(g: CanvasRenderingContext2D, img: HTMLImageElement, x0: number, photo: FilmPhoto) {
  const pw = photo.portrait ? IH : IW;
  const ph = photo.portrait ? IW : IH;
  const tmp = document.createElement('canvas');
  tmp.width = pw;
  tmp.height = ph;
  const t = tmp.getContext('2d')!;
  const scale = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
  const sw = pw / scale;
  const sh = ph / scale;
  t.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, pw, ph);
  if (photo.stamp) stamp(t, pw, ph, photo.stamp);
  const cx = x0 + PITCH / 2;
  const cy = SH / 2;
  g.save();
  g.translate(cx, cy);
  if (photo.portrait) g.rotate(-Math.PI / 2);
  g.drawImage(tmp, -pw / 2, -ph / 2);
  g.restore();
}

/** An 8-frame strip texture: film base, sprocket holes, edge printing and the photos. */
function createStrip(photos: FilmPhoto[], firstNumber: number, maxAniso: number) {
  const cv = document.createElement('canvas');
  cv.width = FRAMES * PITCH;
  cv.height = SH;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  const loaded: (HTMLImageElement | null)[] = new Array(FRAMES).fill(null);

  const paint = () => {
    g.clearRect(0, 0, cv.width, SH);
    g.fillStyle = '#0d0907';
    g.fillRect(0, 0, cv.width, SH);
    g.font = '500 17px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    for (let i = 0; i < FRAMES; i++) {
      const x0 = i * PITCH;
      const n = firstNumber + i;
      const img = loaded[i];
      if (img) drawFrame(g, img, x0, photos[i % photos.length]);
      else {
        g.fillStyle = '#1b1411';
        g.fillRect(x0 + (PITCH - IW) / 2, IY, IW, IH);
      }
      g.fillStyle = '#f2a14a';
      g.fillText(String(n), x0 + 30, 84);
      g.fillText('▸ ' + n + 'A', x0 + PITCH / 2 + 20, 84);
      g.fillText('KUAS 400', x0 + 30, SH - 84);
      for (let b = 0; b < 14; b++) if ((n * 7 + b * 3) % 5 > 1) g.fillRect(x0 + PITCH - 150 + b * 8, SH - 92, 5, 16);
    }
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < FRAMES * 8; k++) {
      const hx = k * 64 + 19;
      rrect(g, hx, 22, 26, 38, 5);
      g.fill();
      rrect(g, hx, SH - 60, 26, 38, 5);
      g.fill();
    }
    g.restore();
    tex.needsUpdate = true;
  };

  paint();
  photos.slice(0, FRAMES).forEach((p, i) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      for (let k = i; k < FRAMES; k += photos.length) loaded[k] = img;
      paint();
    };
    img.src = p.src;
  });
  if (document.fonts?.ready) document.fonts.ready.then(paint);
  return tex;
}

const STRIP_VS = /* glsl */ `
  uniform float uTime, uPhase, uAmp;
  varying vec2 vUv;
  varying float vShade;
  void main(){
    vUv = uv;
    float x = position.x, y = position.y;
    float tw = sin(x * .21 + uTime * .23 + uPhase) * .6 * uAmp;
    vec3 p = vec3(x, 0., 0.);
    p.y = y * cos(tw) + sin(x * .25 + uTime * .31 + uPhase) * .5 * uAmp;
    p.z = y * sin(tw) + sin(x * .33 + uTime * .27 + uPhase * 1.7) * 1.1 * uAmp - .03 * x * x;
    vShade = .62 + .38 * abs(cos(tw));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const STRIP_FS = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uRep, uScroll, uDim;
  varying vec2 vUv;
  varying float vShade;
  void main(){
    vec4 t = texture2D(uTex, vec2(vUv.x * uRep + uScroll, vUv.y));
    if (t.a < .5) discard;
    float edge = smoothstep(0., .04, vUv.x) * smoothstep(1., .96, vUv.x);
    gl_FragColor = vec4(t.rgb * vShade * uDim * edge, 1.);
  }
`;

const COMP_FS = /* glsl */ `
  ${HASH}
  uniform sampler2D tScene;
  uniform float uTime;
  uniform vec2 uRes;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv;
    vec3 c = texture2D(tScene, p).rgb;
    float v = smoothstep(1.2, .35, length((p - .5) * vec2(1.25, 1.)));
    c *= mix(.72, 1., v);
    c += (hash12(p * uRes + fract(uTime * 7.3) * 311.) - .5) * .035;
    gl_FragColor = vec4(c, 1.);
  }
`;

/**
 * Film strips floating in the dark, with a soft vignette and fine grain.
 * `strips` holds up to three photo lists: the front strip and two dimmer ones behind it.
 */
export function createFilmStrip(renderer: THREE.WebGLRenderer, el: HTMLElement, strips: FilmPhoto[][]): Demo {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setRGB(0.07, 0.085, 0.09, THREE.LinearSRGBColorSpace);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  cam.position.set(0, 0, 9);
  const LEN = 18;
  const HGT = 1.6;
  const geo = new THREE.PlaneGeometry(LEN, HGT, 240, 1);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const lists = strips.filter((s) => s.length > 0);
  const layout = [
    { phase: 0, amp: 1, dim: 1, pos: [0, 0, 0], rot: 0, dir: 1, offset: 0 },
    { phase: 2.4, amp: 0.8, dim: 0.42, pos: [1.2, 1.9, -4], rot: -0.12, dir: -0.6, offset: 0.37 },
    { phase: 4.1, amp: 0.7, dim: 0.3, pos: [-1, -2.3, -6], rot: 0.1, dir: 0.45, offset: 0.71 },
  ];
  const meshes = layout.map((l, i) => {
    const photos = lists[i % lists.length];
    const tex = createStrip(photos, 12 + i * 8, aniso);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uTime: { value: 0 },
        uPhase: { value: l.phase },
        uAmp: { value: l.amp },
        uRep: { value: LEN / (HGT * FRAMES) },
        uScroll: { value: 0 },
        uDim: { value: l.dim },
      },
      vertexShader: STRIP_VS,
      fragmentShader: STRIP_FS,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(l.pos[0], l.pos[1], l.pos[2]);
    m.rotation.z = l.rot;
    m.renderOrder = -i;
    scene.add(m);
    return { m, mat, l };
  });

  const comp = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: VS_QUAD,
    fragmentShader: COMP_FS,
    depthTest: false,
    depthWrite: false,
  });
  const compScene = new THREE.Scene();
  compScene.add(fullscreenQuad(comp));

  let rt: THREE.WebGLRenderTarget | null = null;
  let scroll = 0.05;
  let speed = 0.04;
  let ptrX = 0;
  let ptrY = 0;
  let inside = false;
  let lastFrame = '';
  const frameEl = el.querySelector('[data-frame]');
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    ptrX = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptrY = 1 - ((e.clientY - r.top) / r.height) * 2;
    inside = true;
  });
  el.addEventListener('pointerleave', () => {
    inside = false;
  });

  return {
    t0: 6,
    resize(w, h, dpr) {
      cam.aspect = w / h;
      cam.position.z = w / h < 1 ? 7.4 : 9;
      cam.updateProjectionMatrix();
      rt?.dispose();
      rt = new THREE.WebGLRenderTarget(Math.round(w * dpr), Math.round(h * dpr));
      comp.uniforms.uRes.value.set(w * dpr, h * dpr);
    },
    render(t, dt) {
      const k = Math.min(1, dt * 3);
      speed += ((inside ? 0.03 + ptrX * 0.09 : 0.04) - speed) * k;
      scroll += speed * dt;
      for (const { mat, l } of meshes) {
        mat.uniforms.uTime.value = t;
        mat.uniforms.uScroll.value = scroll * l.dir + l.offset;
      }
      const follow = Math.min(1, dt * 2);
      cam.position.x += ((inside ? ptrX * 0.5 : 0) - cam.position.x) * follow;
      cam.position.y += ((inside ? ptrY * 0.3 : 0) - cam.position.y) * follow;
      cam.lookAt(0, 0, 0);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      comp.uniforms.tScene.value = rt!.texture;
      comp.uniforms.uTime.value = t;
      renderer.render(compScene, quadCamera);
      const u = 0.5 * (LEN / (HGT * FRAMES)) + scroll;
      const idx = Math.floor((((u % 1) + 1) % 1) * FRAMES);
      const label = '▸ ' + (12 + idx) + 'A';
      if (label !== lastFrame && frameEl) {
        lastFrame = label;
        frameEl.textContent = label;
      }
    },
  };
}
