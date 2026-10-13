import * as THREE from 'three';
import { clamp, press, setText, type Demo } from '../gl/stage';
import { HASH, VS_QUAD, fullscreenQuad, quadCamera } from '../gl/shaders';

/** Low town skyline with lit windows: red = silhouette, yellow = window. */
function townCanvas() {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let s = 77;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  let x = 0;
  while (x < W) {
    const bw = 34 + r() * 80;
    const bh = x < 60 || x > W - 120 ? 70 : 50 + r() * 110;
    g.fillStyle = '#f00';
    g.fillRect(x, H - bh, bw + 1, bh);
    g.fillStyle = '#ff0';
    for (let wy = H - bh + 10; wy < H - 8; wy += 14) for (let wx = x + 6; wx < x + bw - 8; wx += 11) if (r() < 0.22) g.fillRect(wx, wy, 5, 7);
    x += bw;
  }
  return c;
}

const MAX = 4000;
const PALETTE = [[1, 0.62, 0.3], [0.55, 0.8, 1], [1, 0.42, 0.68], [1, 0.88, 0.5], [0.6, 1, 0.72], [0.85, 0.6, 1]];

/**
 * Fireworks under a chosen shutter speed (concept D). Each frame fades the previous
 * one by exp(-dt / exposure) and adds the new light, so long exposures leave trails.
 * Dragging across the stage paints with light.
 */
export function createExposure(renderer: THREE.WebGLRenderer, el: HTMLElement): Demo {
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const siz = new Float32Array(MAX);
  const tint = new Float32Array(MAX * 3);
  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const life = new Float32Array(MAX);
  const maxL = new Float32Array(MAX);
  const kind = new Uint8Array(MAX);
  const lpos = new Float32Array(MAX * 6);
  const lcol = new Float32Array(MAX * 6);
  let head = 0;
  let asp = 1;
  let simT = 0;
  let nextLaunch = 0;
  let warmed = false;
  let tau = 0.75;
  let painting = false;
  let lx = 0;
  let ly = 0;

  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSiz = new THREE.BufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aCol', aCol);
  geo.setAttribute('aSize', aSiz);
  const pmat = new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: 1 } },
    vertexShader: 'uniform float uDpr; attribute vec3 aCol; attribute float aSize; varying vec3 vCol; void main(){ vCol = aCol; gl_PointSize = aSize * uDpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying vec3 vCol; void main(){ float a = smoothstep(.5, .1, length(gl_PointCoord - .5)); gl_FragColor = vec4(vCol * a, 1.); }',
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, pmat);
  points.frustumCulled = false;

  const lgeo = new THREE.BufferGeometry();
  const aLPos = new THREE.BufferAttribute(lpos, 3).setUsage(THREE.DynamicDrawUsage);
  const aLCol = new THREE.BufferAttribute(lcol, 3).setUsage(THREE.DynamicDrawUsage);
  lgeo.setAttribute('position', aLPos);
  lgeo.setAttribute('aCol', aLCol);
  const segs = new THREE.LineSegments(
    lgeo,
    new THREE.ShaderMaterial({
      vertexShader: 'attribute vec3 aCol; varying vec3 vCol; void main(){ vCol = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  segs.frustumCulled = false;
  const pScene = new THREE.Scene();
  pScene.add(segs, points);
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);

  let rtA: THREE.WebGLRenderTarget | null = null;
  let rtB: THREE.WebGLRenderTarget | null = null;
  const fadeMat = new THREE.ShaderMaterial({
    uniforms: { tPrev: { value: null }, uDecay: { value: 0.9 } },
    vertexShader: VS_QUAD,
    fragmentShader: 'uniform sampler2D tPrev; uniform float uDecay; varying vec2 vUv; void main(){ vec3 c = texture2D(tPrev, vUv).rgb; gl_FragColor = vec4(max(c * uDecay - .004, 0.), 1.); }',
    depthTest: false,
    depthWrite: false,
  });
  const fadeScene = new THREE.Scene();
  fadeScene.add(fullscreenQuad(fadeMat));
  const silTex = new THREE.CanvasTexture(townCanvas());
  silTex.wrapS = THREE.RepeatWrapping;
  const dispMat = new THREE.ShaderMaterial({
    uniforms: { tTrail: { value: null }, tSil: { value: silTex }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uSilH: { value: 0.24 }, uRep: { value: 1 } },
    vertexShader: VS_QUAD,
    fragmentShader: /* glsl */ `
      ${HASH}
      uniform sampler2D tTrail, tSil;
      uniform float uTime, uSilH, uRep;
      uniform vec2 uRes;
      varying vec2 vUv;
      void main(){
        vec2 p = vUv;
        vec3 c = mix(vec3(.06, .065, .13), vec3(.008, .01, .03), smoothstep(.1, 1., p.y));
        vec3 tr = texture2D(tTrail, p).rgb;
        c += 1. - exp(-tr * 2.2);
        if (p.y < uSilH){
          vec4 s = texture2D(tSil, vec2(p.x * uRep + .18, p.y / uSilH));
          c = mix(c, vec3(.01, .012, .025) + s.g * vec3(1., .72, .4) * .55, s.a);
        }
        c += (hash12(p * uRes + fract(uTime * 6.1) * 97.) - .5) * .05;
        gl_FragColor = vec4(c, 1.);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const dispScene = new THREE.Scene();
  dispScene.add(fullscreenQuad(dispMat));

  function spawn(k: number, x: number, y: number, ux: number, uy: number, L: number, c: number[], s: number) {
    const i = head;
    head = (head + 1) % MAX;
    kind[i] = k;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    vx[i] = ux;
    vy[i] = uy;
    life[i] = 0;
    maxL[i] = L;
    siz[i] = s;
    tint[i * 3] = c[0];
    tint[i * 3 + 1] = c[1];
    tint[i * 3 + 2] = c[2];
    lcol.fill(0, i * 6, i * 6 + 6);
  }
  const launch = () => spawn(1, (Math.random() - 0.5) * asp * 0.75, -0.5, (Math.random() - 0.5) * 0.04, 0.72 + Math.random() * 0.2, 0.9 + Math.random() * 0.35, [1, 0.7, 0.4], 2.4);
  function burst(x: number, y: number) {
    const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const willow = Math.random() < 0.3;
    const s0 = 0.2 + Math.random() * 0.1;
    const n = willow ? 110 : 150;
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * s0;
      spawn(willow ? 3 : 2, x, y, Math.cos(th) * r, Math.sin(th) * r, willow ? 2.6 + Math.random() * 0.8 : 1.4 + Math.random() * 0.7, willow ? [1, 0.74, 0.36] : c, willow ? 2.6 : 3);
    }
  }
  function step(dt: number) {
    simT += dt;
    if (simT >= nextLaunch) {
      launch();
      if (Math.random() < 0.35) launch();
      nextLaunch = simT + 0.9 + Math.random() * 1.4;
    }
    for (let i = 0; i < MAX; i++) {
      const k = kind[i];
      if (!k) continue;
      life[i] += dt;
      if (life[i] >= maxL[i]) {
        kind[i] = 0;
        siz[i] = 0;
        lcol.fill(0, i * 6, i * 6 + 6);
        if (k === 1) burst(pos[i * 3], pos[i * 3 + 1]);
        continue;
      }
      const ox = pos[i * 3];
      const oy = pos[i * 3 + 1];
      const drag = k === 3 ? 1.8 : k === 2 ? 1.1 : k === 1 ? 0.2 : 0;
      vx[i] *= 1 - drag * dt;
      vy[i] *= 1 - drag * dt;
      vy[i] -= (k === 1 ? 0.25 : k === 4 ? 0 : 0.09) * dt;
      pos[i * 3] += vx[i] * dt;
      pos[i * 3 + 1] += vy[i] * dt;
      const f = life[i] / maxL[i];
      let b = k === 1 ? 0.6 : k === 4 ? 1 - f : 1.35 * (1 - f) * (1 - f * 0.3);
      if ((k === 2 || k === 3) && f > 0.65 && Math.random() < 0.45) b *= 0.15;
      for (let c = 0; c < 3; c++) col[i * 3 + c] = tint[i * 3 + c] * b;
      const j = i * 6;
      const lb = k === 4 ? 0 : 0.7;
      lpos[j] = ox;
      lpos[j + 1] = oy;
      lpos[j + 3] = pos[i * 3];
      lpos[j + 4] = pos[i * 3 + 1];
      for (let c = 0; c < 3; c++) lcol[j + c] = lcol[j + 3 + c] = col[i * 3 + c] * lb;
    }
    aPos.needsUpdate = aCol.needsUpdate = aSiz.needsUpdate = aLPos.needsUpdate = aLCol.needsUpdate = true;
  }
  function frame(dt: number) {
    step(dt);
    fadeMat.uniforms.tPrev.value = rtA!.texture;
    fadeMat.uniforms.uDecay.value = Math.exp(-dt / tau);
    renderer.setRenderTarget(rtB);
    renderer.render(fadeScene, quadCamera);
    renderer.autoClear = false;
    renderer.render(pScene, cam);
    renderer.autoClear = true;
    const s = rtA;
    rtA = rtB;
    rtB = s;
  }

  const hsl = new THREE.Color();
  const toWorld = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width - 0.5) * asp, 0.5 - (e.clientY - r.top) / r.height];
  };
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    painting = true;
    [lx, ly] = toWorld(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const [x, y] = toWorld(e);
    const dx = x - lx;
    const dy = y - ly;
    const n = Math.min(80, Math.ceil(Math.hypot(dx, dy) / 0.004));
    hsl.setHSL(((performance.now() / 1000) * 0.15) % 1, 0.9, 0.62, THREE.LinearSRGBColorSpace);
    for (let k = 1; k <= n; k++) spawn(4, lx + (dx * k) / n, ly + (dy * k) / n, 0, 0, 0.09, [hsl.r * 1.2, hsl.g * 1.2, hsl.b * 1.2], 3.2);
    lx = x;
    ly = y;
  });
  window.addEventListener('pointerup', () => (painting = false));
  el.addEventListener('pointerleave', () => (painting = false));

  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-tau]'));
  const readout = el.querySelector('[data-readout]');
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      tau = Number(b.dataset.tau);
      press(buttons, b);
      setText(readout, `SS ${b.dataset.label} · ${b.dataset.settings}`);
    }),
  );

  return {
    resize(w, h, dpr) {
      asp = w / h;
      cam.left = -asp / 2;
      cam.right = asp / 2;
      cam.updateProjectionMatrix();
      pmat.uniforms.uDpr.value = dpr;
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      rtA?.dispose();
      rtB?.dispose();
      rtA = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
      rtB = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
      dispMat.uniforms.uRes.value.set(W, H);
      const silH = clamp(0.24 * Math.min(1, asp / 1.4), 0.15, 0.24);
      dispMat.uniforms.uSilH.value = silH;
      dispMat.uniforms.uRep.value = asp / (silH * 4);
      warmed = false;
    },
    render(t, dt) {
      if (!warmed) {
        warmed = true;
        for (let k = 0; k < 150; k++) frame(1 / 60);
      } else if (dt > 0) frame(dt);
      renderer.setRenderTarget(null);
      dispMat.uniforms.tTrail.value = rtA!.texture;
      dispMat.uniforms.uTime.value = t;
      renderer.render(dispScene, quadCamera);
    },
  };
}
