import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import {cloudWeather} from './cloud-weather';

/** Height of the cirrus streaks and the altocumulus field, metres. */
const CIRRUS_Y = 8200;
const ALTO_Y = 4600;
/** Clouds fade out into the haze before this distance. */
const FAR = 44000;

/**
 * Clouds with volume. The low layer (cumulus heads, a stratocumulus deck or towering congestus,
 * depending on the day) is ray-marched through a slab of 3D noise: flat grey bases, sunlit domes,
 * silver edges toward the sun, and the orange glow of the city on their undersides at night.
 * Above it, a mackerel-sky altocumulus field and high cirrus streaks are drawn as thin sheets that
 * keep the sunset colour after the low clouds have gone grey. The character and amount of each
 * layer change from visit to visit (cloud-weather.ts).
 *
 * The mesh is the inside of a box around the camera that reaches from the cloud base to above the
 * cirrus, so every ray that could meet a cloud covers a pixel; the shader works out where.
 */
export function buildClouds(env: Env,seed=Math.floor(Math.random()*4294967296),quality=1) {
  const weather=cloudWeather(seed);
  const uniforms = {
    ...env,
    uCover: { value: weather.cover },
    uStyle: { value: weather.style },
    uBase: { value: weather.base },
    uTop: { value: weather.top },
    uCirrus: { value: weather.cirrus },
    uAlto: { value: weather.alto },
    uOffset: { value: new THREE.Vector2(...weather.offset) },
    uWind: { value: new THREE.Vector2() },
  };
  // phones march fewer, longer steps and skip the second detail octave
  const steps = quality > .75 ? 40 : 22;
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: { STEPS: steps, DETAIL: quality > .75 ? 2 : 1 },
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
      uniform float uBase;
      uniform float uTop;
      uniform float uCirrus;
      uniform float uAlto;
      uniform vec2 uOffset;
      uniform vec2 uWind;
      varying vec3 vWorld;

      /** weather-map units per metre: one unit is about 9 km */
      const float K = .00011;

      float vnoise3(vec3 p){
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(
          mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
          f.z);
      }

      /** Where the low clouds are, seen from above: 0 clear sky, 1 the thickest part of a cloud. */
      float coverage(vec2 p){
        // a regional swell, so some parts of the sky are busier than others
        float region = vnoise(p * .8 + 7.3);
        float n;
        if (uStyle > 1.5 && uStyle < 2.5){
          // stratocumulus: long rolls broken into cells
          vec2 q = mat2(.87, -.5, .5, .87) * p;
          n = vnoise(q * vec2(2.6, 7.)) * .45 + vnoise(p * 13. + 3.1) * .35 + vnoise(p * 31. - 1.7) * .2;
        } else {
          // separate heads about a kilometre or two across, lumpier the closer you look
          float f = uStyle > .5 && uStyle < 1.5 ? 1.6 : uStyle > 2.5 ? .75 : 1.;
          n = vnoise(p * 7. * f) * .55 + vnoise(p * 15. * f + 3.1) * .3 + vnoise(p * 33. * f - 1.7) * .15;
        }
        float th = 1. - uCover * (.7 + .6 * region);
        return clamp((n - th) / max(1. - th, .05), 0., 1.);
      }

      /** How high a cloud with this coverage grows, as a share of the slab. */
      float crown(float c){
        // decks have flat tops; heaps grow tall domes over their thickest parts
        return uStyle > 1.5 && uStyle < 2.5 ? .55 + .45 * sqrt(c) : pow(c, .55);
      }

      /** Cloud shape without the fine detail: for the light that reaches a point. */
      float coarse(vec3 pos){
        float h = (pos.y - uBase) / (uTop - uBase);
        if (h < 0. || h > 1.) return 0.;
        float c = coverage(pos.xz * K + uWind + uOffset);
        return smoothstep(0., .12, crown(c) - h) * smoothstep(0., .04, h) * smoothstep(0., .25, c);
      }

      float density(vec3 pos, float dist){
        float base = coarse(pos);
        if (base < .001) return 0.;
        // billows: 3D noise eats into the edges more than the core, so the outline turns into
        // the rounded cauliflower heads of real cumulus
        vec3 q = (pos + vec3(uWind.x, 0., uWind.y) / K) * .0021;
        float n = vnoise3(q);
        // finer octaves only where they are bigger than a pixel; far away they would only alias.
        // Folded noise (1 - |2n - 1|) makes rounded lobes with sharp creases between them.
        if (dist < 14000.) n = n * .62 + (1. - abs(vnoise3(q * 3.1 + 5.) * 2. - 1.)) * .38;
        #if DETAIL > 1
        if (dist < 6000.) n = n * .8 + (1. - abs(vnoise3(q * 8.3 - 3.) * 2. - 1.)) * .2;
        #endif
        n = smoothstep(.2, .85, n);
        // a steep ramp keeps the edges crisp instead of fading out like fog
        return clamp((base - (1. - base * .5) * n * .9) * 2.4, 0., 1.);
      }

      /** Henyey-Greenstein phase, times 4π so isotropic scattering is 1. */
      float hg(float mu, float g){
        float d = 1. + g * g - 2. * g * mu;
        return (1. - g * g) / (d * sqrt(d));
      }

      /** One of the thin high layers at height y, premultiplied colour + alpha. */
      vec4 highLayer(vec3 ro, vec3 rd, float y, bool cirrus){
        if (rd.y < .002 || ro.y > y) return vec4(0.);
        float t = (y - ro.y) / rd.y;
        vec3 pos = ro + rd * t;
        float dist = length(pos.xz - ro.xz);
        if (dist > 70000.) return vec4(0.);
        vec2 p = pos.xz * K * .6 + uWind * 1.6 + uOffset * 1.7;
        float a;
        if (cirrus){
          // streaks combed by the jet stream, with hooked ends
          vec2 w = vec2(vnoise(p * 2.1 + 3.), vnoise(p * 2.1 - 5.));
          vec2 s = mat2(.92, -.39, .39, .92) * p;
          float streak = fbm(s * vec2(.9, 9.) + w * .9);
          float patchy = vnoise(p * 1.3 + 11.);
          a = smoothstep(.52, .85, streak) * smoothstep(.25, .7, patchy) * uCirrus * .62;
        } else {
          // mackerel sky: rows of small puffs, thinning out at the edges of the field
          vec2 s = mat2(.8, -.6, .6, .8) * p;
          float field = smoothstep(.35, .75, vnoise(p * 1.7 + 4.));
          float puffs = vnoise(s * vec2(48., 30.)) * .7 + vnoise(s * 110.) * .3;
          a = smoothstep(.62 - .25 * field, .9 - .2 * field, puffs) * field * uAlto * .8;
        }
        // seen edge-on far away, a sheet thins to nothing in the haze
        a *= 1. - smoothstep(30000., 70000., dist);
        if (a < .002) return vec4(0.);
        float mu = dot(rd, uSunDir);
        // high clouds stay lit after sunset: the sun lights them from below the horizon
        vec3 sun = uCloudLight * (.75 + .25 * hg(mu, .5)) * (cirrus ? 1.15 : 1.);
        vec3 amb = mix(uHorizon, uZenith, .6) * .9 + vec3(.012, .007, .003) * uCity;
        vec3 col = sun + amb;
        col = mix(col, hazeColor(rd), smoothstep(12000., 60000., dist) * .7);
        return vec4(col * a, a);
      }

      void main(){
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        float mu = dot(rd, uSunDir);
        // forward scattering makes silver linings toward the sun, a little back-scatter keeps the
        // side away from it from going flat
        float phase = min(mix(hg(mu, -.2), hg(mu, .62), .45), 3.2);
        vec3 amb = mix(uHorizon, uZenith, .55);
        vec3 cityGlow = vec3(.05, .026, .011) * uCity;
        vec3 moon = uMoonLight * .35;

        vec3 L = vec3(0.);
        float T = 1.;
        float distSum = 0., wSum = 0.;

        // the stretch of this ray inside the low-cloud slab
        float ta = (uBase - ro.y) / (abs(rd.y) > 1e-5 ? rd.y : 1e-5);
        float tb = (uTop - ro.y) / (abs(rd.y) > 1e-5 ? rd.y : 1e-5);
        float t0 = max(min(ta, tb), 0.);
        float t1 = min(max(ta, tb), ${FAR.toFixed(1)});
        if (t1 > t0){
          // steps grow with distance: fine where clouds are big on screen, coarse at the horizon
          float span = t1 - t0;
          float jitter = hash12(gl_FragCoord.xy);
          for (int i = 0; i < STEPS; i++){
            if (T < .03) break;
            float u0 = float(i) / float(STEPS), u1 = (float(i) + 1.) / float(STEPS);
            // a per-pixel offset turns the banding of the steps into fine grain
            float um = mix(u0, u1, jitter);
            float t = t0 + span * um * um;
            float dt = span * (u1 * u1 - u0 * u0);
            vec3 pos = ro + rd * t;
            float d = density(pos, t);
            if (d > .002){
              float h = clamp((pos.y - uBase) / (uTop - uBase), 0., 1.);
              // light from the sun, dimmed by the cloud above and toward it
              float od = coarse(pos + uSunDir * 90.) * 90. + coarse(pos + uSunDir * 320.) * 230.;
              // beer's law plus a softer second term for light scattered many times inside
              float toSun = exp(-od * .006) * .65 + exp(-od * .0014) * .35;
              // dark edges where light can't scatter back out ("powder"), mostly away from the sun
              float powder = mix(1. - exp(-d * 6.), 1., .35 + .4 * max(mu, 0.));
              vec3 sun = uCloudLight * phase * toSun * powder * .85;
              // the sky lights the tops more than the bases; the city lights the bases at night
              // (at night the sky's own glow is faint: the clouds are lit from below by the city)
              vec3 sky = amb * (.55 + .75 * h) * (.85 + .15 * d) * (1. - .5 * uCity);
              vec3 below = cityGlow * (1. - h) * (1. - h) * 1.6 + moon * toSun;
              vec3 col = sun + sky + below;
              float a = 1. - exp(-d * .007 * dt);
              L += T * a * col;
              distSum += T * a * t;
              wSum += T * a;
              T *= 1. - a;
            }
          }
        }
        float lowA = 1. - T;
        if (wSum > 0.){
          // the distant clouds fade into the haze toward the horizon
          float dist = distSum / wSum;
          float haze = smoothstep(7000., 36000., dist) * .85;
          vec3 hc = hazeColor(rd);
          L = mix(L, hc * lowA, haze);
          float fade = 1. - smoothstep(${(FAR * .62).toFixed(1)}, ${FAR.toFixed(1)}, dist);
          L *= fade;
          lowA *= fade;
        }
        // behind the low clouds: altocumulus, then cirrus
        vec4 alto = highLayer(ro, rd, ${ALTO_Y.toFixed(1)}, false);
        vec4 ci = highLayer(ro, rd, ${CIRRUS_Y.toFixed(1)}, true);
        vec4 high = alto + ci * (1. - alto.a);
        vec3 C = L + high.rgb * (1. - lowA);
        float A = lowA + high.a * (1. - lowA);
        gl_FragColor = vec4(A > .0005 ? C / A : vec3(0.), A);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const height = CIRRUS_Y + 400 - weather.base;
  const geometry = new THREE.BoxGeometry(96000, height, 96000).translate(0, weather.base + height / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
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
