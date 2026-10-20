import * as THREE from 'three';
import { setText, type Demo } from '../gl/stage';
import { HASH, VS_QUAD, fullscreenQuad, quadCamera } from '../gl/shaders';
import { pageLanguage } from '../../lib/i18n';

const FS = /* glsl */ `
  ${HASH}
  uniform sampler2D tPhoto;
  uniform float uDev, uFade, uTime, uRot;
  uniform vec2 uRes;
  uniform vec4 uRip[4];
  varying vec2 vUv;
  float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
  void main(){
    float asp = uRes.x / uRes.y;
    vec2 p = (vUv - .5) * vec2(asp, 1.);

    // ripples from the tongs (or the visitor's finger)
    vec2 disp = vec2(0.);
    float wave = 0.;
    for (int i = 0; i < 4; i++){
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (age > 0. && age < 5.){
        vec2 d = p - (r.xy - .5) * vec2(asp, 1.);
        float dist = length(d);
        float x = dist - age * .3;
        float wv = sin(x * 70.) * exp(-x * x * 180.) * exp(-age * .9) * r.w;
        disp += d / (dist + 1e-4) * wv * .007;
        wave += wv;
      }
    }
    disp += .002 * vec2(sin(p.y * 13. + uTime * .8), cos(p.x * 11. + uTime * .6));
    vec2 q = p + disp;

    float dt = sdBox(p, vec2(asp * .5 - .085, .415)) - .05;
    float inTray = 1. - smoothstep(0., .004, dt);
    float rim = exp(-abs(dt) * 90.) * .5;

    float ph = min(.36, asp * .4 / 1.4);
    vec2 hs = vec2(ph * 1.4, ph);
    float ca = cos(uRot), sa = sin(uRot);
    vec2 pq = mat2(ca, -sa, sa, ca) * q;
    float pw = 1.5 / uRes.y;
    float inPaper = (1. - smoothstep(-pw, pw, sdBox(pq, hs))) * uFade * inTray;
    float shadow = (1. - smoothstep(-.02, .03, sdBox(pq - vec2(.012, -.016), hs))) * uFade;
    vec2 ih = hs - ph * .11;
    vec2 iuv = pq / (2. * ih) + .5;
    float inImg = 1. - smoothstep(-pw, pw, sdBox(pq, ih));

    // a black-and-white print develops shadows first: dense areas start earlier
    float lum = dot(texture2D(tPhoto, clamp(iuv, 0., 1.)).rgb, vec3(.299, .587, .114));
    lum = smoothstep(.03, .92, lum);
    float dens = 1. - lum;
    float k = clamp((uDev - (1. - dens) * .45) / .55, 0., 1.);
    k = k * k * (3. - 2. * k);
    float tone = 1. - dens * k * inImg * .94;

    float val = mix(.06 + rim, .16 - shadow * .08, inTray);
    val = mix(val, tone * .92, inPaper);
    float light = .45 + .75 * exp(-length(p - vec2(-.32 * asp, .62)) * 1.5);
    vec3 col = val * light * vec3(1., .17, .1);
    vec2 sp = (q - vec2(.22 * asp, .18)) * vec2(1., 1.7);
    col += vec3(1., .45, .32) * (exp(-dot(sp, sp) * 55.) * .55 * inTray + max(wave, 0.) * .12 * inTray);
    col += (hash12(gl_FragCoord.xy + fract(uTime * 5.1) * 173.) - .5) * .05;
    gl_FragColor = vec4(max(col, 0.), 1.);
  }
`;

/**
 * A print developing in a tray under a red safelight (concept B).
 * Each sheet goes developer → stop → fix; touching the tray stirs the liquid.
 */
export function createDarkroom(renderer: THREE.WebGLRenderer, el: HTMLElement, sources: string[]): Demo {
  const steps = pageLanguage() === 'en' ? ['DEVELOP', 'STOP', 'FIX'] : ['現像 DEV', '停止 STOP', '定着 FIX'];
  const loader = new THREE.TextureLoader();
  const textures = sources.map((src) => loader.load(src));
  const rip = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -100, 0));
  let ri = 0;
  let curT = 0;
  let lastRip = -10;
  let lastUser = -10;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tPhoto: { value: textures[0] },
      uDev: { value: 0 },
      uFade: { value: 0 },
      uTime: { value: 0 },
      uRot: { value: -0.03 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uRip: { value: rip },
    },
    vertexShader: VS_QUAD,
    fragmentShader: FS,
  });
  const scene = new THREE.Scene();
  scene.add(fullscreenQuad(mat));

  const addRipple = (e: PointerEvent, strength: number) => {
    const r = el.getBoundingClientRect();
    rip[ri].set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height, curT, strength);
    ri = (ri + 1) % rip.length;
    lastRip = lastUser = curT;
  };
  el.addEventListener('pointerdown', (e) => addRipple(e, 1.3));
  el.addEventListener('pointermove', (e) => {
    if (curT - lastRip > 0.14) addRipple(e, 0.55);
  });

  const stepEl = el.querySelector('[data-step]');
  const timerEl = el.querySelector('[data-timer]');
  const countEl = el.querySelector('[data-count]');
  const CYCLE = 12;

  return {
    t0: 5.2,
    resize(w, h, dpr) {
      mat.uniforms.uRes.value.set(w * dpr, h * dpr);
    },
    render(t, dt) {
      curT = t;
      const cyc = Math.floor(t / CYCLE);
      const lt = t - cyc * CYCLE;
      const idx = ((cyc % textures.length) + textures.length) % textures.length;
      const dv = Math.min(1, Math.max(0, (lt - 1.2) / 7.3));
      const u = mat.uniforms;
      u.tPhoto.value = textures[idx];
      u.uFade.value = lt < 1.2 ? lt / 1.2 : lt > 11 ? Math.max(0, 12 - lt) : 1;
      u.uDev.value = 1 - Math.pow(1 - dv, 1.6);
      u.uRot.value = -0.03 + 0.02 * Math.sin(cyc * 2.1);
      u.uTime.value = t;
      if (dt > 0 && t - lastUser > 3 && t - lastRip > 2.6) {
        rip[ri].set(0.25 + Math.random() * 0.5, 0.25 + Math.random() * 0.5, t, 0.7);
        ri = (ri + 1) % rip.length;
        lastRip = t;
      }
      renderer.setRenderTarget(null);
      renderer.render(scene, quadCamera);
      let step: string;
      let secs: number;
      if (lt < 8.5) {
        step = steps[0];
        secs = (Math.max(0, lt - 1.2) / 7.3) * 90;
      } else if (lt < 9.6) {
        step = steps[1];
        secs = ((lt - 8.5) / 1.1) * 30;
      } else {
        step = steps[2];
        secs = ((lt - 9.6) / 2.4) * 300;
      }
      setText(stepEl, step);
      setText(timerEl, `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`);
      setText(countEl, `${idx + 1} / ${textures.length}`);
    },
  };
}
