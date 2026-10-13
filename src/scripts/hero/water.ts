import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';

/**
 * Rivers, the castle moat and ponds from the GSI water areas. The surface mirrors the sky,
 * glitters toward the sun and, after dark, shimmers with the lights along its banks.
 * Vertices are pulled a few metres toward the camera so the coarse terrain mesh, which
 * smooths over narrow channels, never hides them; buildings still do.
 */
export function buildWater(env: Env, hf: Heightfield, lines: LineFeature[]) {
  const pos: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i];
    if (f.kind !== LINE.water) continue;
    const ring = toVec(f.pts);
    const holes: THREE.Vector2[][] = [];
    while (i + 1 < lines.length && lines[i + 1].kind === LINE.waterHole) holes.push(toVec(lines[++i].pts));
    if (ring.length < 3) continue;
    const all = ring.concat(...holes);
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(ring, holes);
    } catch {
      continue;
    }
    for (const t of tris) {
      // face up
      const [a, b, c] = t.map((k) => all[k]);
      const up = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;
      for (const k of up ? t : [t[0], t[2], t[1]]) {
        const p = all[k];
        pos.push(p.x, hf.height(p.x, p.y) + 0.4, p.y);
      }
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
        vec3 p = position;
        vWorld = p;
        vec3 toCam = cameraPosition - p;
        float dist = length(toCam);
        p += toCam / dist * min(dist * .004, 30.);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld;
      void main(){
        vec2 q = vWorld.xz;
        float t = uTime;
        vec2 w = vec2(vnoise(q * .35 + vec2(t * .3, 0.)) - .5, vnoise(q * .35 + vec2(0., t * .25) + 9.) - .5);
        w += .5 * vec2(vnoise(q * 1.4 - t * .5) - .5, vnoise(q * 1.4 + 3. + t * .4) - .5);
        vec3 n = normalize(vec3(w.x * .12, 1., w.y * .12));
        vec3 v = normalize(vWorld - cameraPosition);
        vec3 r = reflect(v, n);
        r.y = abs(r.y);
        float fres = .03 + .97 * pow(1. - max(dot(-v, n), 0.), 5.);
        vec3 deep = vec3(.006, .014, .014);
        vec3 col = deep * (uSunLight * max(uSunDir.y, 0.) + skyLight(vec3(0., 1., 0.))) + skyColor(r) * fres;
        col += uSunLight * pow(max(dot(r, uSunDir), 0.), 180.) * 6.;
        col += uMoonLight * pow(max(dot(r, uMoonDir), 0.), 120.) * 30.;
        // reflected bank lights: vertical streaks that break up with the ripples
        float streak = vnoise(vec2(q.x * .25 + q.y * .25, t * .6) + w * 4.);
        vec3 emit = vec3(1., .66, .34) * smoothstep(.55, .95, streak) * .35 * uCity;
        gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

function toVec(p: Float32Array) {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) out.push(new THREE.Vector2(p[i], p[i + 1]));
  return out;
}
