import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';

/** PLATEAU districts whose GLBs carry a per-building `_FEATURE` seed (tools/kansai-data/build_osaka_surveys.py). */
export const SURVEY_DISTRICTS = new Set(['umeda-sky-district', 'osaka-station-district']);

/**
 * Surveyed geometry with either its aerial photograph or, where the survey has none, a
 * facade drawn from the building's own seed: curtain wall or punched windows, a cladding
 * tone, floor and bay rhythm, and the same window lighting as the rest of the city at night.
 */
export function surveyFacadeMaterial(source: THREE.MeshStandardMaterial, env: Env, groundY: number) {
  const map = source.map;
  if (map) map.anisotropy = 4;
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    defines: { ...(map && { SURVEY_PHOTO: 1 }) },
    uniforms: { ...env, uPhoto: { value: map }, uGroundY: { value: groundY } },
    vertexShader: /* glsl */ `
      attribute float _feature;
      varying vec2 vUv;
      varying vec3 vWorld, vNormal;
      varying float vSeed;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = mat3(modelMatrix) * normal;
        vUv = uv;
        vSeed = _feature;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      uniform sampler2D uPhoto;
      uniform float uGroundY;
      varying vec2 vUv;
      varying vec3 vWorld, vNormal;
      varying float vSeed;
      void main(){
        // Survey walls are faceted per polygon; light a flat wall with one normal.
        vec3 face = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1. : -1.);
        n = normalize(mix(face * sign(dot(face, n) + 1e-4), n, smoothstep(.2, .5, abs(face.y))));
        float vertical = 1. - n.y * n.y;
        float height = vWorld.y - uGroundY;
        vec3 eye = normalize(cameraPosition - vWorld);
        float fresnel = pow(1. - clamp(dot(eye, n), 0., 1.), 4.);
        // Window grid in metres along the wall, by floor.
        float along = abs(n.z) >= abs(n.x) ? vWorld.x : vWorld.z;
        float floorH = mix(3.6, 4.3, fract(vSeed * 13.7));
        float bay = mix(1.5, 3.4, fract(vSeed * 7.31));
        vec2 rooms = vec2(along / bay, height / floorH);
        vec2 pixel = max(fwidth(rooms), vec2(.001));
        vec2 inset = .5 - abs(fract(rooms) - .5);
        float detail = 1. - smoothstep(.25, .7, max(pixel.x, pixel.y));
        vec3 light = vec3(0.);
        vec3 base;
        float pane;
        #ifdef SURVEY_PHOTO
          base = texture2D(uPhoto, vUv).rgb;
          float chroma = (base.b - base.r) / max(base.b + base.r, .08);
          pane = vertical * smoothstep(.035, .22, chroma);
        #else
          // Three families: glass curtain walls, light stone/tile with punched windows, and
          // dark metal panels. Roofs are plant decks in grey concrete.
          float family = fract(vSeed * 3.17);
          vec3 glass = mix(vec3(.055, .085, .11), vec3(.09, .12, .13), fract(vSeed * 5.9));
          vec3 clad = family < .42 ? mix(vec3(.30, .32, .34), vec3(.38, .37, .34), fract(vSeed * 9.1))
                    : family < .82 ? mix(vec3(.42, .40, .36), vec3(.52, .50, .46), fract(vSeed * 4.3))
                    : vec3(.16, .17, .18);
          float glassShare = family < .42 ? .82 : family < .82 ? .46 : .6;
          vec2 open = vec2(glassShare, .62 + .2 * fract(vSeed * 2.7));
          vec2 edge = .5 * (1. - open);
          vec2 win = smoothstep(edge - .5 * pixel, edge + .5 * pixel, inset);
          float window = win.x * win.y * step(1.2, height);
          // A pixel wider than a bay sees the wall's average.
          window = mix(open.x * open.y, window, detail);
          pane = vertical * window;
          base = mix(clad, glass, pane);
          float roof = smoothstep(.55, .8, n.y);
          float grain = mix(.5, vnoise(vWorld.xz * .35), detail);
          base = mix(base, vec3(.25, .25, .24) * (.85 + .3 * grain), roof);
        #endif
        float reflectance = .05 + .5 * fresnel;
        light += skyColor(reflect(-eye, n)) * pane * reflectance;
        if (uCity > .001) {
          float occupancy = .2 + .45 * uLit;
          float lit = step(hash12(floor(rooms) + vec2(vSeed * 97., 3.)), occupancy);
          float groupLit = step(hash12(floor(rooms / vec2(4., 2.)) + vSeed * 41.), occupancy * .6);
          float on = mix(groupLit, lit, detail);
          on = mix(on, occupancy * .25, 1. - detail);
          float levels = smoothstep(1., 4., height);
          light += cityWindowRadiance(.34, false) * on * pane * levels;
          // Lobbies and street fronts glow along the ground floors.
          light += uCity * vertical * exp(-max(height - 3., 0.) / 7.) * (.1 + base) * vec3(.05, .036, .024);
        }
        vec3 col = shade(seasonalSurface(base, n, vWorld), n, vWorld, sunShadow(vWorld, n));
        gl_FragColor = vec4(applyHaze(col * (1. - pane * .35), light, vWorld), 1.);
      }`,
  });
}
