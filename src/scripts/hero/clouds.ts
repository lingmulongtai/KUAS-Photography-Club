import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { cloudWeather, LOWEST_CLOUD_BASE } from './cloud-weather';
import { CLOUD_COLUMN_GLSL, CLOUD_COLUMN_LOOKUP, createCloudColumns, WEATHER_SCALE } from './cloud-columns.ts';
import { cloudNoiseTexture } from './cloud-noise.ts';
import type { Climate } from './seasons';
import { CIRRUS_Y, HIGH_CLOUD_GLSL } from './high-clouds.ts';

/** Clouds fade out into the haze before this distance. */
const FAR = 44000;
/** Radius of the drum the clouds are drawn on: beyond FAR, inside the camera's far plane. */
const DRUM = 52000;

/**
 * Volumetric 3D clouds sculpted with tileable Perlin-Worley + multi-octave Worley FBM noise,
 * jittered adaptive raymarching (free of slice banding), and multi-scattering sun/sky lighting.
 * Above the low convective slab, high altocumulus and feathered cirrus sheets retain twilight glow.
 */
export function buildClouds(env: Env, seed = Math.floor(Math.random() * 4294967296), quality = 1, climate: Climate = 'spring') {
  let weather = cloudWeather(seed, climate);

  const detail = quality > .75 ? 2 : 1;
  const uniforms = {
    ...env,
    uCloudNoise: { value: cloudNoiseTexture() },
    uVolumeOnly: { value: false },
    uMarchSteps: { value: detail === 2 ? 44 : 26 },
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
      uniform mediump sampler3D uCloudNoise;
      uniform float uBase;
      uniform float uTop;
      uniform bool uVolumeOnly;
      uniform int uMarchSteps;
      varying vec3 vWorld;

      /** weather-map units per metre: one unit is about 9 km */
      const float K = ${WEATHER_SCALE};
      ${HIGH_CLOUD_GLSL}

      float remap(float v, float lo0, float hi0, float lo1, float hi1){
        return lo1 + (v - lo0) * (hi1 - lo1) / max(hi0 - lo0, 1e-5);
      }

      /** Static screen-space Interleaved Gradient Noise to break raymarch layering without temporal flicker. */
      float ign(vec2 p){
        return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
      }

      vec3 cloudCoord(vec3 pos){
        // Tileable 3D Perlin-Worley scale tuned for crisp ~80-220 m cumulus cauliflower lobes.
        float invCell = isStyle(4.) ? .00046 : isStyle(3.) ? .00066 : isStyle(2.) || isStyle(5.) ? .00084 : .00096;
        vec3 p = pos - vec3(uWind.x, 0., uWind.y) / K;
        // Slight horizontal breadth gives cumulus puffs wide, natural bases rather than tall spikes.
        return vec3(p.x, p.y * 1.24, p.z) * invCell;
      }

      /** Macro cloud envelope from the 2D weather column map and vertical profile (0..1). */
      float coarse(vec3 pos){
        float h = (pos.y - uBase) / (uTop - uBase);
        if (h <= 0. || h >= 1.) return 0.;
        vec2 xz = pos.xz;
        if (isStyle(3.) || isStyle(4.)){
          // Tall convective towers shear gently with altitude into broad overhanging lobes.
          vec3 w = texture(uCloudNoise, (pos - vec3(uWind.x, 0., uWind.y) / K) * .00014).rgb - .5;
          xz += w.xz * (uTop - uBase) * .14 * h;
        }
        vec3 column = lookupColumn(xz * K - uWind + uOffset);
        float topH = column.r;
        float cov = column.g;
        if (topH <= .001 || cov <= .001) return 0.;
        // Flat-ish convective cloud base and rounded mushroom crown; strictly zero at h = 0 and h = topH
        // so emptyColumnRun acceleration remains conservative.
        float baseSoft = mix(.16, .07, cov);
        float baseGrad = smoothstep(0., baseSoft, h);
        float topGrad = 1. - smoothstep(topH * .64, topH, h);
        float env = baseGrad * topGrad * cov;
        if (isStyle(4.)){
          float anvil = smoothstep(.76, .87, h) * (1. - smoothstep(.93, 1., h)) * column.b * .74;
          env = max(env, anvil);
        }
        return env;
      }

      /** Macro 3D Perlin-Worley billows for volumetric self-shadowing probes. */
      float lumps(vec3 pos){
        float env = coarse(pos);
        if (env <= .001) return 0.;
        vec4 n = texture(uCloudNoise, cloudCoord(pos));
        float fbmLow = n.g * .625 + n.b * .25 + n.a * .125;
        float shape = clamp(remap(n.r, -(1. - fbmLow) * .62, 1., 0., 1.), 0., 1.);
        float sculpted = clamp(remap(shape, 1. - min(1., env * 1.18), 1., 0., 1.), 0., 1.);
        return sculpted * mix(.65, 1.0, env);
      }

      /** Full 3D volumetric cloud density with multi-scale cauliflower billows & frothy wisps. */
      float density(vec3 pos, float dist){
        float env = coarse(pos);
        if (env <= .001) return 0.;
        float h = clamp((pos.y - uBase) / (uTop - uBase), 0., 1.);
        vec3 q = cloudCoord(pos);
        vec4 baseN = texture(uCloudNoise, q);
        float fbmLow = baseN.g * .625 + baseN.b * .25 + baseN.a * .125;
        // Perlin-Worley base shape forms broad cauliflower heads and internal density pockets.
        float shape = clamp(remap(baseN.r, -(1. - fbmLow) * .65, 1., 0., 1.), 0., 1.);
        float d = clamp(remap(shape, 1. - min(1., env * 1.18), 1., 0., 1.), 0., 1.) * mix(.65, 1.0, env);
        if (d <= .0005) return 0.;

        // Mid-scale curling Worley detail carves puffy cauliflower sub-lobes (fades continuously with distance).
        float detailFade = 1. - smoothstep(8000., 24000., dist);
        if (detailFade > .001){
          vec3 curl = (baseN.gbr - .5) * .26;
          vec4 hiN = texture(uCloudNoise, q * 2.75 + curl + vec3(0., h * .18, 0.));
          float hiFbm = hiN.g * .625 + hiN.b * .25 + hiN.a * .125;
          float hiMod = mix(hiFbm, 1. - hiFbm, smoothstep(.04, .26, h));
          float edgeMask = 1. - d * .48;
          float erodeStrength = (isStyle(4.) ? .58 : isStyle(3.) ? .54 : isStyle(5.) ? .36 : .52) * detailFade * edgeMask;
          d = clamp(remap(d, hiMod * erodeStrength, 1., 0., 1.), 0., 1.);

          // Close-up frothy turbulence (~20-50 m wisps) prevents smooth clay-like surfaces overhead.
          #if DETAIL > 1
          float closeFade = 1. - smoothstep(3800., 10500., dist);
          if (closeFade > .001 && d > .001){
            vec4 fineN = texture(uCloudNoise, q * 7.2 + curl * 2.1 + hiN.rgb * .16);
            float fineFbm = fineN.g * .55 + fineN.b * .30 + fineN.a * .15;
            float wispErode = (1. - fineFbm) * .42 * closeFade * (1. - d * .55);
            d = clamp(remap(d, wispErode, 1., 0., 1.), 0., 1.);
          }
          #endif
        }
        // Soft frothy edge feathering with dense sunlit upper interiors.
        float densityProfile = mix(.68, 1.22, smoothstep(.05, .44, h));
        return clamp(pow(d, 1.18) * densityProfile, 0., 1.);
      }

      void main(){
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        float mu = dot(rd, uSunDir);
        vec3 cityGlow = vec3(.052, .027, .011) * uCity;
        vec3 moon = uMoonLight * .36;

        vec3 L = vec3(0.);
        float T = 1.;
        float distSum = 0., wSum = 0.;

        // Ray interval inside the low-cloud slab.
        float t0 = 0., t1 = ${FAR.toFixed(1)};
        if (abs(rd.y) > 1e-7) {
          float baseHit = (uBase - ro.y) / rd.y, topHit = (uTop - ro.y) / rd.y;
          t0 = max(0., min(baseHit, topHit));
          t1 = min(t1, max(baseHit, topHit));
        } else if (ro.y < uBase || ro.y > uTop) {
          t1 = 0.;
        }

        if (t1 > t0) {
          float layerDepth = uTop - uBase;
          float qualityScale = ${detail > 1 ? '1.0' : '1.45'};
          float verticalCap = layerDepth / (float(uMarchSteps) * max(abs(rd.y), .14));
          float jitter = ign(gl_FragCoord.xy);
          float firstStep = min(mix(9.0, 74., smoothstep(600., 34000., t0)) * qualityScale, verticalCap);
          float t = t0 + jitter * firstStep;
          float nextBlock = t0;
          bool useCeilings = uColumnsReady && !isStyle(3.) && !isStyle(4.);
          bool fineMode = false;
          int emptyFine = 0;
          float extinction = isStyle(5.) ? .024 : isStyle(4.) ? .028 : .036;
          float ls = isStyle(4.) ? 2.4 : isStyle(3.) ? 1.55 : 1.0;

          float emptyStride = useCeilings ? 2.6 : 3.8;
          #if DETAIL > 1
          const int MAX_ITERS = 200;
          #else
          const int MAX_ITERS = 130;
          #endif

          for (int i = 0; i < MAX_ITERS; ++i) {
            if (T < .004 || t >= t1) break;
            if (useCeilings && !fineMode && t >= nextBlock) {
              float run;
              bool empty = emptyColumnRun(uColumnEye + rd.xz * t / outerColumnMetres, rd.xz,
                (ro.y + rd.y * t - uBase) / layerDepth, rd.y / layerDepth, t1 - t, run);
              nextBlock = t + run + .05;
              if (empty) {
                if (run >= t1 - t) break;
                float skipStep = min(mix(9.0, 74., smoothstep(600., 34000., t + run)) * qualityScale, verticalCap);
                t += run + jitter * skipStep * .65;
                continue;
              }
            }

            float fineStep = min(mix(9.0, 74., smoothstep(600., 34000., t)) * qualityScale, verticalCap);
            float dt = fineMode ? fineStep : fineStep * emptyStride;
            dt = min(dt, t1 - t);
            if (dt <= .01) break;

            vec3 pos = ro + rd * (t + dt * .5);
            float envVal = coarse(pos);

            if (!fineMode) {
              if (envVal > .001) {
                t = max(t0, t - fineStep * .5);
                fineMode = true;
                emptyFine = 0;
                continue;
              }
              t += dt;
              continue;
            }

            float d = envVal > .001 ? density(pos, t + dt * .5) : 0.;
            if (d <= .0008) {
              emptyFine++;
              if (emptyFine >= 4) fineMode = false;
              t += dt;
              continue;
            }
            emptyFine = 0;

            float h = clamp((pos.y - uBase) / layerDepth, 0., 1.);
            // Exponential sun-ray optical depth: 3D billow probes carve sculptural shadows between cumulus heads.
            #if DETAIL > 1
            float od = (
              lumps(pos + uSunDir * (22. * ls)) * 28. +
              lumps(pos + uSunDir * (64. * ls)) * 58. +
              lumps(pos + uSunDir * (145. * ls)) * 96. +
              coarse(pos + uSunDir * (310. * ls)) * 180.
            ) * ls * extinction * .95;
            #else
            float od = (
              lumps(pos + uSunDir * (34. * ls)) * 45. +
              lumps(pos + uSunDir * (110. * ls)) * 95. +
              coarse(pos + uSunDir * (280. * ls)) * 175.
            ) * ls * extinction * .95;
            #endif

            // 3-octave multiple scattering: bright sunlit tops, silver rims, and soft blue-grey shadowed bellies.
            float atten = 1., contrib = 1., ecc = 1.;
            float sunScatter = 0.;
            for (int oct = 0; oct < 3; ++oct) {
              float ph = min(mix(hg(mu, -.25 * ecc), hg(mu, .72 * ecc), .66), 3.2);
              sunScatter += contrib * ph * exp(-od * atten);
              atten *= .40;
              contrib *= .46;
              ecc *= .50;
            }
            // Subtle powder dark-edge relief on shadowed sides facing away from the sun.
            float powder = mix(.66 + .34 * (1. - exp(-d * 5.0)), 1., .42 + .48 * max(mu, 0.));
            vec3 sun = uCloudLight * sunScatter * powder * (isStyle(5.) ? .44 : .84);

            // Ambient sky illumination: cool blue-grey underside shadows vs luminous zenith-lit tops.
            float skyVis = mix(.34, 1.0, smoothstep(0., .78, h)) * mix(1.0, .72, clamp(d * 1.15, 0., 1.));
            vec3 skyTint = mix(mix(uHorizon, uZenith, .45), mix(uHorizon, uZenith, .74), h);
            vec3 sky = skyTint * skyVis * (1.02 - .52 * uCity) * (isStyle(5.) ? .74 : 1.0);
            vec3 below = cityGlow * (1. - h) * (1. - h) * 1.65 + moon * exp(-od * .55);
            vec3 col = (sun + sky + below) * (isStyle(5.) ? .66 : 1.);

            float sigma = d * extinction;
            float stepT = exp(-sigma * dt);
            float a = 1. - stepT;
            L += T * a * col;
            distSum += T * a * (t + dt * .5);
            wSum += T * a;
            T *= stepT;
            t += dt;
          }
        }

        float lowA = 1. - T;
        if (wSum > 0.){
          // Distant clouds blend smoothly into aerial perspective haze toward the horizon.
          float dist = distSum / wSum;
          float haze = smoothstep(7000., 36000., dist) * .85;
          vec3 hc = hazeColor(rd);
          L = mix(L, hc * lowA, haze);
          float fade = 1. - smoothstep(${(FAR * .62).toFixed(1)}, ${FAR.toFixed(1)}, dist);
          L *= fade;
          lowA *= fade;
        }
        // Behind the low clouds: altocumulus, then feathered cirrus.
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
