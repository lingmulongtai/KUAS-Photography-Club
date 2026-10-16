import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ringArea } from './island-mask';

/**
 * The ground of the pond islands: moss with a few stones, lit and shadowed like the terrain.
 * The coarse terrain mesh under a small island only carries a blurred mix of water and pine
 * from the photo, which read as flat paper cut-outs on the water.
 */
export function buildIslands(env: Env, hf: Heightfield, lines: LineFeature[], maxArea = 12000) {
  const pos: number[] = [];
  for (const f of lines) {
    if (f.kind !== LINE.waterHole || ringArea(f.pts) > maxArea) continue;
    const ring: THREE.Vector2[] = [];
    for (let i = 0; i < f.pts.length; i += 2) ring.push(new THREE.Vector2(f.pts[i], f.pts[i + 1]));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(ring, []);
    } catch {
      continue;
    }
    for (const t of tris) {
      const [a, b, c] = t.map((k) => ring[k]);
      const up = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;
      for (const k of up ? t : [t[0], t[2], t[1]]) pos.push(ring[k].x, hf.height(ring[k].x, ring[k].y) + .7, ring[k].y);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){
        vWorld = position;
        // drawn over the terrain the way the water is, a little toward the camera
        vec3 toCam = cameraPosition - position;
        float dist = length(toCam);
        gl_Position = projectionMatrix * viewMatrix * vec4(position + toCam / dist * min(dist * .004, 30.), 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vWorld;
      void main(){
        vec2 q = vWorld.xz;
        vec3 n = vec3(0., 1., 0.);
        float sh = sunShadow(vWorld, n);
        float fp = max(length(dFdx(q)), length(dFdy(q)));
        float fine = 1. - smoothstep(.2, .6, fp * 2.3);
        float patchy = vnoise(q * .45);
        float grain = mix(.5, vnoise(q * 2.3 + 4.), fine);
        vec3 moss = mix(vec3(.03, .05, .018), vec3(.07, .085, .03), patchy) * (.8 + .4 * grain);
        float stone = smoothstep(.74, .8, mix(.5, vnoise(q * 1.7 + 11.), 1. - smoothstep(.25, .7, fp)));
        vec3 albedo = mix(moss, vec3(.1, .098, .09) * (.85 + .3 * grain), stone * .8);
        vec3 col = shade(albedo, n, vWorld, sh);
        gl_FragColor = vec4(applyHaze(col, vec3(0.), vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}
