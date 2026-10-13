import * as THREE from 'three';
import { press, setText, type Demo } from '../gl/stage';
import { VS_MESH } from '../gl/shaders';

/** Seeded random numbers so the street looks the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

const FOCAL = 0.085; // an 85 mm portrait lens on full frame
const SENSOR_H = 0.024;

/**
 * A night street seen through an 85 mm lens (concept E). Each light's blur disc is the
 * circle of confusion for its distance and the focus distance; stopping down shrinks the
 * discs and turns them into the hexagon of a six-blade aperture. A print held 3 m away
 * blurs with the same optics through its mipmaps.
 */
export function createBokeh(renderer: THREE.WebGLRenderer, el: HTMLElement, printSrc: string): Demo {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setRGB(0.02, 0.024, 0.043, THREE.LinearSRGBColorSpace);
  const cam = new THREE.PerspectiveCamera(16, 1, 0.05, 400);
  cam.position.set(0, 1.45, 0);
  const look = new THREE.Vector3(0.12, 1.4, -10);

  const P: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  const S: number[] = [];
  const r = rng(5);
  const L = (x: number, y: number, z: number, c: number[], i: number) => {
    P.push(x, y, z);
    C.push(c[0], c[1], c[2]);
    I.push(i);
    S.push(r());
  };
  const WARM = [1, 0.72, 0.38];
  const AMBER = [1, 0.55, 0.22];
  const WHITE = [1, 0.93, 0.82];
  const RED = [1, 0.22, 0.18];
  const GREEN = [0.35, 1, 0.6];
  const BLUE = [0.45, 0.7, 1];
  const PINK = [1, 0.45, 0.7];
  for (let z = -6; z > -90; z -= 6.5) {
    L(-2.6 + r() * 0.2, 4.2, z, WARM, 1);
    L(3.4 + r() * 0.2, 4.2, z - 3, WARM, 1);
  }
  for (let k = 0; k < 14; k++) {
    const z = -8 - r() * 60;
    const x = -0.6 + r() * 1.6;
    const c = r() < 0.55 ? RED : WHITE;
    L(x - 0.7, 0.7, z, c, 0.9);
    L(x + 0.7, 0.7, z, c, 0.9);
  }
  L(-1.9, 5.2, -24, GREEN, 1);
  L(2.8, 5.2, -24.5, GREEN, 1);
  L(-1.9, 5.2, -52, RED, 0.9);
  const SHOP = [WARM, AMBER, PINK, BLUE, WHITE, AMBER];
  for (let k = 0; k < 80; k++) {
    const side = r() < 0.5 ? -1 : 1;
    L(side * (2.5 + r() * 6) + 0.4, 0.5 + r() * 4, -6 - r() * 70, SHOP[k % SHOP.length], 0.55 + r() * 0.45);
  }
  for (let k = 0; k < 90; k++) L((r() - 0.5) * 60, r() * 10, -90 - r() * 80, r() < 0.7 ? WARM : BLUE, 0.5 + r() * 0.5);
  // fairy lights hanging just in front of the lens
  for (let k = 0; k < 14; k++) {
    const u = k / 13;
    L(-0.32 + u * 0.7, 1.56 - Math.sin(u * Math.PI) * 0.05, -1.15 - u * 0.1, [1, 0.82, 0.55], 1);
  }
  L(-0.3, 1.28, -1.6, PINK, 0.8);
  L(0.45, 1.3, -1.8, AMBER, 0.8);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute('aInt', new THREE.Float32BufferAttribute(I, 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(S, 1));
  const gl = renderer.getContext();
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const maxPoint = range ? range[1] : 64;
  const lightMat = new THREE.ShaderMaterial({
    uniforms: { uFocus: { value: 3 }, uK: { value: 50 }, uMax: { value: 64 }, uDpr: { value: 1 }, uTime: { value: 0 }, uRound: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uFocus, uK, uMax, uDpr, uTime;
      attribute vec3 aCol;
      attribute float aInt, aSeed;
      varying vec3 vCol;
      varying float vA, vSize;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        float d = -mv.z;
        float size = clamp(uK * abs(d - uFocus) / d + 2.5 * uDpr, 2., uMax);
        vSize = size;
        gl_PointSize = size;
        vA = aInt * (.85 + .15 * sin(uTime * 1.6 + aSeed * 40.)) * clamp(7. * uDpr / size, .06, 1.);
        vCol = aCol;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uRound;
      varying vec3 vCol;
      varying float vA, vSize;
      void main(){
        vec2 q = gl_PointCoord - .5;
        float r = length(q) * 2.;
        float a = atan(q.y, q.x) + .3;
        float seg = 1.0471976;
        float poly = r * cos(a - floor(a / seg + .5) * seg) / .866;
        float sh = mix(poly, r, uRound);
        float aa = 2.5 / vSize;
        float disk = 1. - smoothstep(.94 - aa, .94, sh);
        float rim = smoothstep(.5, .93, sh) * .55;
        float core = exp(-r * r * 8.) * clamp(1.5 - vSize / 12., 0., 1.);
        gl_FragColor = vec4(vCol * (disk * (.7 + rim) + core) * vA, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lights = new THREE.Points(geo, lightMat);
  lights.renderOrder = 1;
  lights.frustumCulled = false;
  scene.add(lights);

  const printTex = new THREE.TextureLoader().load(printSrc);
  printTex.anisotropy = 4;
  const printMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: printTex }, uBias: { value: 0 }, uSoft: { value: 0.002 } },
    vertexShader: VS_MESH,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uBias, uSoft;
      varying vec2 vUv;
      void main(){
        vec2 b = vec2(.05, .07);
        vec2 iuv = (vUv - b) / (1. - 2. * b);
        vec3 img = texture2D(uTex, clamp(iuv, 0., 1.), uBias).rgb;
        vec2 e = min(iuv, 1. - iuv);
        float ie = smoothstep(-uSoft, uSoft, min(e.x, e.y));
        vec3 c = mix(vec3(.9, .88, .84), img, ie) * .86;
        vec2 o = min(vUv, 1. - vUv);
        gl_FragColor = vec4(c, smoothstep(0., uSoft * 1.4 + .006, min(o.x, o.y)));
      }
    `,
    transparent: true,
    depthWrite: true,
  });
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), printMat);
  print.position.set(0.2, 1.42, -3);
  print.rotation.set(0, -0.18, 0.04);
  scene.add(print);

  const slider = document.getElementById(el.dataset.slider ?? '') as HTMLInputElement | null;
  const out = document.getElementById(el.dataset.output ?? '');
  const readout = el.querySelector('[data-readout]');
  const fButtons = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-f]'));
  const v2s = (v: number) => 0.8 * Math.pow(60 / 0.8, v / 1000);
  const s2v = (s: number) => Math.round((1000 * Math.log(s / 0.8)) / Math.log(60 / 0.8));
  let focus = 3;
  let target = 3;
  let manualUntil = -1;
  let aper = 1.4;
  let round = 1;
  let roundT = 1;
  let Hpx = 500;
  let curT = 0;
  let ptrX = 0;
  let ptrY = 0;
  slider?.addEventListener('input', () => {
    target = v2s(Number(slider.value));
    manualUntil = curT + 8;
  });
  fButtons.forEach((b) =>
    b.addEventListener('click', () => {
      aper = Number(b.dataset.f);
      roundT = aper < 2 ? 1 : aper < 4 ? 0.55 : 0;
      press(fButtons, b);
      manualUntil = Math.max(manualUntil, curT + 4);
    }),
  );
  el.addEventListener('pointermove', (e) => {
    const rect = el.getBoundingClientRect();
    ptrX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ptrY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
  });
  el.addEventListener('pointerleave', () => (ptrX = ptrY = 0));
  const SEQ = [3.0, 28, 1.15];
  const fmt = (s: number) => (s >= 10 ? Math.round(s) + 'm' : s.toFixed(1) + 'm');

  return {
    t0: 0.5,
    resize(w, h, dpr) {
      cam.aspect = w / h;
      cam.fov = w / h < 1 ? 24 : 16;
      cam.updateProjectionMatrix();
      Hpx = h * dpr;
      lightMat.uniforms.uDpr.value = dpr;
      lightMat.uniforms.uMax.value = Math.min(maxPoint, 260 * dpr);
    },
    render(t, dt) {
      curT = t;
      if (t > manualUntil) target = SEQ[Math.floor(t / 4.5) % SEQ.length];
      const k = dt ? Math.min(1, dt * 2.2) : 1;
      focus = Math.exp(Math.log(focus) + (Math.log(target) - Math.log(focus)) * k);
      round += (roundT - round) * k;
      const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
      // circle of confusion in device pixels: f² / (N (s − f)) · |d − s| / d, scaled to the frame
      const K = ((FOCAL * FOCAL) / (aper * (focus - FOCAL)) / SENSOR_H) * Hpx * 1.4 * (Math.tan((8 * Math.PI) / 180) / tanHalf);
      const u = lightMat.uniforms;
      u.uFocus.value = focus;
      u.uK.value = K;
      u.uTime.value = t;
      u.uRound.value = round;
      const cocPrint = (K * Math.abs(3 - focus)) / 3;
      const printPx = (0.35 / (2 * 3 * tanHalf)) * Hpx;
      printMat.uniforms.uBias.value = Math.log2(Math.max(1, cocPrint * 0.5));
      printMat.uniforms.uSoft.value = Math.min(0.25, Math.max(0.0015, (cocPrint * 0.5) / printPx));
      cam.position.x += (ptrX * 0.03 - cam.position.x) * k;
      cam.position.y += (1.45 + ptrY * 0.015 - cam.position.y) * k;
      cam.lookAt(look);
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      if (slider && t > manualUntil) slider.value = String(s2v(focus));
      setText(out, fmt(focus));
      setText(readout, `85mm · f/${aper} · ピント ${fmt(focus)}`);
    },
  };
}
