import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import {cloudWeather} from './cloud-weather';
import type {Climate} from './seasons';

/** Height of the cirrus streaks and the altocumulus field, metres. */
const CIRRUS_Y = 8200;
const ALTO_Y = 4600;
/** Clouds fade out into the haze before this distance. */
const FAR = 44000;
/** Radius of the drum the clouds are drawn on: beyond FAR, inside the camera's far plane. */
const DRUM = 52000;

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
export function buildClouds(env: Env,seed=Math.floor(Math.random()*4294967296),quality=1,climate:Climate='spring') {
  let weather=cloudWeather(seed,climate);
  const uniforms = {
    ...env,
    uCover: { value: weather.cover },
    uClear: { value: weather.clear },
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
      uniform float uClear;
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

      // characters (cloud-weather.ts): 0 cumulus, 1 fair, 2 stratocumulus, 3 congestus,
      // 4 cumulonimbus, 5 snow deck
      bool isStyle(float s){ return abs(uStyle - s) < .5; }
      bool deck(){ return isStyle(2.) || isStyle(5.); }

      /**
       * The low clouds seen from above: x is how cloudy the sky is at p, y the level above which
       * it is cloud, z how tall the cloud there grows (0..1).
       */
      vec3 field(vec2 p){
        // bend the weather map so the cells never line up in rows or repeat one size
        p += (vec2(vnoise(p * 1.7 + 2.3), vnoise(p * 1.7 - 4.1)) - .5) * .4;
        // a regional swell, so some parts of the sky are busier than others
        float region = vnoise(p * .8 + 7.3);
        // and wide clear stretches between groups of clouds: these take whole clouds away (the
        // ones at the edge of a group come out smaller) rather than thinning every cloud
        float clear = smoothstep(.35, .7, vnoise(p * .45 - 3.9)) * uClear;
        float n;
        if (deck()){
          // long rolls broken into cells
          vec2 q = mat2(.87, -.5, .5, .87) * p * (isStyle(5.) ? .7 : 1.);
          n = vnoise(q * vec2(2.6, 7.)) * .45 + vnoise(p * 13. + 3.1) * .35 + vnoise(p * 31. - 1.7) * .2;
        } else {
          float f = isStyle(1.) ? 1.7 : isStyle(3.) ? .7 : isStyle(4.) ? .26 : 1.;
          // big clouds in some parts of the sky, small ones in others: two sizes of cell, blended
          // (scaling the coordinates by a varying amount would smear the cells into streaks)
          float big = vnoise(p * 4.2 * f + 5.5) * .6 + vnoise(p * 9. * f - 2.2) * .4;
          float small = vnoise(p * 9.5 * f) * .55 + vnoise(p * 21. * f + 3.1) * .3 + vnoise(p * 43. * f - 1.7) * .15;
          // thunderheads are all big
          n = isStyle(4.) ? big : mix(small, big, smoothstep(.3, .7, vnoise(p * 1.3 - 9.7)));
        }
        float th = 1. - uCover * (.7 + .6 * region) + clear * .4;
        // some heads stay flat while their neighbours tower; a thunderhead climbs in turrets
        float tall = deck() ? 1. : isStyle(4.) ? mix(.5, 1., vnoise(p * 6. + 1.9)) : mix(.45, 1., vnoise(p * 3.3 + 1.9));
        if (isStyle(3.) || isStyle(4.)) tall *= mix(.75, 1., vnoise(p * 15. - 6.1));
        return vec3(n, th, tall);
      }

      /** 0 clear sky, 1 the thickest part of a cloud; spread lets the cloud reach further out. */
      float cover(vec3 f, float spread){
        return clamp((f.x - f.y + spread) / max(1. - f.y, .05), 0., 1.);
      }

      /** How high a cloud with this coverage grows, as a share of the slab. */
      float crown(float c){
        // decks have flat tops; heaps grow domes over their thickest parts; thunderheads tower
        // (a thunderhead is a broad dome of cloud, widest at the base, not a column or a spire)
        return deck() ? .5 + .5 * sqrt(c) : isStyle(4.) ? sqrt(1. - (1. - c) * (1. - c)) : isStyle(3.) ? pow(c, .5) : pow(c, .6);
      }

      /** Cloud shape without the fine detail: for the light that reaches a point. */
      float coarse(vec3 pos){
        float h = (pos.y - uBase) / (uTop - uBase);
        if (h < 0. || h > 1.) return 0.;
        vec2 xz = pos.xz;
        if (isStyle(3.) || isStyle(4.)){
          // towers lean and bulge as they climb, so their sides break into heaped lobes instead
          // of running straight up from the outline at the base
          vec3 w = pos * .00045;
          xz += (vec2(vnoise3(w), vnoise3(w + 17.3)) - .5) * (uTop - uBase) * .22;
        }
        vec3 f = field(xz * K + uWind + uOffset);
        float c = cover(f, 0.);
        float d = smoothstep(0., .1, crown(c) * f.z - h) * smoothstep(0., .04, h) * smoothstep(0., .25, c);
        if (isStyle(4.)){
          // the anvil: at the top of the troposphere a thunderhead spreads out into a flat sheet
          float band = smoothstep(.8, .88, h) * (1. - smoothstep(.95, 1., h));
          d = max(d, band * smoothstep(0., .3, cover(f, .07)) * .7);
        }
        return d;
      }

      /** Where the billows are: tall clouds churn in bigger ones. */
      vec3 billowAt(vec3 pos){
        return (pos + vec3(uWind.x, 0., uWind.y) / K) * (isStyle(4.) ? .0011 : isStyle(3.) ? .0015 : .0021);
      }

      /** 3D noise n eats into the edges more than the core. */
      float erode(float base, float n){
        // a steep ramp keeps the edges crisp instead of fading out like fog
        // (towering clouds are lumpier: their heads bulge out of the tower)
        float bite = isStyle(4.) ? 1.25 : isStyle(3.) ? 1.05 : .9;
        return clamp((base - (1. - base * .5) * smoothstep(.2, .85, n) * bite) * 2.4, 0., 1.);
      }

      /** The cloud with its big billows only: for the shadows the billows cast on each other. */
      float lumps(vec3 pos){
        float base = coarse(pos);
        return base < .001 ? 0. : erode(base, vnoise3(billowAt(pos)));
      }

      float density(vec3 pos, float dist){
        float base = coarse(pos);
        if (base < .001) return 0.;
        // billows: the outline turns into the rounded cauliflower heads of real cumulus
        vec3 q = billowAt(pos);
        float n = vnoise3(q);
        // finer octaves only where they are bigger than a pixel; far away they would only alias.
        // Folded noise (1 - |2n - 1|) makes rounded lobes with sharp creases between them.
        if (dist < 14000.) n = n * .62 + (1. - abs(vnoise3(q * 3.1 + 5.) * 2. - 1.)) * .38;
        #if DETAIL > 1
        if (dist < 6000.) n = n * .8 + (1. - abs(vnoise3(q * 8.3 - 3.) * 2. - 1.)) * .2;
        #endif
        return erode(base, n);
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
          // a per-pixel offset trades the banding of the steps for a fine grain; kept to half a
          // step, the grain stays below the film grain of the finish
          // (interleaved gradient noise: neighbouring pixels take evenly spread offsets, which reads
          // as a finer, calmer grain than independent random ones)
          float jitter = .25 + .5 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
          // tall slabs (towering clouds) need more steps to stay solid
          float steps = min(float(STEPS) * (1. + (uTop - uBase) / 3000.), float(STEPS) * 2.);
          float tPrev = t0;
          bool inside = false;
          for (int i = 0; i < STEPS * 2; i++){
            if (T < .03 || float(i) >= steps) break;
            float u0 = float(i) / steps, u1 = (float(i) + 1.) / steps;
            // a per-pixel offset turns the banding of the steps into fine grain
            float um = mix(u0, u1, jitter);
            float t = t0 + span * um * um;
            float tEnd = t0 + span * u1 * u1;
            float dt = span * (u1 * u1 - u0 * u0);
            vec3 pos = ro + rd * t;
            float d = density(pos, t);
            if (d > .002 && !inside){
              // The ray entered a cloud somewhere since the last sample. Find where: shaded at the
              // step it happened to land on, a cloud's face would be sliced into bands, one per step.
              float lo = tPrev, hi = t;
              for (int k = 0; k < DETAIL + 2; k++){
                float mid = .5 * (lo + hi);
                if (density(ro + rd * mid, mid) > .002) hi = mid;
                else lo = mid;
              }
              t = hi;
              pos = ro + rd * t;
              d = max(density(pos, t), .003);
              // only the rest of the step is inside the cloud
              dt = tEnd - t;
            }
            inside = d > .002;
            tPrev = t;
            if (d > .002){
              float h = clamp((pos.y - uBase) / (uTop - uBase), 0., 1.);
              // light from the sun, dimmed by the cloud above and toward it
              // (bigger clouds shade themselves over a bigger distance)
              float ls = isStyle(4.) ? 3. : isStyle(3.) ? 1.8 : 1.;
              #if DETAIL > 1
              // near the surface the billows shade each other, which models the heads
              float od = (lumps(pos + uSunDir * 90. * ls) * 90. + coarse(pos + uSunDir * 320. * ls) * 230.) * ls;
              #else
              float od = (coarse(pos + uSunDir * 90. * ls) * 90. + coarse(pos + uSunDir * 320. * ls) * 230.) * ls;
              #endif
              // beer's law plus a softer second term for light scattered many times inside
              float toSun = exp(-od * .006) * .65 + exp(-od * .0014) * .35;
              // dark edges where light can't scatter back out ("powder"), mostly away from the sun
              float powder = mix(1. - exp(-d * 6.), 1., .35 + .4 * max(mu, 0.));
              // a snow deck is thick and grey all through
              vec3 sun = uCloudLight * phase * toSun * powder * (isStyle(5.) ? .45 : .85);
              // the sky lights the tops more than the bases; the city lights the bases at night
              // (at night the sky's own glow is faint: the clouds are lit from below by the city)
              vec3 sky = amb * (.55 + .75 * h) * (.85 + .15 * d) * (1. - .5 * uCity) * (isStyle(5.) ? .75 : 1.);
              vec3 below = cityGlow * (1. - h) * (1. - h) * 1.6 + moon * toSun;
              // snow clouds are thick and grey all the way through
              vec3 col = (sun + sky + below) * (isStyle(5.) ? .62 : 1.);
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
  // The rays are marched from the inside of a drum around the camera, which starts below the lowest
  // cloud base any character uses. Every point of it stays inside the camera's far plane (60 km):
  // the corners of a box that reached as far along the axes were beyond it, and the clouds toward
  // north-east, south-east and so on were cut off there.
  const bottom = 850;
  const geometry = new THREE.CylinderGeometry(DRUM, DRUM, CIRRUS_Y + 400 - bottom, 96, 1).translate(0, (CIRRUS_Y + 400 + bottom) / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  let shown = climate;
  return {
    mesh, uniforms,
    get weather() { return weather; },
    /** Redraw the sky for another season (the same visit keeps its seed). */
    setClimate(next: Climate) {
      if (next === shown) return;
      shown = next;
      weather = cloudWeather(seed, next);
      uniforms.uCover.value = weather.cover;
      uniforms.uClear.value = weather.clear;
      uniforms.uStyle.value = weather.style;
      uniforms.uBase.value = weather.base;
      uniforms.uTop.value = weather.top;
      uniforms.uCirrus.value = weather.cirrus;
      uniforms.uAlto.value = weather.alto;
      uniforms.uOffset.value.set(...weather.offset);
    },
  };
}

/** Cloud cover for a given day: different every day, the same all day. */
export function coverForDay(year: number, month: number, day: number) {
  let h = year * 372 + month * 31 + day;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  return 0.34 + r * 0.3;
}
