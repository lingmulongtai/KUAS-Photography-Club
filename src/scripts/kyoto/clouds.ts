import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';

/**
 * One wide layer of clouds ~1.5 km up. Lit from below by the low sun at magic hour,
 * tinted by the city's glow at night, and fading into the haze toward the horizon.
 */
export function buildClouds(env: Env) {
  const uniforms = {
    ...env,
    uCover: { value: 0.5 },
    uWind: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uCover;
      uniform vec2 uWind;
      varying vec3 vWorld;
      void main(){
        vec2 p = vWorld.xz * .0015 + uWind;
        vec2 w = vec2(fbm(p * 1.3 + 3.), fbm(p * 1.3 - 5.));
        float d = fbm(p * vec2(1., 1.6) + w * .7);
        float th = 1. - uCover;
        float dens = smoothstep(th - .02, th + .26, d);
        if (dens < .003) discard;
        float core = smoothstep(th, th + .5, d);

        vec3 v = normalize(vWorld - cameraPosition);
        float s = max(dot(v, uSunDir), 0.);
        float phase = .5 + .3 * s + .35 * pow(s, 8.);
        vec3 lit = uCloudLight * phase * (1. - .5 * core);
        vec3 amb = mix(uHorizon, uZenith, .55) * (.8 - .35 * core);
        vec3 glow = vec3(.016, .008, .004) * uCity * (.5 + .5 * core);
        vec3 col = lit + amb + glow;

        float dist = length(vWorld.xz - cameraPosition.xz);
        col = mix(col, fogColor(v), smoothstep(500., 3000., dist) * .85);
        float fade = 1. - smoothstep(2000., 3400., dist);
        gl_FragColor = vec4(col, dens * fade * .94);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7200, 7200).rotateX(Math.PI / 2), material);
  mesh.position.y = 150;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** Cloud cover for a given day: different every day, the same all day. */
export function coverForDay(year: number, month: number, day: number) {
  let h = year * 372 + month * 31 + day;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  return 0.36 + r * 0.3;
}
