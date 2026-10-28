import * as THREE from 'three';

/**
 * Uniforms shared by every material in the hero scene.
 * Materials reference these same objects, so updating a value here updates the whole scene.
 */
export function createEnv() {
  return {
    uTime: { value: 0 },
    uSpring:{value:0},uAutumn:{value:0},uSnow:{value:0},
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
    /** sun shadow map (see shadow.ts): a depth texture sampled with hardware comparison */
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowTexel: { value: new THREE.Vector2(1 / 4096, 1 / 4096) },
    /** size of one shadow texel in metres, for the normal offset */
    uShadowWorld: { value: 4 },
    uShadowBias: { value: 0.0002 },
    /** campus highlight, 0..1, and where the campus is */
    uHighlight: { value: 0 },
    uCampus: { value: new THREE.Vector2() },
    /** 1 while the detailed campus model stands in for the plain blocks */
    uCampusDetail: { value: 0 },
    /** building footprints for ambient occlusion (see building-occlusion.ts) */
    uBuilt: { value: null as THREE.Texture | null },
    uBuiltBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBuiltOn: { value: 0 },
    /** metres per texel of uBuilt */
    uBuiltTexel: { value: 8 },
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
uniform float uSpring;
uniform float uAutumn;
uniform float uSnow;
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
uniform float uHighlight;
uniform vec2 uCampus;
uniform float uCampusDetail;

#include <packing>
${NOISE_GLSL}

/* Analytic sky radiance (linear) for a view direction. Shared by the dome, haze and water. */
vec3 skyColor(vec3 dir){
  float h = max(dir.y, 0.);
  vec3 c = mix(uHorizon, uMid, smoothstep(0., .14, h));
  c = mix(c, uZenith, smoothstep(.1, .55, h));

  vec2 sh = normalize(uSunDir.xz + 1e-5);
  vec2 dh = normalize(dir.xz + 1e-5);
  float toward = clamp(dot(dh, sh) * .5 + .5, 0., 1.);
  float band = exp(-h * 11.);
  c *= .78 + .22 * toward;
  c += uGlow * band * pow(toward, 4.) * .45;

  // Belt of Venus over Earth's shadow, opposite the sun at twilight
  // (pow() of a negative number is undefined in GLSL and turns into NaN on many GPUs: square by hand)
  float anti = (1. - toward) * (1. - toward);
  float belt = (h - .13) / .07;
  c += vec3(.55, .22, .3) * uVenus * anti * exp(-belt * belt) * .12;
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
  // Leave nearby streets clear; very distant, less detailed mountains fade into the sky.
  float farHaze = smoothstep(16000., 40000., dist) * .2;
  return exp(-tau) * (1. - farHaze);
}

/* Slow atmospheric scintillation: nearby lights stay quiet, distant neighbourhoods breathe.
 * Use only on static city emission, never car lights. uTime freezes with reduced motion. */
float cityLightShimmer(vec3 wp){
  float distant=smoothstep(900.,6000.,length(wp-cameraPosition));
  float wave=.65*sin(uTime*.55+wp.x*.013+wp.z*.009)
            +.35*sin(uTime*.91-wp.x*.017+wp.z*.011);
  return 1.+(.012+.09*distant)*wave;
}

/* lit: reflected light, emit: self-lit (windows, lamps). */
vec3 applyHaze(vec3 lit, vec3 emit, vec3 wp){
  float tr = hazeTransmittance(wp);
  vec3 dir = normalize(wp - cameraPosition);
  return mix(hazeColor(dir), lit, tr) + emit * mix(tr, 1., .35);
}

/* Sky light reaching a surface facing n. */
vec3 skyLight(vec3 n){
  vec3 up = mix(uZenith, uMid, .45) * .6 + uHorizon * .12;
  vec3 side = uHorizon * .35 + uMid * .15;
  vec3 c = mix(side, up, clamp(n.y, 0., 1.));
  // Lift reflected night light without increasing window/lamp emission or the exposure.
  return c * (.6 + .4 * n.y) * (1. + .18 * uCity) + vec3(.012, .007, .004) * uCity * (1. - n.y);
}

/* Diffuse lighting from sun (with shadows), moon, sky dome and ground bounce. */
vec3 shade(vec3 albedo, vec3 n, vec3 wp, float sh){
  float sun = max(dot(n, uSunDir), 0.) * sh;
  float moon = max(dot(n, uMoonDir), 0.);
  vec3 bounce = (uSunLight * max(uSunDir.y, 0.) * .06 + uHorizon * .04) * (.5 - .5 * n.y);
  return albedo * (uSunLight * sun + uMoonLight * moon + skyLight(n) + bounce);
}

/* A light dusting on upward-facing surfaces, strongest in the higher hills. */
vec3 seasonalSurface(vec3 albedo,vec3 n,vec3 wp){
  float cover=uSnow*smoothstep(.4,.85,n.y)*(.3+.7*smoothstep(100.,550.,wp.y));
  return mix(albedo,vec3(.67,.72,.76),cover*(.75+.25*vnoise(wp.xz*.025)));
}
`;

/**
 * Sun shadows, for fragment shaders only. Include after ENV_GLSL.
 * sunShadow() takes screen-space derivatives, so call it from uniform control flow
 * (not inside an if that depends on the fragment).
 */
export const SHADOW_GLSL = /* glsl */ `
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform float uShadowWorld;
uniform float uShadowBias;

/*
 * 1 = in sunlight, 0 = in shadow. Nine hardware-filtered depth comparisons spread over the
 * patch of shadow map this pixel covers: up close that is a soft 3x3 filter, far away it
 * averages the many shadow texels inside one pixel instead of picking one at random, which
 * is what made distant rooftops sparkle whenever the camera moved.
 */
float sunShadow(vec3 wp, vec3 n){
  vec3 dx = dFdx(wp);
  vec3 dy = dFdy(wp);
  if (uShadowOn < .5) return 1.;
  vec4 sc = uShadowMatrix * vec4(wp + n * uShadowWorld * 1.5, 1.);
  vec3 p = sc.xyz / sc.w * .5 + .5;
  if (p.x <= 0. || p.x >= 1. || p.y <= 0. || p.y >= 1. || p.z >= 1.) return 1.;
  // the pixel's footprint on the shadow map (the sun's camera is orthographic), at least a texel
  vec2 ax = (uShadowMatrix * vec4(dx, 0.)).xy * .5;
  vec2 ay = (uShadowMatrix * vec4(dy, 0.)).xy * .5;
  float t = uShadowTexel.x;
  float lx = length(ax), ly = length(ay);
  ax *= clamp(lx, t, t * 12.) / max(lx, 1e-7);
  ay *= clamp(ly, t, t * 12.) / max(ly, 1e-7);
  float z = p.z - uShadowBias;
  // Explicit taps avoid ANGLE's divergent-loop gradient path for shadow samplers.
  ax *= .45; ay *= .45;
  float s = textureLod(uShadowMap,vec3(p.xy-ax-ay,z),0.)
    + textureLod(uShadowMap,vec3(p.xy-ax,z),0.)
    + textureLod(uShadowMap,vec3(p.xy-ax+ay,z),0.)
    + textureLod(uShadowMap,vec3(p.xy-ay,z),0.)
    + textureLod(uShadowMap,vec3(p.xy,z),0.)
    + textureLod(uShadowMap,vec3(p.xy+ay,z),0.)
    + textureLod(uShadowMap,vec3(p.xy+ax-ay,z),0.)
    + textureLod(uShadowMap,vec3(p.xy+ax,z),0.)
    + textureLod(uShadowMap,vec3(p.xy+ax+ay,z),0.);
  return s / 9.;
}
`;
