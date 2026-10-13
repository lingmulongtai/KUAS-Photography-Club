import * as THREE from 'three';

/**
 * Uniforms shared by every material in the hero scene.
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
    /** haze: density at the basin floor (1/m) and how fast it thins with height (1/m) */
    uFogDensity: { value: 4.5e-5 },
    uFogFalloff: { value: 1 / 420 },
    uFogBase: { value: 40 },
    /** sun shadow map (see shadow.ts) */
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowTexel: { value: new THREE.Vector2(1 / 4096, 1 / 4096) },
    /** size of one shadow texel in metres, for the normal offset */
    uShadowWorld: { value: 4 },
    uShadowBias: { value: 0.0002 },
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

/** GLSL declarations for the shared uniforms plus sky, haze, shadow and lighting helpers. */
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
uniform float uFogFalloff;
uniform float uFogBase;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform float uShadowWorld;
uniform float uShadowBias;

#include <packing>
${NOISE_GLSL}

/* Analytic sky radiance (linear) for a view direction. Shared by the dome, haze and water. */
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

  // the glow of the city lights on the haze above the basin at night
  c += vec3(.016, .009, .004) * uCity * exp(-h * 14.);
  return c;
}

/* Colour of the haze seen in a direction: the horizon sky, brighter toward the sun. */
vec3 hazeColor(vec3 dir){
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.) * .5 + .02, dir.z));
  // haze lit by the sky; at night it stays darker than the sky behind it so buildings keep their silhouettes
  vec3 c = skyColor(d) * mix(.92, .55, uCity);
  float cosA = max(dot(normalize(dir), uSunDir), 0.);
  c += uSunLight * pow(cosA, 8.) * .05;
  return c;
}

/* Transmittance through height-dependent haze between the camera and a point. */
float hazeTransmittance(vec3 wp){
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  float h0 = cameraPosition.y - uFogBase;
  float k = uFogFalloff * d.y;
  float shape = abs(k) > 1e-4 ? (1. - exp(-k)) / k : 1.;
  float tau = uFogDensity * exp(-uFogFalloff * h0) * dist * shape;
  return exp(-tau);
}

/* lit: reflected light, emit: self-lit (windows, lamps). */
vec3 applyHaze(vec3 lit, vec3 emit, vec3 wp){
  float tr = hazeTransmittance(wp);
  vec3 dir = normalize(wp - cameraPosition);
  return mix(hazeColor(dir), lit, tr) + emit * mix(tr, 1., .35);
}

/* 1 = in sunlight, 0 = in shadow (3x3 PCF on the sun's depth map). */
float sunShadow(vec3 wp, vec3 n){
  if (uShadowOn < .5) return 1.;
  vec4 sc = uShadowMatrix * vec4(wp + n * uShadowWorld * 1.5, 1.);
  vec3 p = sc.xyz / sc.w * .5 + .5;
  if (p.x <= 0. || p.x >= 1. || p.y <= 0. || p.y >= 1. || p.z >= 1.) return 1.;
  float s = 0.;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      s += step(p.z - uShadowBias, unpackRGBAToDepth(texture2D(uShadowMap, p.xy + vec2(float(i), float(j)) * uShadowTexel)));
  return s / 9.;
}

/* Sky light reaching a surface facing n. */
vec3 skyLight(vec3 n){
  vec3 up = mix(uZenith, uMid, .45) * .6 + uHorizon * .12;
  vec3 side = uHorizon * .35 + uMid * .15;
  vec3 c = mix(side, up, clamp(n.y, 0., 1.));
  return c * (.6 + .4 * n.y) + vec3(.012, .007, .004) * uCity * (1. - n.y);
}

/* Diffuse lighting from sun (with shadows), moon, sky dome and ground bounce. */
vec3 shade(vec3 albedo, vec3 n, vec3 wp, float sh){
  float sun = max(dot(n, uSunDir), 0.) * sh;
  float moon = max(dot(n, uMoonDir), 0.);
  vec3 bounce = (uSunLight * max(uSunDir.y, 0.) * .06 + uHorizon * .04) * (.5 - .5 * n.y);
  return albedo * (uSunLight * sun + uMoonLight * moon + skyLight(n) + bounce);
}
`;
