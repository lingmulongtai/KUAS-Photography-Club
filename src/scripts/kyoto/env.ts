import * as THREE from 'three';

/**
 * Uniforms shared by every material in the Kyoto scene.
 * Materials reference these same objects, so updating a value here updates the whole scene.
 */
export function createEnv() {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    /** glow color × amount */
    uGlow: { value: new THREE.Color() },
    /** direct sunlight color × intensity (0 below the horizon) */
    uSunLight: { value: new THREE.Color() },
    /** moonlight color × intensity */
    uMoonLight: { value: new THREE.Color() },
    uCloudLight: { value: new THREE.Color() },
    uStars: { value: 0 },
    /** street lights, 0..1 */
    uCity: { value: 0 },
    /** share of windows lit */
    uLit: { value: 0.3 },
    /** pink band opposite the sun at twilight */
    uVenus: { value: 0 },
    uFogDensity: { value: 0.0008 },
  };
}

export type Env = ReturnType<typeof createEnv>;

/** Hash, value noise and fbm. */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float a = .5, s = 0.;
  mat2 r = mat2(.8, -.6, .6, .8);
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= .5; }
  return s;
}
`;

/** GLSL declarations for the shared uniforms plus noise, sky and fog helpers. */
export const ENV_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunLight;
uniform vec3 uMoonLight;
uniform vec3 uCloudLight;
uniform float uStars;
uniform float uCity;
uniform float uLit;
uniform float uVenus;
uniform float uFogDensity;

${NOISE_GLSL}
/* Analytic sky radiance (linear) for a view direction. Shared by the dome, fog and water. */
vec3 skyColor(vec3 dir){
  float h = max(dir.y, 0.);
  vec3 c = mix(uHorizon, uMid, smoothstep(0., .14, h));
  c = mix(c, uZenith, smoothstep(.1, .55, h));

  vec2 sh = normalize(uSunDir.xz + 1e-5);
  vec2 dh = normalize(dir.xz + 1e-5);
  float toward = dot(dh, sh) * .5 + .5;
  float band = exp(-h * 11.);
  c *= .78 + .22 * toward;
  c += uGlow * band * pow(toward, 4.) * .45;

  // Belt of Venus over Earth's shadow, opposite the sun at twilight
  float anti = pow(1. - toward, 2.);
  c += vec3(.55, .22, .3) * uVenus * anti * exp(-pow((h - .13) / .07, 2.)) * .12;
  c *= 1. - .3 * uVenus * anti * smoothstep(.09, 0., h);

  float cosA = dot(dir, uSunDir);
  c += uGlow * (pow(max(cosA, 0.), 12.) * .35 + pow(max(cosA, 0.), 300.) * .6);

  // city light pollution on the horizon at night
  c += vec3(.012, .0055, .0022) * uCity * exp(-h * 16.);
  return c;
}

vec3 fogColor(vec3 dir){
  return skyColor(normalize(vec3(dir.x, .05, dir.z))) * .9;
}

/* lit: reflected light, emit: self-lit (windows, lamps). Lights carry further through haze than reflected light. */
vec3 applyFog(vec3 lit, vec3 emit, vec3 worldPos){
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float f = 1. - exp(-dist * uFogDensity);
  return mix(lit, fogColor(dir), f) + emit * exp(-dist * uFogDensity * .55);
}

/* Diffuse lighting from sun, moon, sky dome and ground bounce. */
vec3 shade(vec3 albedo, vec3 n){
  float sun = max(dot(n, uSunDir), 0.);
  float moon = max(dot(n, uMoonDir), 0.);
  vec3 sky = (mix(uZenith, uMid, .45) * .55 + uHorizon * .08) * (.5 + .5 * n.y);
  vec3 ground = uHorizon * .05 * (.5 - .5 * n.y);
  return albedo * (uSunLight * sun + uMoonLight * moon + sky + ground);
}
`;
