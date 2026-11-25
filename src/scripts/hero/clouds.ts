import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { cloudWeather, LOWEST_CLOUD_BASE } from './cloud-weather';
import { CLOUD_COLUMN_LOOKUP, createCloudColumns, WEATHER_SCALE } from './cloud-columns.ts';
import { cloudNoiseTexture } from './cloud-noise.ts';
import type { Climate } from './seasons';
import { CIRRUS_Y, HIGH_CLOUD_GLSL } from './high-clouds.ts';

/** Clouds fade out into the haze before this distance. */
const FAR = 44000;
/** Radius of the drum the clouds are drawn on: beyond FAR and distant mountains, inside the camera's far plane. */
const DRUM = 115000;

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
        // Tileable 3D Perlin-Worley scale: bold buoyant cauliflower billows on towering nyudogumo.
        bool tower = isStyle(3.) || isStyle(4.);
        float invCell = isStyle(4.) ? .00062 : isStyle(3.) ? .00076 : isStyle(2.) || isStyle(5.) ? .00084 : .00096;
        vec3 p = pos - vec3(uWind.x, 0., uWind.y) / K;
        float yScale = tower ? .88 : 1.24;
        return vec3(p.x, p.y * yScale, p.z) * invCell;
      }

      /** Macro cloud envelope from the 2D weather column map and vertical profile (0..1). */
      float coarse(vec3 pos){
        float h = (pos.y - uBase) / (uTop - uBase);
        if (h <= 0. || h >= 1.) return 0.;
        bool tower = isStyle(3.) || isStyle(4.);
        vec2 xz = pos.xz;
        if (tower){
          // Towering summer thunderheads lean and bulge into stacked overhanging cauliflower lobes.
          vec3 pShift = pos - vec3(uWind.x, 0., uWind.y) / K;
          vec3 w0 = textureLod(uCloudNoise, pShift * .00018, 0.).rgb - .5;
          vec3 w1 = textureLod(uCloudNoise, pShift * .00048 + vec3(.31, .17, .73), 0.).rgb - .5;
          xz += (w0.xz * .18 + w1.xz * .07) * (uTop - uBase) * smoothstep(.05, .85, h);
        }
        vec3 column = lookupColumn(xz * K - uWind + uOffset);
        float topH = column.r;
        float cov = column.g;
        if (topH <= .001 || cov <= .001) return 0.;
        // Flat convective base and soft rounded cauliflower crown; strictly zero at h = 0 and h = topH
        // so emptyColumnRun acceleration remains conservative.
        float baseSoft = tower ? .065 : mix(.16, .07, cov);
        float baseGrad = smoothstep(0., baseSoft, h);
        float topGrad = 1. - smoothstep(topH * (tower ? .54 : .64), topH, h);
        // Gentle mid-upper tapering keeps towers stacked in rounded tiers instead of sheer vertical slabs.
        float tierShape = tower ? mix(1.0, .86, smoothstep(.22, .85, h)) : 1.0;
        float env = baseGrad * topGrad * cov * tierShape;
        if (isStyle(4.)){
          // Spreading fibrous anvil shelf crowning the tallest midsummer thunderheads.
          float anvil = smoothstep(.76, .86, h) * (1. - smoothstep(.93, 1., h)) * column.b * .74;
          env = max(env, anvil);
        }
        return env;
      }

      /** Full 3D volumetric cloud density with multi-scale cauliflower billows & frothy wisps. */
      float density(vec3 pos, float dist, float env){
        if (env <= .001) return 0.;
        bool tower = isStyle(3.) || isStyle(4.);
        float h = clamp((pos.y - uBase) / (uTop - uBase), 0., 1.);
        vec3 q = cloudCoord(pos);
        vec4 baseN = textureLod(uCloudNoise, q, 0.);
        float fbmLow = baseN.g * .625 + baseN.b * .25 + baseN.a * .125;
        // Perlin-Worley base shape forms bold cauliflower heads and deep sculptural crevices.
        float shape = clamp(remap(baseN.r, -(1. - fbmLow) * (tower ? .78 : .65), 1., 0., 1.), 0., 1.);
        float boost = tower ? 1.04 : 1.18;
        float d = clamp(remap(shape, 1. - min(1., env * boost), 1., 0., 1.), 0., 1.) * mix(.62, 1.0, env);
        if (d <= .0005) return 0.;

        // Keep cauliflower sub-lobes crisp even on distant 15-30 km summer thunderheads over the mountains.
        float detailFade = 1. - smoothstep(tower ? 18000. : 9000., tower ? 38000. : 24000., dist);
        if (detailFade > .001){
          vec3 curl = (baseN.gbr - .5) * (tower ? .32 : .26);
          vec4 hiN = textureLod(uCloudNoise, q * (tower ? 2.45 : 2.75) + curl + vec3(0., h * .18, 0.), 0.);
          float hiFbm = hiN.g * .625 + hiN.b * .25 + hiN.a * .125;
          float hiMod = mix(hiFbm, 1. - hiFbm, smoothstep(.04, .24, h));
          float edgeMask = 1. - d * (tower ? .36 : .48);
          float erodeStrength = (isStyle(4.) ? .66 : isStyle(3.) ? .62 : isStyle(5.) ? .36 : .52) * detailFade * edgeMask;
          d = clamp(remap(d, hiMod * erodeStrength, 1., 0., 1.), 0., 1.);

          // Close-up frothy turbulence (~20-50 m wisps) prevents smooth clay-like surfaces.
          #if DETAIL > 1
          float closeFade = 1. - smoothstep(tower ? 8000. : 3800., tower ? 20000. : 10500., dist);
          if (closeFade > .001 && d > .001){
            vec4 fineN = textureLod(uCloudNoise, q * 6.8 + curl * 2.0 + hiN.rgb * .16, 0.);
            float fineFbm = fineN.g * .55 + fineN.b * .30 + fineN.a * .15;
            float wispErode = (1. - fineFbm) * .44 * closeFade * (1. - d * .50);
            d = clamp(remap(d, wispErode, 1., 0., 1.), 0., 1.);
          }
          #endif
        }
        // Soft frothy edge feathering with dense sunlit upper interiors.
        float densityProfile = mix(.70, 1.24, smoothstep(.05, .42, h));
        return clamp(pow(d, 1.15) * densityProfile, 0., 1.);
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
          bool tower = isStyle(3.) || isStyle(4.);
          float qualityScale = ${detail > 1 ? '1.0' : '1.45'};
          float nearStep = isStyle(4.) ? 16. : isStyle(3.) ? 13. : 9.5;
          float farStep = isStyle(4.) ? 68. : isStyle(3.) ? 62. : 58.;
          // Keep empty-air skipping fast enough to span 44 km without ever coarsening in-cloud fine steps.
          float minEmptyStep = (t1 - t0) / (tower ? 78. : 96.);
          float verticalCap = layerDepth / (float(uMarchSteps) * max(abs(rd.y), .14));
          float jitter = ign(gl_FragCoord.xy);
          float firstStep = min(mix(nearStep, farStep, smoothstep(600., 32000., t0)) * qualityScale, verticalCap);
          float t = t0 + jitter * firstStep;
          float nextBlock = t0;
          bool useCeilings = uColumnsReady && !tower;
          bool fineMode = false;
          float fineUntil = 0.;
          int emptyFine = 0;
          int fineCount = 0;
          float extinction = isStyle(5.) ? .024 : isStyle(4.) ? .026 : isStyle(3.) ? .030 : .036;
          float ls = isStyle(4.) ? 2.4 : isStyle(3.) ? 1.55 : 1.0;

          float emptyStride = useCeilings ? 2.6 : 3.2;
          #if DETAIL > 1
          const int MAX_ITERS = 240;
          #else
          const int MAX_ITERS = 160;
          #endif

          // Dynamic-bound copies of fixed iteration counts prevent D3D11 FXC from unrolling
          // 6+ full copies of coarse() inside the raymarch loop while executing identical steps.
          int bisectSteps = min(uMarchSteps, 2);
          int sunSteps = min(uMarchSteps, ${detail > 1 ? 4 : 3});
          for (int i = 0; i < MAX_ITERS; ++i) {
            if (T < .004 || t >= t1) break;
            if (useCeilings && !fineMode && t >= nextBlock) {
              float run;
              bool empty = emptyColumnRun(uColumnEye + rd.xz * t / outerColumnMetres, rd.xz,
                (ro.y + rd.y * t - uBase) / layerDepth, rd.y / layerDepth, t1 - t, run);
              nextBlock = t + run + .05;
              if (empty) {
                if (run >= t1 - t) break;
                float skipStep = min(mix(nearStep, farStep, smoothstep(600., 32000., t + run)) * qualityScale, verticalCap);
                t += run + jitter * skipStep * .65;
                continue;
              }
            }

            float baseFine = min(mix(nearStep, farStep, smoothstep(600., 32000., t)) * qualityScale, verticalCap);
            // Only relax fine step size on unusually long grazing rays so normal edges stay silky-smooth.
            float relax = 1. + max(0., float(fineCount - 75)) * .055;
            float fineStep = baseFine * relax;
            // Cap coarse empty steps by distance so thin near/mid anvil rims are never jumped over.
            float maxEmpty = mix(95., 340., smoothstep(2500., 24000., t)) * qualityScale;
            float dt = fineMode ? fineStep : min(maxEmpty, max(minEmptyStep, baseFine * emptyStride));
            dt = min(dt, t1 - t);
            if (dt <= .01) break;

            vec3 pos = ro + rd * (t + dt * .5);
            float envVal = coarse(pos);

            if (!fineMode) {
              if (envVal > .001) {
                // Bisect the hit bracket cheaply on coarse() so fine marching starts right on the cloud surface
                // and cannot drop back to coarse before crossing the confirmed hit.
                float tLo = max(t0, t - dt * .5);
                float tHi = t + dt * .5;
                for (int b = 0; b < bisectSteps; ++b) {
                  float mid = .5 * (tLo + tHi);
                  if (coarse(ro + rd * mid) > .001) tHi = mid; else tLo = mid;
                }
                t = tLo;
                fineUntil = tHi + fineStep;
                fineMode = true;
                emptyFine = 0;
                continue;
              }
              t += dt;
              continue;
            }
            fineCount++;

            if (envVal <= .001) {
              if (t >= fineUntil) {
                emptyFine++;
                if (emptyFine >= 2) fineMode = false;
              }
              t += dt;
              continue;
            }
            emptyFine = 0;
            float d = density(pos, t + dt * .5, envVal);
            if (d <= .0008) {
              t += dt;
              continue;
            }

            float h = clamp((pos.y - uBase) / layerDepth, 0., 1.);
            // Exponential sun-ray optical depth: dynamic loop bound keeps HLSL compact for fast D3D11 compilation.
            float od = 0.;
            #if DETAIL > 1
            const float sunDist[4] = float[4](22., 64., 145., 310.);
            const float sunW[4] = float[4](28., 58., 96., 180.);
            #else
            const float sunDist[3] = float[3](34., 110., 280.);
            const float sunW[3] = float[3](45., 95., 175.);
            #endif
            float sunBoost = tower ? 1.04 : 1.18;
            for (int s = 0; s < sunSteps; ++s) {
              vec3 sp = pos + uSunDir * (sunDist[s] * ls);
              float se = coarse(sp);
              if (se > .001) {
                float sd = se;
                if (s < sunSteps - 1) {
                  vec4 sn = textureLod(uCloudNoise, cloudCoord(sp), 0.);
                  float sfbm = sn.g * .625 + sn.b * .25 + sn.a * .125;
                  float ssh = clamp(remap(sn.r, -(1. - sfbm) * .72, 1., 0., 1.), 0., 1.);
                  sd = clamp(remap(ssh, 1. - min(1., se * sunBoost), 1., 0., 1.), 0., 1.) * mix(.62, 1.0, se);
                }
                od += sd * sunW[s];
              }
            }
            od *= ls * extinction * .95;

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
            float powder = mix(.64 + .36 * (1. - exp(-d * 5.0)), 1., .40 + .50 * max(mu, 0.));
            float towerBoost = isStyle(4.) ? 1.04 : isStyle(3.) ? .96 : isStyle(5.) ? .44 : .84;
            vec3 sun = uCloudLight * sunScatter * powder * towerBoost;

            // Ambient sky illumination: clean summer sky-blue shadow bellies vs dazzling sunlit white tops.
            float bellyFloor = (isStyle(3.) || isStyle(4.)) ? .40 : .36;
            float skyVis = mix(bellyFloor, 1.08, smoothstep(0., .70, h)) * mix(1.0, .78, clamp(d * 1.05, 0., 1.));
            vec3 skyTint = mix(mix(uHorizon, uZenith, .54), mix(uHorizon, uZenith, .74), h);
            vec3 sky = skyTint * skyVis * (1.06 - .54 * uCity) * (isStyle(5.) ? .74 : 1.0);
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
