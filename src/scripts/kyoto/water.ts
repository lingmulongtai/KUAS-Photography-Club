import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { CITY, RIVER_HALF_WIDTH, riverX } from './layout';

/** The Kamo river as a ribbon that reflects the same analytic sky as the dome. */
export function buildRiver(env: Env) {
  const z0 = CITY.minZ - 260;
  const z1 = CITY.maxZ + 420;
  const steps = 360;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const z = z0 + ((z1 - z0) * i) / steps;
    const x = riverX(z);
    pos.push(x - RIVER_HALF_WIDTH, 0.06, z, x + RIVER_HALF_WIDTH, 0.06, z);
    uv.push(0, i / steps, 1, i / steps);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: { ...env },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vUv;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld;
      varying vec2 vUv;
      void main(){
        vec2 p = vWorld.xz;
        // flowing ripples (the Kamo runs south, toward +z)
        float t = uTime * .6;
        vec2 g = vec2(fbm(p * .9 + vec2(0., -t)) - .5, fbm(p * .9 + vec2(5.2, -t * 1.3)) - .5);
        vec3 n = normalize(vec3(g.x * .35, 1., g.y * .35));
        vec3 v = normalize(vWorld - cameraPosition);
        vec3 r = reflect(v, n);
        r.y = abs(r.y);
        float fres = .04 + .96 * pow(1. - max(dot(-v, n), 0.), 5.);
        vec3 refl = skyColor(r);
        refl += uSunLight * pow(max(dot(r, uSunDir), 0.), 220.) * 6.;
        vec3 deep = vec3(.01, .016, .018);
        vec3 col = mix(deep + shade(vec3(.02, .03, .03), vec3(0., 1., 0.)) * .5, refl, clamp(fres + .25, 0., 1.));
        // city lights stretched across the water at night
        float streak = pow(fbm(vec2(p.x * 3., p.y * .25 + t * .2)), 3.) * 2.2;
        vec3 emit = vec3(1., .6, .3) * streak * uCity * .6;
        // soften the edges into the banks
        float edge = smoothstep(0., .12, vUv.x) * smoothstep(1., .88, vUv.x);
        gl_FragColor = vec4(applyFog(col, emit, vWorld) , edge);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}
