import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import { ROAD_GLSL } from './roads';
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

/** Vertex positions of the warped grid centred on `center` (see buildTerrain). */
function terrainPositions(hf: Heightfield, center: { x: number; z: number }, segments: number) {
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
  return pos;
}

/**
 * One mesh for the whole basin on a warped grid: vertices pack tightly around the viewpoint
 * and spread out toward the far mountains. Beyond the data the last ring is pulled out 20 km
 * so the edge never shows against the sky. recenter() moves the dense part to a new viewpoint.
 */
export function buildTerrain(env: Env, hf: Heightfield, center: { x: number; z: number }, tex: TerrainTextures, segments = 640) {
  const n = segments + 1;
  const pos = terrainPositions(hf, center, segments);
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
    /** distance field of the streets and railways (see roads.ts) */
    uRoads: { value: null as THREE.Texture | null },
    uRoadBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRoadsOn: { value: 0 },
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
      ${SHADOW_GLSL}
      uniform sampler2D uAerialWide;
      uniform vec4 uAerialWideBox;
      uniform sampler2D uAerialCity;
      uniform vec4 uAerialCityBox;
      uniform float uCityOn;
      uniform sampler2D uNormalFar;
      uniform vec4 uNormalFarBox;
      uniform sampler2D uNormalNear;
      uniform vec4 uNormalNearBox;
      ${ROAD_GLSL}
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
        // ground covered by one pixel, in metres (the longer side of its footprint)
        float fp = max(length(dFdx(p)), length(dFdy(p)));

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
        float green = smoothstep(.0, .05, photo.g - max(photo.r, photo.b * .9)) * (1. - smoothstep(.05, .2, dot(photo, vec3(.33))));
        float near = 1. - smoothstep(600., 3500., dist);
        if (near > 0.){
          // each layer of canopy fades to its average once its blobs shrink below a few pixels
          float k1 = 1. - smoothstep(.2, .45, fp * .22);
          float k2 = 1. - smoothstep(.2, .45, fp * .55);
          float c1 = vnoise(p * .22);
          float c2 = vnoise(p * .55 + 7.);
          float canopy = mix(.5, c1, k1) * .65 + mix(.5, c2, k2) * .35;
          photo *= mix(1., .55 + .9 * canopy, green * near);
          vec2 g = vec2(vnoise(p * .22 + vec2(.6, 0.)) - c1, vnoise(p * .22 + vec2(0., .6)) - c1);
          n = normalize(n + vec3(-g.x, 0., -g.y) * 1.6 * green * near * k1);
        }

        // photos carry their own midday light: bring them down to something like albedo
        vec3 albedo = photo * .68 * mix(vec3(1.), vec3(1.07, 1., .9), green);
        albedo = mix(vec3(dot(albedo, vec3(.3, .55, .15))), albedo, .9);

        // ---- streets, from the distance field (roads.ts) ----
        // Edges are drawn over the width of a pixel, so they stay sharp up close and blend into
        // an even tone far away instead of shimmering. Thin markings fade by how much of the
        // pixel they would cover.
        Road rd = roadAt(p);
        float aa = max(fp * .6, .12);
        float onRoad = 1. - smoothstep(-aa, aa, rd.edge);
        float onAve = 1. - smoothstep(-aa, aa, rd.avenue);
        float walk = (1. - smoothstep(-aa, aa, rd.avenue - 3.2)) * (1. - onAve);
        float onRail = 1. - smoothstep(-aa, aa, rd.rail);
        float fine = 1. - smoothstep(.6, 2.5, fp);
        // asphalt, a touch lighter and patched on the avenues
        float patchy = mix(.5, vnoise(p * .07), 1. - smoothstep(4., 12., fp));
        vec3 asphalt = vec3(.085, .088, .094) * (.85 + .3 * patchy);
        asphalt = mix(asphalt, asphalt * 1.25, onAve);
        // markings on the avenues: a centre line, dashed lane lines, a line along each kerb
        float halfW = max(rd.centre - rd.avenue, 1.);
        vec2 e = vec2(1.5, 0.);
        vec2 grad = vec2(roadAt(p + e.xy).centre - roadAt(p - e.xy).centre, roadAt(p + e.yx).centre - roadAt(p - e.yx).centre);
        vec2 along = normalize(vec2(-grad.y, grad.x) + 1e-5);
        // one direction per road (the gradient flips sign across the centre line), snapped to
        // Kyoto's north-south / east-west grid so the phase of dashes and lamps holds through junctions
        if (along.x < 0. || (abs(along.x) < 1e-4 && along.y < 0.)) along = -along;
        if (abs(along.x) > .985) along = vec2(1., 0.);
        else if (abs(along.y) > .985) along = vec2(0., 1.);
        // the distance to the centre line changes evenly across a straight road: where it
        // doesn't (junctions, bends) the lane dashes would scribble, so leave them out
        float straight = smoothstep(.75, .95, length(grad) / 3.);
        float s = dot(p, along);
        // where the road bends sharply (bus terminals, junctions) s sweeps round faster than the
        // ground under the pixel: leave dashes and lamp pools out there
        straight *= 1. - smoothstep(1.6, 3., fwidth(s) / max(fp, .05));
        float dash = smoothstep(.45, .5, fract(s / 10.)) * (1. - smoothstep(.95, 1., fract(s / 10.)));
        float lane = abs(fract(rd.centre / 3.4 + .5) - .5) * 3.4;
        float mark = 0.;
        mark += 1. - smoothstep(.12 - aa, .12 + aa, rd.centre);
        mark += (1. - smoothstep(.08 - aa, .08 + aa, lane)) * dash * straight * step(2.5, rd.centre) * step(rd.centre, halfW - 2.);
        mark += 1. - smoothstep(.08 - aa, .08 + aa, abs(rd.avenue + .7));
        mark = clamp(mark, 0., 1.) * onAve * fine * min(1., .25 / aa);
        vec3 street = mix(asphalt, vec3(.5, .5, .48), mark);
        albedo = mix(albedo, vec3(.27, .26, .24) * (.9 + .2 * patchy), walk * .85);
        albedo = mix(albedo, street, onRoad * .93);
        // railway ballast
        albedo = mix(albedo, vec3(.16, .145, .13), onRail * .9);

        float sh = sunShadow(vWorld, n);
        vec3 col = shade(albedo, n, vWorld, sh);

        vec3 emit = vec3(0.);
        if (uCity > .01){
          // street lighting: a dim warm wash on the side streets; on the avenues, pools of
          // light under lamps every 28 m along each kerb (their average from far away)
          float inKerb = max(-rd.avenue, 0.);
          float ph = fract(s / 28.) - .5;
          float pool = exp(-inKerb * inKerb / 14.) * exp(-ph * ph * 40.);
          pool = mix(.3, pool * 1.7, (1. - smoothstep(3., 9., fp)) * straight);
          emit += vec3(1., .66, .36) * .03 * (onRoad - onAve * onRoad);
          emit += vec3(1., .84, .62) * onAve * (.012 + .1 * pool) * (1. + mark * .6);
          emit += vec3(1., .85, .66) * walk * (.01 + .05 * pool);
          // from far away the avenues read as lines of light with a little haze around them
          float halo = smoothstep(900., 4000., dist);
          emit += vec3(1., .74, .46) * exp(-max(rd.avenue, 0.) / 14.) * (1. - smoothstep(16., 30., rd.avenue)) * halo * .18;
          emit *= uCity;
        }
        // a teal ring that pulses around the campus when it is in focus
        if (uHighlight > 0.){
          float d = length(p - uCampus);
          float wave = mod(uTime * 40., 160.);
          float r0 = (d - 175.) / 3.5;
          float r1 = (d - 175. - wave) / 6.;
          float ring = exp(-r0 * r0) + .5 * exp(-r1 * r1) * (1. - wave / 160.);
          emit += vec3(.39, .86, .9) * ring * uHighlight * 2.5;
        }
        gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  // positions for other viewpoints, worked out ahead of time so switching doesn't stall a frame
  const cache = new Map<string, Float32Array>([[`${center.x},${center.z}`, pos]]);
  const prepare = (c: { x: number; z: number }) => {
    const key = `${c.x},${c.z}`;
    if (!cache.has(key)) cache.set(key, terrainPositions(hf, c, segments));
    return cache.get(key)!;
  };
  const recenter = (c: { x: number; z: number }) => {
    geo.setAttribute('position', new THREE.BufferAttribute(prepare(c), 3));
  };
  return { mesh, uniforms, recenter, prepare };
}
