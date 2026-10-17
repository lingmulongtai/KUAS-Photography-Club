import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { toLocal } from './geo';
import { kyotoTower } from './kyoto-tower';
import { goldenPavilion, kiyomizuHall, pagoda, ryoanji, shishinden, togetsukyo } from './temple-models';
import { SPOTS } from '../../data/spots';
import {templeHall} from './compound-models';
import {heianShrine,HEIAN_CENTER} from './heian-shrine';
import {imperialPalace} from './imperial-palace';
import {nijoCastle} from './nijo-castle';
import {kyotoStation,STATION_CENTER} from './kyoto-station';

/*
 * Landmarks the building data can't show properly, modelled at their real positions and sizes.
 * Each part carries a colour (linear) and how strongly it is floodlit at night.
 */

export type Part = { geo: THREE.BufferGeometry; color: [number, number, number]; glow: number };

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

const WOOD: [number, number, number] = [0.07, 0.042, 0.025];
const ROOF: [number, number, number] = [0.035, 0.038, 0.042];
const VERMILION: [number, number, number] = [0.6, 0.075, 0.025];

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
  const profile=new THREE.Shape();
  const curve=(x:number)=>.8*(Math.abs(x)/16.95)**2.4;
  for(let i=0;i<=16;i++) {
    const x=-16.95+i*33.9/16,y=22.4+curve(x);
    if(i===0)profile.moveTo(x,y);else profile.lineTo(x,y);
  }
  for(let i=16;i>=0;i--){const x=-16.95+i*33.9/16;profile.lineTo(x,23.6+curve(x));}
  profile.closePath();
  const kasagi = new THREE.ExtrudeGeometry(profile,{depth:3.2,bevelEnabled:false,steps:1});
  kasagi.translate(0,0,-1.6);
  const plaque = new THREE.BoxGeometry(2.6, 4.4, 0.6);
  plaque.translate(0, 19.6, 0);
  parts.push(
    { geo: nuki, color: VERMILION, glow: 1.2 },
    { geo: shimaki, color: VERMILION, glow: 1.2 },
    { geo: kasagi, color: [0.025, 0.025, 0.028], glow: 0.7 },
    { geo: plaque, color: [0.04, 0.035, 0.03], glow: 0.8 },
  );
  for(const x of [-9.1,9.1]) {
    const joint=new THREE.BoxGeometry(2.8,.4,2.2);joint.translate(x,17.7,0);
    parts.push({geo:joint,color:VERMILION,glow:1});
  }
  for(const [w,h,x,y] of [[.15,4.6,-1.4,19.6],[.15,4.6,1.4,19.6],[2.95,.15,0,21.9],[2.95,.15,0,17.3]]) {
    const frame=new THREE.BoxGeometry(w,h,.12);frame.translate(x,y,.35);
    parts.push({geo:frame,color:[.35,.23,.055],glow:.6});
  }
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
  kyotoStation:{parts:kyotoStation(),...STATION_CENTER},
  toji: { parts: pagoda(5, 9.5, 6.6, 54.8, 12, WOOD, ROOF), x: -984, z: 2632 },
  tojiKondo:{parts:templeHall(44.56,29.11,24.9,true),x:-1077.32,z:2578.44},
  tojiKodo:{parts:templeHall(45.72,26.12,17.7),x:-1076.97,z:2534.76},
  tojiJikido:{parts:templeHall(39.75,30.42,18.2),x:-1077.93,z:2443.75},
  yasaka: { parts: pagoda(5, 6.4, 4.6, 46, 9.5, WOOD, ROOF), x: 1802, z: 560 },
  kiyomizu: { parts: pagoda(3, 6.2, 4.8, 31, 8, VERMILION, [0.05, 0.032, 0.022]), lat: 34.9950586, lon: 135.7838348 },
  heianTorii: { parts: torii(), lat: 35.0125663, lon: 135.7826821 },
  heianShrine:{parts:heianShrine(),...HEIAN_CENTER},
  goldenPavilion: { parts: goldenPavilion(), lat: 35.0395092, lon: 135.7284548 },
  shishinden: { parts: shishinden(), lat: SPOTS.find(s=>s.id==='gosho')!.lat, lon: SPOTS.find(s=>s.id==='gosho')!.lon },
  ryoanji: { parts: ryoanji(), lat: SPOTS.find(s=>s.id==='ryoanji')!.lat, lon: SPOTS.find(s=>s.id==='ryoanji')!.lon },
  kiyomizuHall: { parts: kiyomizuHall(), lat: 34.9946668, lon: 135.7849382 },
  togetsukyo: { parts: togetsukyo().map(part=>({...part,geo:part.geo.rotateY(-5.8*Math.PI/180).translate(0,2,0)})), lat: 35.01287125, lon: 135.67776225 },
};

export function buildLandmarks(env: Env, hf: Heightfield) {
  const geos: THREE.BufferGeometry[] = [];
  const positions: Record<string, THREE.Vector3> = {};
  const sites:Record<string,Placed>={...LANDMARKS,...imperialPalace(),...nijoCastle()};
  for (const [name, l] of Object.entries(sites)) {
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
      ${SHADOW_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vGlow;
      void main(){
        vec3 n = normalize(vNormal);
        float sh = sunShadow(vWorld, n);
        vec3 col = shade(vColor, n, vWorld, sh);
        // Cool panes reflect the sky; the smooth tower shell catches a restrained highlight.
        vec3 view = normalize(cameraPosition - vWorld);
        float spec = pow(clamp(dot(n, normalize(uSunDir + view)), 0., 1.), 36.);
        col += uSunLight * spec * .12 * sh;
        float glass = step(vColor.r * 1.4, vColor.b) * (1. - step(.12, vColor.r));
        col = mix(col, col + skyColor(reflect(-view, n)) * (.15 + .35 * pow(clamp(1. - dot(view, n), 0., 1.), 4.)), glass);
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
