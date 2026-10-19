import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import {cloudWeather} from './cloud-weather';

/**
 * One wide layer of clouds about 1.8 km up. Lit from below by the low sun at magic hour,
 * tinted by the city's glow at night, and fading into the haze toward the horizon.
 * Cover changes from day to day.
 */
export function buildClouds(env: Env,seed=Math.floor(Math.random()*4294967296)) {
  const weather=cloudWeather(seed);
  const uniforms = {
    ...env,
    uCover: { value: weather.cover },
    uStyle: { value: weather.style },
    uOffset: { value: new THREE.Vector2(...weather.offset) },
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
      uniform float uStyle;
      uniform vec2 uOffset;
      uniform vec2 uWind;
      varying vec3 vWorld;
      void main(){
        vec2 p = vWorld.xz * .00011 + uWind + uOffset;
        vec2 w = vec2(fbm(p * 1.3 + 3.), fbm(p * 1.3 - 5.));
        float heaps = fbm(p * vec2(1., 1.4) + w * .7);
        vec2 slant = mat2(.92, -.39, .39, .92) * p;
        float wisps = fbm(slant * vec2(.7, 5.5) + w * .3);
        float sheets = fbm(p * .65 + w * .25);
        float d = uStyle < .5 ? heaps : uStyle < 1.5 ? wisps : sheets;
        float th = 1. - uCover;
        float dens = smoothstep(th - .02, th + .26, d);
        if (dens < .003) discard;
        float core = smoothstep(th, th + .5, d);

        vec3 v = normalize(vWorld - cameraPosition);
        float s = max(dot(v, uSunDir), 0.);
        float phase = .5 + .3 * s + .45 * pow(s, 8.);
        vec3 lit = uCloudLight * phase * (1. - .5 * core);
        vec3 amb = mix(uHorizon, uZenith, .55) * (.8 - .35 * core);
        vec3 glow = vec3(.02, .011, .005) * uCity * (.5 + .5 * core);
        vec3 col = lit + amb + glow;

        float dist = length(vWorld.xz - cameraPosition.xz);
        col = mix(col, hazeColor(v), smoothstep(8000., 38000., dist) * .85);
        float fade = 1. - smoothstep(26000., 44000., dist);
        gl_FragColor = vec4(col, dens * fade * (uStyle > .5 && uStyle < 1.5 ? .58 : .92));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(96000, 96000).rotateX(Math.PI / 2), material);
  mesh.position.y = 1800;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, uniforms, weather };
}

/** Cloud cover for a given day: different every day, the same all day. */
export function coverForDay(year: number, month: number, day: number) {
  let h = year * 372 + month * 31 + day;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  return 0.34 + r * 0.3;
}
