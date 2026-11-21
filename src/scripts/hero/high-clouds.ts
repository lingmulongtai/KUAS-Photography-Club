/** Upper-cloud lighting and shape, shared by direct rendering and the full-resolution composite. */
export const CIRRUS_Y = 8200;
const ALTO_Y = 4600;
export const HIGH_CLOUD_GLSL = /* glsl */ `
  uniform float uCirrus, uAlto;
  uniform vec2 uOffset, uWind;
  /** Henyey-Greenstein phase, times 4π so isotropic scattering is 1. */
  float hg(float mu, float g){
    float d = 1. + g * g - 2. * g * mu;
    return (1. - g * g) / (d * sqrt(d));
  }

  // High cloud cells share their exact corner values, even when a GPU optimizes
  // the arithmetic differently across the two sides of a distant cell boundary.
  float puffHash(ivec2 cell){
    uint h = uint(cell.x) * 0x9e3779b9u ^ uint(cell.y) * 0x85ebca6bu;
    h = (h ^ (h >> 16u)) * 0x7feb352du;
    h = (h ^ (h >> 15u)) * 0x846ca68bu;
    return float((h ^ (h >> 16u)) >> 8u) * (1. / 16777216.);
  }

  float puffNoise(vec2 p){
    ivec2 cell = ivec2(floor(p));
    vec2 f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(
      mix(puffHash(cell), puffHash(cell + ivec2(1, 0)), f.x),
      mix(puffHash(cell + ivec2(0, 1)), puffHash(cell + ivec2(1, 1)), f.x), f.y);
  }

  /** One of the thin high layers at height y, premultiplied colour + alpha. */
  vec4 highLayer(vec3 ro, vec3 rd, float y, bool cirrus){
    if (rd.y < .002 || ro.y > y || (cirrus ? uCirrus : uAlto) <= 0.) return vec4(0.);
    float t = (y - ro.y) / rd.y;
    vec3 pos = ro + rd * t;
    float dist = length(pos.xz - ro.xz);
    if (dist > 70000.) return vec4(0.);
    vec2 p = pos.xz * K * .6 - uWind * 1.6 + uOffset * 1.7;
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
      // Rotate the finer detail so its cell edges do not align with the larger puffs.
      vec2 detail = mat2(.8, .6, -.6, .8) * s;
      float puffs = puffNoise(s * vec2(48., 30.)) * .7 + puffNoise(detail * 110.) * .3;
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

  vec4 highClouds(vec3 ro, vec3 rd){
    vec4 alto = highLayer(ro, rd, ${ALTO_Y.toFixed(1)}, false);
    return alto + highLayer(ro, rd, ${CIRRUS_Y.toFixed(1)}, true) * (1. - alto.a);
  }
`;
