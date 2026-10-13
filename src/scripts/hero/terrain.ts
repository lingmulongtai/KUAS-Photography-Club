import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Box } from './geo';
import type { Heightfield } from './heightfield';
import type { GridMeta } from './data';

/**
 * A normal map baked from an elevation grid, so slopes are lit per pixel no matter how coarse
 * the mesh is out at the far mountains. RGB = normal * 0.5 + 0.5 with y up.
 */
export function normalTexture(hf: Heightfield, meta: GridMeta) {
  const { box, step, nx, nz } = meta;
  const data = new Uint8Array(nx * nz * 4);
  const n = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      hf.normal(box[0] + i * step, box[1] + j * step, step, n);
      const o = (j * nx + i) * 4;
      data[o] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface TerrainTextures {
  aerialWide: THREE.Texture;
  aerialWideBox: Box;
  aerialCity: THREE.Texture | null;
  aerialCityBox: Box;
  normalFar: THREE.Texture;
  normalFarBox: Box;
  normalNear: THREE.Texture;
  normalNearBox: Box;
}

const v4 = (b: Box) => new THREE.Vector4(b[0], b[1], b[2], b[3]);

/**
 * One mesh for the whole basin on a warped grid: vertices pack tightly around the viewpoint
 * and spread out toward the far mountains. Beyond the data the last ring is pulled out 20 km
 * so the edge never shows against the sky.
 */
export function buildTerrain(env: Env, hf: Heightfield, center: { x: number; z: number }, tex: TerrainTextures, segments = 640) {
  const [minX, minZ, maxX, maxZ] = hf.bounds;
  const n = segments + 1;
  const p = 2.1;
  const warp = (u: number, c: number, lo: number, hi: number) => {
    const s = Math.pow(Math.abs(u), p);
    return u < 0 ? c - (c - lo) * s : c + (hi - c) * s;
  };
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    const v = (j / segments) * 2 - 1;
    let z = warp(v, center.z, minZ, maxZ);
    if (j === 0) z -= 20000;
    if (j === segments) z += 20000;
    for (let i = 0; i < n; i++) {
      const u = (i / segments) * 2 - 1;
      let x = warp(u, center.x, minX, maxX);
      if (i === 0) x -= 20000;
      if (i === segments) x += 20000;
      const k = (j * n + i) * 3;
      const cx = Math.min(Math.max(x, minX), maxX);
      const cz = Math.min(Math.max(z, minZ), maxZ);
      pos[k] = x;
      pos[k + 1] = hf.height(cx, cz) - (cx !== x || cz !== z ? 60 : 0);
      pos[k + 2] = z;
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let q = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], q);
      q += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const uniforms = {
    ...env,
    uAerialWide: { value: tex.aerialWide },
    uAerialWideBox: { value: v4(tex.aerialWideBox) },
    uAerialCity: { value: tex.aerialCity ?? tex.aerialWide },
    uAerialCityBox: { value: v4(tex.aerialCityBox) },
    uCityOn: { value: tex.aerialCity ? 1 : 0 },
    uNormalFar: { value: tex.normalFar },
    uNormalFarBox: { value: v4(tex.normalFarBox) },
    uNormalNear: { value: tex.normalNear },
    uNormalNearBox: { value: v4(tex.normalNearBox) },
    /** night road glow painted from the road network (see lights.ts) */
    uRoadGlow: { value: null as THREE.Texture | null },
    uRoadBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
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
      uniform sampler2D uAerialWide;
      uniform vec4 uAerialWideBox;
      uniform sampler2D uAerialCity;
      uniform vec4 uAerialCityBox;
      uniform float uCityOn;
      uniform sampler2D uNormalFar;
      uniform vec4 uNormalFarBox;
      uniform sampler2D uNormalNear;
      uniform vec4 uNormalNearBox;
      uniform sampler2D uRoadGlow;
      uniform vec4 uRoadBox;
      varying vec3 vWorld;

      vec2 boxUv(vec4 b, vec2 p){ return (p - b.xy) / (b.zw - b.xy); }
      // 0 outside the box, rising to 1 within m metres of the edge
      float inside(vec4 b, vec2 p, float m){
        vec2 d = min(p - b.xy, b.zw - p);
        return smoothstep(0., m, min(d.x, d.y));
      }

      void main(){
        vec2 p = vWorld.xz;
        float dist = length(vWorld - cameraPosition);

        // slope from the elevation grids
        vec3 nf = texture2D(uNormalFar, boxUv(uNormalFarBox, p)).xyz * 2. - 1.;
        vec3 nn = texture2D(uNormalNear, boxUv(uNormalNearBox, p)).xyz * 2. - 1.;
        vec3 n = normalize(mix(nf, nn, inside(uNormalNearBox, p, 300.)));

        // aerial photo: the sharper city sheet where we have it
        vec2 uw = boxUv(uAerialWideBox, p);
        vec3 photo = texture2D(uAerialWide, vec2(uw.x, 1. - uw.y)).rgb;
        vec2 uc = boxUv(uAerialCityBox, p);
        vec3 city = texture2D(uAerialCity, vec2(uc.x, 1. - uc.y)).rgb;
        photo = mix(photo, city, inside(uAerialCityBox, p, 400.) * uCityOn);

        // forest: green and dark in the photo. Up close add canopy texture the photo can't resolve.
        float green = smoothstep(.0, .05, photo.g - max(photo.r, photo.b * .9)) * smoothstep(.2, .05, dot(photo, vec3(.33)));
        float near = 1. - smoothstep(600., 3500., dist);
        if (near > 0.){
          float c1 = vnoise(p * .22);
          float c2 = vnoise(p * .55 + 7.);
          float canopy = c1 * .65 + c2 * .35;
          photo *= mix(1., .55 + .9 * canopy, green * near);
          vec2 g = vec2(vnoise(p * .22 + vec2(.6, 0.)) - c1, vnoise(p * .22 + vec2(0., .6)) - c1);
          n = normalize(n + vec3(-g.x, 0., -g.y) * 1.6 * green * near);
        }

        // photos carry their own midday light: bring them down to something like albedo
        vec3 albedo = photo * .62;
        albedo = mix(vec3(dot(albedo, vec3(.3, .55, .15))), albedo, .85);

        float sh = 1.;
        if (dot(n, uSunDir) > 0.) sh = sunShadow(vWorld, n);
        vec3 col = shade(albedo, n, vWorld, sh);

        vec3 emit = vec3(0.);
        vec2 ur = boxUv(uRoadBox, p);
        if (uCity > .01 && ur.x > 0. && ur.x < 1. && ur.y > 0. && ur.y < 1.){
          vec2 glow = texture2D(uRoadGlow, vec2(ur.x, 1. - ur.y)).rg;
          // streets up close, plus their halo from far away
          float halo = smoothstep(900., 4000., dist);
          emit += vec3(1., .7, .42) * (glow.r * mix(.55, 1.1, halo) + glow.g * halo * .7) * uCity;
        }
        // a teal ring that pulses around the campus when it is in focus
        if (uHighlight > 0.){
          float d = length(p - uCampus);
          float ring = exp(-pow((d - 175.) / 3.5, 2.)) + .5 * exp(-pow((d - 175. - mod(uTime * 40., 160.)) / 6., 2.)) * (1. - mod(uTime * 40., 160.) / 160.);
          emit += vec3(.39, .86, .9) * ring * uHighlight * 2.5;
        }
        gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
