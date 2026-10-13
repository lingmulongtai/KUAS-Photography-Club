import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { toLocal } from './geo';

/*
 * Landmarks the building data can't show properly, modelled at their real positions and sizes.
 * Each part carries a colour (linear) and how strongly it is floodlit at night.
 */

type Part = { geo: THREE.BufferGeometry; color: [number, number, number]; glow: number };

function paint({ geo, color, glow }: Part) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col.set(color, i * 3);
    gl[i] = glow;
  }
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return g;
}

/** A square frustum (pagoda roof) or prism, its sides facing the axes. */
function square(bottom: number, top: number, height: number) {
  const g = new THREE.CylinderGeometry(top / Math.SQRT2, bottom / Math.SQRT2, height, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, height / 2, 0);
  return g;
}

const WOOD: [number, number, number] = [0.07, 0.042, 0.025];
const PLASTER: [number, number, number] = [0.42, 0.4, 0.36];
const ROOF: [number, number, number] = [0.035, 0.038, 0.042];
const BRONZE: [number, number, number] = [0.06, 0.05, 0.03];
const VERMILION: [number, number, number] = [0.6, 0.075, 0.025];

/** A pagoda: storeys of shrinking size, each with a wide overhanging roof, and the sorin spire. */
function pagoda(storeys: number, base: number, top: number, height: number, spire: number, body: [number, number, number], roof: [number, number, number]) {
  const parts: Part[] = [];
  const stack = height - spire;
  const step = stack / storeys;
  let y = 0;
  parts.push({ geo: square(base * 1.5, base * 1.4, 1.2), color: [0.2, 0.19, 0.17], glow: 0.6 });
  y = 1.2;
  for (let i = 0; i < storeys; i++) {
    const t = storeys > 1 ? i / (storeys - 1) : 0;
    const s = base + (top - base) * t;
    const bodyH = step * 0.58;
    const roofH = step * 0.42;
    const b = square(s, s, bodyH);
    b.translate(0, y, 0);
    parts.push({ geo: b, color: body, glow: 1 });
    // a lighter band of plaster walls between the posts
    const wall = square(s * 1.002, s * 1.002, bodyH * 0.5);
    wall.translate(0, y + bodyH * 0.2, 0);
    if (body === WOOD) parts.push({ geo: wall, color: PLASTER, glow: 1 });
    const eave = s * 2.05;
    const fascia = square(eave, eave, roofH * 0.18);
    fascia.translate(0, y + bodyH, 0);
    parts.push({ geo: fascia, color: roof, glow: 0.5 });
    const r = square(eave, s * 0.62, roofH * 0.82);
    r.translate(0, y + bodyH + roofH * 0.18, 0);
    parts.push({ geo: r, color: roof, glow: 0.35 });
    y += step;
  }
  // sorin: the bronze spire with its nine rings
  const mast = new THREE.CylinderGeometry(0.22, 0.32, spire, 8);
  mast.translate(0, y + spire / 2, 0);
  parts.push({ geo: mast, color: BRONZE, glow: 0.6 });
  for (let k = 0; k < 9; k++) {
    const ring = new THREE.CylinderGeometry(0.9 - k * 0.04, 0.9 - k * 0.04, 0.22, 10);
    ring.translate(0, y + spire * (0.22 + k * 0.065), 0);
    parts.push({ geo: ring, color: BRONZE, glow: 0.6 });
  }
  const ball = new THREE.SphereGeometry(0.45, 10, 8);
  ball.translate(0, y + spire, 0);
  parts.push({ geo: ball, color: BRONZE, glow: 0.6 });
  return parts;
}

/** Kyoto Tower: the white tower on the roof of its 31 m base building, 131 m to the tip. */
function kyotoTower(): Part[] {
  const base = 31;
  const profile: [number, number][] = [
    [0, 0], [6.9, 0], [6.4, 6], [5.6, 22], [4.9, 42], [4.6, 58], [5.2, 61],
    [7.6, 62.5], [8.4, 66], [8.4, 71.5], [7.9, 74.5], [5.4, 76], [4.1, 80], [2.6, 86], [1.3, 92], [0.45, 97], [0.25, 100], [0, 100],
  ];
  const lathe = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y + base)), 48);
  const deck = new THREE.CylinderGeometry(8.45, 8.45, 4.2, 48, 1, true);
  deck.translate(0, base + 67.6, 0);
  const tip = new THREE.CylinderGeometry(0.18, 0.25, 4, 6);
  tip.translate(0, base + 98, 0);
  return [
    { geo: lathe, color: [0.72, 0.72, 0.7], glow: 0.42 },
    { geo: deck, color: [0.05, 0.06, 0.07], glow: 3.4 },
    { geo: tip, color: [0.6, 0.08, 0.04], glow: 1 },
  ];
}

/** The great torii of Heian Shrine on Jingu-michi: 24 m tall, its beam running east–west. */
function torii(): Part[] {
  const parts: Part[] = [];
  for (const x of [-9.1, 9.1]) {
    const pillar = new THREE.CylinderGeometry(1.6, 1.85, 22, 20);
    pillar.translate(x, 11, 0);
    parts.push({ geo: pillar, color: VERMILION, glow: 1.2 });
    const base = new THREE.CylinderGeometry(2.1, 2.2, 1.6, 20);
    base.translate(x, 0.8, 0);
    parts.push({ geo: base, color: [0.03, 0.03, 0.03], glow: 0.6 });
  }
  const nuki = new THREE.BoxGeometry(26, 1.6, 1.3);
  nuki.translate(0, 17.2, 0);
  const shimaki = new THREE.BoxGeometry(31, 1.6, 2.4);
  shimaki.translate(0, 21.9, 0);
  const kasagi = new THREE.BoxGeometry(33.9, 1.5, 3.2);
  kasagi.translate(0, 23.4, 0);
  const plaque = new THREE.BoxGeometry(2.6, 4.4, 0.6);
  plaque.translate(0, 19.6, 0);
  parts.push(
    { geo: nuki, color: VERMILION, glow: 1.2 },
    { geo: shimaki, color: VERMILION, glow: 1.2 },
    { geo: kasagi, color: [0.025, 0.025, 0.028], glow: 0.7 },
    { geo: plaque, color: [0.04, 0.035, 0.03], glow: 0.8 },
  );
  return parts;
}

interface Placed {
  parts: Part[];
  lat?: number;
  lon?: number;
  x?: number;
  z?: number;
  rotY?: number;
}

const LANDMARKS: Record<string, Placed> = {
  kyotoTower: { parts: kyotoTower(), lat: 34.9875524, lon: 135.7593295 },
  toji: { parts: pagoda(5, 9.5, 6.6, 54.8, 12, WOOD, ROOF), x: -984, z: 2632 },
  yasaka: { parts: pagoda(5, 6.4, 4.6, 46, 9.5, WOOD, ROOF), x: 1802, z: 560 },
  kiyomizu: { parts: pagoda(3, 6.2, 4.8, 31, 8, VERMILION, [0.05, 0.032, 0.022]), lat: 34.9950586, lon: 135.7838348 },
  heianTorii: { parts: torii(), lat: 35.0125663, lon: 135.7826821 },
};

export function buildLandmarks(env: Env, hf: Heightfield) {
  const geos: THREE.BufferGeometry[] = [];
  const positions: Record<string, THREE.Vector3> = {};
  for (const [name, l] of Object.entries(LANDMARKS)) {
    const p = l.lat !== undefined ? toLocal(l.lat, l.lon!) : { x: l.x!, z: l.z! };
    const y = hf.height(p.x, p.z);
    positions[name] = new THREE.Vector3(p.x, y, p.z);
    for (const part of l.parts) {
      const g = paint(part);
      if (l.rotY) g.rotateY(l.rotY);
      g.translate(p.x, y, p.z);
      geos.push(g);
    }
  }
  const geo = mergeGeometries(geos);
  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aGlow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vGlow;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vGlow = aGlow;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vGlow;
      void main(){
        vec3 n = normalize(vNormal);
        float sh = dot(n, uSunDir) > 0. ? sunShadow(vWorld, n) : 1.;
        vec3 col = shade(vColor, n, vWorld, sh);
        // floodlights from below after dark, warmer toward the ground
        float up = clamp(n.y * -.5 + .75, .35, 1.);
        vec3 flood = vColor * vec3(1., .86, .66) * vGlow * up * 2.2 + vec3(1., .8, .55) * max(vGlow - 2.5, 0.) * .5;
        gl_FragColor = vec4(applyHaze(col, flood * uCity, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  return { mesh, positions };
}

/** Red aviation lights blinking on the tallest structures. */
export function buildBeacons(env: Env, points: THREE.Vector3[]) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const phase = new Float32Array(points.length).map((_, i) => i * 0.37);
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: env.uTime, uCity: env.uCity },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uCity;
      varying float vA;
      void main(){
        float blink = smoothstep(.55, .7, fract(uTime * .75 + aPhase)) * smoothstep(1., .85, fract(uTime * .75 + aPhase));
        vA = (.25 + blink) * max(uCity, .35);
        vec4 mv = viewMatrix * vec4(position, 1.);
        gl_PointSize = 3.;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - .5) * 2.;
        gl_FragColor = vec4(vec3(1., .06, .03) * exp(-d * d * 3.) * vA * 3., 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  return pts;
}
