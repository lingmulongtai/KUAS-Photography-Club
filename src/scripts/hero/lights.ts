import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ROAD_WIDTH as WIDTH } from './roads';
import { rng } from './util';

/* The city at night, drawn from the real road network. */


/** Points spaced along every road: street lamps, brighter and closer together on the avenues. */
export function buildLamps(env: Env, hf: Heightfield, lines: LineFeature[], quality: number) {
  const r = rng(77);
  const pos: number[] = [];
  const tint: number[] = [];
  const spacing = [60, 46, 30, 24, 20].map((s) => s / quality);
  for (const f of lines) {
    if (f.kind !== LINE.road) continue;
    const rank = f.attr & 15;
    if (rank < 1) continue;
    const p = f.pts;
    let carry = r() * spacing[rank];
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      let t = carry;
      while (t < len) {
        const side = rank >= 3 ? (r() < 0.5 ? -1 : 1) * WIDTH[rank] * 0.45 : 0;
        const x = ax + ((bx - ax) * t) / len + nx * side;
        const z = az + ((bz - az) * t) / len + nz * side;
        pos.push(x, hf.height(x, z) + 7, z);
        // white LED on the avenues, a mix of warm and white on side streets
        const warm = rank >= 3 ? r() < 0.25 : r() < 0.55;
        tint.push(warm ? 1 : 0.92, warm ? 0.66 : 0.86, warm ? 0.34 : 0.7);
        t += spacing[rank] * (0.8 + r() * 0.4);
      }
      carry = t - len;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      attribute vec3 aTint;
      uniform float uScale;
      varying vec3 vColor;
      void main(){
        vec4 mv = viewMatrix * vec4(position, 1.);
        float dist = -mv.z;
        // a lamp is ~0.4 m across but blooms: keep at least a pixel, fade through the haze
        float px = clamp(uScale * 2.4 / dist, 1.2, 4.);
        float tr = hazeTransmittance(position);
        float tw = .94 + .06 * sin(uTime * 1.3 + position.x * .7 + position.z * .3);
        // lamps right below the viewpoint would flood the bloom: fade them by size
        float near = 1. - smoothstep(2.5, 4., uScale * 2.4 / dist) * .6;
        vColor = aTint * uCity * mix(tr, 1., .4) * tw * 2.2 * near;
        gl_PointSize = px;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - .5) * 2.;
        float a = exp(-d * d * 3.);
        if (a < .02) discard;
        gl_FragColor = vec4(vColor * a, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, uniforms: material.uniforms as typeof material.uniforms & { uScale: { value: number } }, count: pos.length / 3 };
}

/**
 * Car lights on the avenues: each car runs back and forth along one stretch of road, white
 * headlights when it comes toward the camera and red tail lights when it goes away.
 */
export function buildTraffic(env: Env, hf: Heightfield, lines: LineFeature[], quality: number) {
  const r = rng(91);
  const a: number[] = [];
  const b: number[] = [];
  const m: number[] = [];
  for (const f of lines) {
    if (f.kind !== LINE.road) continue;
    const rank = f.attr & 15;
    if (rank < 3) continue;
    const p = f.pts;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 20) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const cars = Math.max(1, Math.round((len / (rank === 4 ? 45 : 70)) * quality));
      for (let c = 0; c < cars; c++) {
        const dir = r() < 0.5 ? 1 : -1;
        const off = WIDTH[rank] * 0.22 * dir;
        const sx = dir > 0 ? ax : bx, sz = dir > 0 ? az : bz, ex = dir > 0 ? bx : ax, ez = dir > 0 ? bz : az;
        a.push(sx + nx * off, hf.height(sx, sz) + 1.2, sz + nz * off);
        b.push(ex + nx * off, hf.height(ex, ez) + 1.2, ez + nz * off);
        m.push(r(), (9 + r() * 7) / len);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
  geo.setAttribute('aEnd', new THREE.Float32BufferAttribute(b, 3));
  geo.setAttribute('aMotion', new THREE.Float32BufferAttribute(m, 2));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      attribute vec3 aEnd;
      attribute vec2 aMotion;
      uniform float uScale;
      varying vec3 vColor;
      void main(){
        float t = fract(aMotion.x + uTime * aMotion.y);
        vec3 p = mix(position, aEnd, t);
        vec3 dir = normalize(aEnd - position);
        float toward = dot(dir, normalize(cameraPosition - p));
        vec3 head = vec3(1., .93, .8) * 2.6;
        vec3 tail = vec3(1., .08, .04) * 2.;
        vec4 mv = viewMatrix * vec4(p, 1.);
        float dist = -mv.z;
        float px = clamp(uScale * 2. / dist, 1., 4.);
        float fade = smoothstep(0., .05, t) * smoothstep(1., .95, t);
        float on = max(uCity, .25 * step(.001, uCity));
        float near = 1. - smoothstep(2., 4., uScale * 2. / dist) * .7;
        vColor = mix(tail, head, step(0., toward)) * on * fade * near * mix(hazeTransmittance(p), 1., .4);
        gl_PointSize = px;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - .5) * 2.;
        float a = exp(-d * d * 3.);
        if (a < .02) discard;
        gl_FragColor = vec4(vColor * a, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, uniforms: material.uniforms as typeof material.uniforms & { uScale: { value: number } }, count: a.length / 3 };
}
