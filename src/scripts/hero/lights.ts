import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ROAD_WIDTH as WIDTH } from './roads';
import { rng } from './util';
import { lightSpriteGeometry, LIGHT_SPRITE_VERTEX, LIGHT_SPRITE_FRAGMENT } from './light-sprites';

/* Street lamps along the real road network. */

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
  const geo = lightSpriteGeometry(new THREE.InstancedBufferAttribute(new Float32Array(pos),3));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tint), 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${LIGHT_SPRITE_VERTEX}
      attribute vec3 aTint;
      varying vec3 vColor;
      void main(){
        vec4 mv = viewMatrix * vec4(aLightPosition, 1.);
        float dist = max(-mv.z,.01);
        // a lamp is ~0.4 m across but blooms: keep at least a pixel, fade through the haze
        float core = clamp(uScale * 2.4 / dist, 1.2, 4.);
        float px = max(4.5,core*2.)+smoothstep(1500.,6500.,dist)*1.5;
        float tr = hazeTransmittance(aLightPosition);
        // lamps right below the viewpoint would flood the bloom: fade them by size
        float near = 1. - smoothstep(2.5, 4., uScale * 2.4 / dist) * .6;
        // far away many lamps share one pixel and their sum blooms into white balls on the
        // horizon: dim lamps that are drawn larger than they are
        float far = pow(clamp(uScale * 2.4 / dist / 1.2, .12, 1.), .6);
        vColor = aTint * uCity * mix(tr, 1., .4) * cityLightShimmer(aLightPosition) * 2.2 * near * far * (core*core/(px*px));
        gl_Position = lightSprite(mv,px);
      }
    `,
    fragmentShader: LIGHT_SPRITE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Mesh(geo, material);
  points.frustumCulled = false;
  return { points, uniforms: material.uniforms as typeof material.uniforms & { uScale: { value: number } }, count: pos.length / 3 };
}
