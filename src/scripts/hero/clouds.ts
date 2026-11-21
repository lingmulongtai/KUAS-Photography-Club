import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import {cloudWeather,LOWEST_CLOUD_BASE} from './cloud-weather';
import { CLOUD_COLUMN_GLSL, CLOUD_COLUMN_LOOKUP, createCloudColumns, WEATHER_SCALE } from './cloud-columns.ts';
import type {Climate} from './seasons';

import { CIRRUS_Y, HIGH_CLOUD_GLSL } from './high-clouds.ts';

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

  // Runtime loop bounds keep GPU drivers from duplicating the large noise function at compile time.
  const detail = quality > .75 ? 2 : 1;
  const uniforms = {
    ...env,

    uVolumeOnly: { value: false },
    uMarchSteps: { value: detail === 2 ? 40 : 22 },
    uEdgeRefinements: { value: detail + 2 },
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
  const columns = createCloudColumns(uniforms);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...columns.uniforms },
    defines: { DETAIL: detail },
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
      ${CLOUD_COLUMN_GLSL}
      ${CLOUD_COLUMN_LOOKUP}
      uniform float uBase;
      uniform float uTop;
      uniform bool uVolumeOnly;
      uniform int uMarchSteps;
      uniform int uEdgeRefinements;
      varying vec3 vWorld;

      /** weather-map units per metre: one unit is about 9 km */
      const float K = ${WEATHER_SCALE};
      ${HIGH_CLOUD_GLSL}

      float vnoise3(vec3 p){
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(
          mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
          f.z);
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
        vec3 column = lookupColumn(xz * K - uWind + uOffset);
        float d = smoothstep(0., .1, column.r - h) * smoothstep(0., .04, h) * column.g;
        if (isStyle(4.)){
          float band = smoothstep(.8, .88, h) * (1. - smoothstep(.95, 1., h));
          d = max(d, band * column.b * .7);
        }
        return d;
      }

      /** Where the billows are: tall clouds churn in bigger ones. */
      vec3 billowAt(vec3 pos){
        return (pos - vec3(uWind.x, 0., uWind.y) / K) * (isStyle(4.) ? .0011 : isStyle(3.) ? .0015 : .0021);
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
        // Fade detail continuously: hard distance cut-offs slice low winter clouds into bands.
        if (dist < 16000.) n = mix(n, 1. - abs(vnoise3(q * 3.1 + 5.) * 2. - 1.), .38 * (1. - smoothstep(10000., 16000., dist)));
        #if DETAIL > 1
        if (dist < 8000.) n = mix(n, 1. - abs(vnoise3(q * 8.3 - 3.) * 2. - 1.), .2 * (1. - smoothstep(4000., 8000., dist)));
        #endif
        return erode(base, n);
      }

      // The quadratic near spacing joins a uniform far grid with the same slope at the knee.
      float rayStation(float distanceAlongRay, vec4 grid){
        return distanceAlongRay < grid.w
          ? 2.*distanceAlongRay / (grid.x + sqrt(grid.x*grid.x + 2.*distanceAlongRay))
          : grid.z + (distanceAlongRay - grid.w) / grid.y;
      }
      float stationDistance(float station, vec4 grid){
        float n = min(station, grid.z);
        return n*(grid.x + .5*n) + max(station-grid.z, 0.)*grid.y;
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
        float t0 = 0., t1 = ${FAR.toFixed(1)};
        if (abs(rd.y) > 1e-7) {
          float baseHit = (uBase - ro.y) / rd.y, topHit = (uTop - ro.y) / rd.y;
          t0 = max(0., min(baseHit, topHit));
          t1 = min(t1, max(baseHit, topHit));
        } else if (ro.y < uBase || ro.y > uTop) {
          t1 = 0.;
        }
        if (t1 > t0) {
          // Place samples in metres from the eye. Extending the ray towards the
          // horizon must not move the samples already inside a nearby cloud.
          float verticalLimit = (uTop - uBase) / (float(uMarchSteps) * max(abs(rd.y), .001));
          #if DETAIL > 1
          float maxStep = min(76., verticalLimit), startStep = min(16., maxStep);
          #else
          float maxStep = min(96., verticalLimit), startStep = min(20., maxStep);
          #endif
          float knee = maxStep - startStep;
          vec4 grid = vec4(startStep, maxStep, knee, knee*(startStep + .5*knee));
          float station = floor(rayStation(t0, grid)) + 1.;
          float t = t0, d0 = density(ro + rd*t, t);
          float nextBlock = t0;
          float layerDepth = uTop-uBase;
          bool useCeilings = uColumnsReady && !isStyle(3.) && !isStyle(4.);
          for (int i = 0; i < uMarchSteps * 32; ++i) {
            if (T < .012 || t >= t1) break;
            if (useCeilings && t >= nextBlock) {
              float run;
              bool empty = emptyColumnRun(uColumnEye + rd.xz*t/outerColumnMetres, rd.xz,
                (ro.y + rd.y*t-uBase)/layerDepth, rd.y/layerDepth, t1-t, run);
              nextBlock = t + run + .01;
              if (empty && d0 <= .002) {
                if (run >= t1-t) break;
                float lastEmpty = floor(rayStation(t+run, grid));
                if (lastEmpty >= station) {
                  t = stationDistance(lastEmpty, grid);
                  station = lastEmpty + 1.;
                  d0 = 0.;
                }
              }
            }
            float nextT = min(t1, stationDistance(station, grid));
            station += 1.;
            float d1 = density(ro + rd*nextT, nextT);
            float lo = t, hi = nextT, left = d0, right = d1;
            t = nextT; d0 = d1;
            if (max(left, right) <= .002) continue;
            if ((left > .002) != (right > .002)) {
              // Locate both entrances and exits. Only the occupied part absorbs light.
              float a = lo, b = hi;
              for (int k = 0; k < uEdgeRefinements; ++k) {
                float m = .5*(a+b);
                if ((density(ro+rd*m, m) > .002) == (right > .002)) b=m; else a=m;
              }
              if (left <= .002) lo=a; else hi=b;
            }
            // Integrate extinction over the segment, and shade at its optical-depth centroid.
            // A middle sample resolves steep changes; nearly uniform interiors integrate linearly.
            float middle = .5*(left+right);
            if (abs(left-right) > .12) {
              float m = .5*(lo+hi);
              middle = density(ro+rd*m, m);
            }
            float mass = left + 4.*middle + right;
            float segmentDensity = mass / 6., dt = hi-lo;
            float shadeT = mix(lo, hi, (2.*middle + right) / mass);
            vec3 lightPos = ro + rd*shadeT;
            float h = clamp((lightPos.y - uBase) / (uTop - uBase), 0., 1.);
            // light from the sun, dimmed by the cloud above and toward it
            // (bigger clouds shade themselves over a bigger distance)
            float ls = isStyle(4.) ? 3. : isStyle(3.) ? 1.8 : 1.;
            #if DETAIL > 1
            // near the surface the billows shade each other, which models the heads
            float od = (lumps(lightPos + uSunDir * 90. * ls) * 90. + coarse(lightPos + uSunDir * 320. * ls) * 230.) * ls;
            #else
            float od = (coarse(lightPos + uSunDir * 90. * ls) * 90. + coarse(lightPos + uSunDir * 320. * ls) * 230.) * ls;
            #endif
            // beer's law plus a softer second term for light scattered many times inside
            float toSun = exp(-od * .006) * .65 + exp(-od * .0014) * .35;
            // dark edges where light can't scatter back out ("powder"), mostly away from the sun
            float powder = mix(1. - exp(-segmentDensity * 6.), 1., .35 + .4 * max(mu, 0.));
            // a snow deck is thick and grey all through
            vec3 sun = uCloudLight * phase * toSun * powder * (isStyle(5.) ? .45 : .85);
            // the sky lights the tops more than the bases; the city lights the bases at night
            // (at night the sky's own glow is faint: the clouds are lit from below by the city)
            vec3 sky = amb * (.55 + .75 * h) * (.85 + .15 * segmentDensity) * (1. - .5 * uCity) * (isStyle(5.) ? .75 : 1.);
            vec3 below = cityGlow * (1. - h) * (1. - h) * 1.6 + moon * toSun;
            // snow clouds are thick and grey all the way through
            vec3 col = (sun + sky + below) * (isStyle(5.) ? .62 : 1.);
            float a = 1. - exp(-segmentDensity * .007 * dt);
            L += T * a * col;
            distSum += T * a * shadeT;
            wSum += T * a;
            T *= 1. - a;
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
        vec4 high = uVolumeOnly ? vec4(0.) : highClouds(ro, rd);
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
  const bottom = LOWEST_CLOUD_BASE;
  const geometry = new THREE.CylinderGeometry(DRUM, DRUM, CIRRUS_Y + 400 - bottom, 96, 1).translate(0, (CIRRUS_Y + 400 + bottom) / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  let shown = climate;
  return {
    mesh, uniforms, columnMesh: columns.mesh, restored: columns.restored,
    prepareField(renderer: THREE.WebGLRenderer, eye: THREE.Vector3) {
      columns.update(renderer, eye.x * WEATHER_SCALE - uniforms.uWind.value.x + weather.offset[0],
        eye.z * WEATHER_SCALE - uniforms.uWind.value.y + weather.offset[1], weather);
    },
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
