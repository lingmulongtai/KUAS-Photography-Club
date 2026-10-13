import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { AVENUES, CITY, LANDMARKS, RIVER_HALF_WIDTH, VIEW, heightAt, inRect, isRiver, riverX } from './layout';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Building kinds: wooden machiya, concrete mid-rise, pale tiled block. */
const MACHIYA = 0;
const MIDRISE = 1;
const PALE = 2;

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: number;
  /** roof ridge along x (true) or z (false); only for machiya */
  ridgeX: boolean;
}

const nearAvenue = (v: number, list: readonly number[], within: number) => list.some((a) => Math.abs(v - a) < within);

function districtOf(x: number, z: number) {
  if (Math.abs(x - 4) < 70 && z > 150 && z < 250) return 'station';
  if (x > -110 && x < 125 && z > -70 && z < 110) return 'downtown';
  return 'town';
}

function blockFree(x: number, z: number) {
  if (heightAt(x, z) > 0.25) return false;
  if (Math.abs(x - riverX(z)) < RIVER_HALF_WIDTH + 3.2) return false;
  if (inRect(x, z, LANDMARKS.gosho, 1)) return false;
  if (inRect(x, z, LANDMARKS.nijo, 1)) return false;
  if (Math.abs(x - LANDMARKS.kyotoStation.x) < 30 && Math.abs(z - LANDMARKS.kyotoStation.z) < 8) return false;
  if (Math.hypot(x - LANDMARKS.toji.x, z - LANDMARKS.toji.z) < 12) return false;
  return true;
}

function heightFor(kind: number, district: string, r: () => number, onAvenue: boolean) {
  if (kind === MACHIYA) return 0.6 + r() * 0.3;
  let h = 1.1 + r() * 1.4;
  if (onAvenue) h += 0.8 + r() * 0.9;
  if (district === 'downtown') h += r() * 0.8;
  if (district === 'station') h += 0.8 + r() * 1.5;
  return Math.min(h, district === 'station' ? 6 : 4.5);
}

/** Lay buildings along the edges of each block; far blocks get a few coarse volumes instead. */
export function planBuildings(quality: number): Building[] {
  const r = rng(20250521);
  const out: Building[] = [];
  const B = CITY.block;
  const cam = VIEW.camera;
  const detailRadius = 150 + 140 * quality;

  for (let bx = CITY.minX; bx < CITY.maxX; bx += B) {
    for (let bz = CITY.minZ; bz < CITY.maxZ; bz += B) {
      const cx = bx + B / 2;
      const cz = bz + B / 2;
      if (!blockFree(cx, cz)) continue;
      const district = districtOf(cx, cz);
      const dist = Math.hypot(cx - cam.x, cz - cam.z);
      const avNS = nearAvenue(bx, AVENUES.northSouth, 1) || nearAvenue(bx + B, AVENUES.northSouth, 1);
      const avEW = nearAvenue(bz, AVENUES.eastWest, 1) || nearAvenue(bz + B, AVENUES.eastWest, 1);
      const machiyaShare = district === 'town' ? 0.82 : district === 'downtown' ? 0.4 : 0.15;

      if (dist > detailRadius) {
        // coarse: four volumes per block
        for (let q = 0; q < 4; q++) {
          const kind = r() < machiyaShare * 0.7 ? MACHIYA : r() < 0.7 ? MIDRISE : PALE;
          const x = bx + (q % 2 ? 0.72 : 0.28) * B + (r() - 0.5);
          const z = bz + (q < 2 ? 0.28 : 0.72) * B + (r() - 0.5);
          out.push({ x, z, w: 3.8 + r() * 1.4, d: 3.8 + r() * 1.4, h: heightFor(kind, district, r, avNS || avEW) * (kind === MACHIYA ? 1.1 : 1), kind, ridgeX: r() < 0.5 });
        }
        continue;
      }

      const inset = 1.1;
      const span = B - inset * 2;
      // four edges: [startX, startZ, dirX, dirZ, outward normal is implied]
      const edges: [number, number, number, number, boolean][] = [
        [bx + inset, bz + inset, 1, 0, avEW && nearAvenue(bz, AVENUES.eastWest, 1)],
        [bx + inset, bz + B - inset, 1, 0, avEW && nearAvenue(bz + B, AVENUES.eastWest, 1)],
        [bx + inset, bz + inset, 0, 1, avNS && nearAvenue(bx, AVENUES.northSouth, 1)],
        [bx + B - inset, bz + inset, 0, 1, avNS && nearAvenue(bx + B, AVENUES.northSouth, 1)],
      ];
      edges.forEach(([sx, sz, dx, dz, onAvenue], e) => {
        let t = e >= 2 ? 1.9 : 0; // leave the corners to the x-edges
        const end = e >= 2 ? span - 1.9 : span;
        while (t < end) {
          const kind = onAvenue ? (r() < 0.75 ? MIDRISE : PALE) : r() < machiyaShare ? MACHIYA : r() < 0.6 ? MIDRISE : PALE;
          let w = kind === MACHIYA ? 0.75 + r() * 0.7 : 1.6 + r() * 2.2;
          w = Math.min(w, end - t);
          if (w < 0.5) break;
          const depth = kind === MACHIYA ? 2.6 + r() * 1.6 : 2 + r() * 2;
          const along = t + w / 2;
          // offset inward from the street
          const inward = (e === 1 || e === 3 ? -1 : 1) * depth / 2;
          const x = dx ? sx + along : sx + inward;
          const z = dz ? sz + along : sz + inward;
          const bw = dx ? w * 0.96 : depth;
          const bd = dz ? w * 0.96 : depth;
          if (!isRiver(x, z)) out.push({ x, z, w: bw, d: bd, h: heightFor(kind, district, r, onAvenue), kind, ridgeX: dx === 1 });
          t += w;
        }
      });
      // a few buildings inside larger downtown blocks
      if (district !== 'town' && r() < 0.6) {
        out.push({ x: cx + (r() - 0.5) * 2, z: cz + (r() - 0.5) * 2, w: 3 + r() * 2, d: 3 + r() * 2, h: heightFor(MIDRISE, district, r, false), kind: MIDRISE, ridgeX: true });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

const BUILDING_VS = /* glsl */ `
  attribute float aInfo;
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vN;
  varying float vInfo;
  void main(){
    vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.);
    vWorld = wp.xyz;
    vLocal = (position + vec3(.5, 0., .5)) * size;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vInfo = aInfo;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BUILDING_FS = /* glsl */ `
  ${ENV_GLSL}
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vN;
  varying float vInfo;
  void main(){
    float kind = floor(vInfo);
    float seed = fract(vInfo);
    vec3 n = normalize(vN);
    vec3 alb;
    if (kind < .5) alb = mix(vec3(.07, .05, .036), vec3(.12, .09, .065), seed);
    else if (kind < 1.5) alb = mix(vec3(.16, .15, .14), vec3(.27, .25, .22), seed);
    else alb = mix(vec3(.36, .35, .33), vec3(.5, .48, .45), seed);

    vec3 emit = vec3(0.);
    if (n.y < .5){
      vec2 fuv = abs(n.x) > .5 ? vec2(vLocal.z, vLocal.y) : vec2(vLocal.x, vLocal.y);
      bool machiya = kind < .5;
      vec2 cell = machiya ? vec2(.42, .31) : vec2(.29, .31 + .06 * seed);
      vec2 g = fuv / cell;
      vec2 id = floor(g);
      vec2 f = fract(g);
      float win = smoothstep(.1, .2, f.x) * smoothstep(.9, .8, f.x) * smoothstep(.2, .32, f.y) * smoothstep(.92, .8, f.y);
      if (machiya) win *= .7;
      float px = max(fwidth(g.x), fwidth(g.y));
      float detail = 1. - smoothstep(.35, .95, px);
      float r = hash13(vec3(id, seed * 91. + n.x * 7. + n.z * 13.));
      float lit = step(r, uLit * (machiya ? .75 : 1.15));
      float warm = step(.28, hash13(vec3(id + 3.1, seed * 17.)));
      vec3 wc = mix(vec3(.7, .82, 1.), vec3(1., .6, .28), warm);
      if (machiya) wc = vec3(1., .55, .22);
      float avg = .42 * uLit;
      float pattern = mix(avg, win * lit, detail);
      emit = wc * pattern * uCity * 2.4;
      alb = mix(alb, alb * .5 + vec3(.01, .012, .016), win * detail * .85);
      // shop fronts on the ground floor glow a little brighter
      if (!machiya && id.y < .5) emit += vec3(1., .78, .5) * win * detail * uCity * step(.4, r) * 1.6;
    } else {
      alb *= kind < .5 ? .6 : .85;
    }
    float ao = mix(.45, 1., smoothstep(0., .9, vLocal.y));
    vec3 col = shade(alb, n) * ao;
    gl_FragColor = vec4(applyFog(col, emit, vWorld), 1.);
  }
`;

const SIMPLE_FS = /* glsl */ `
  ${ENV_GLSL}
  uniform vec3 uAlbedo;
  uniform float uVary;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vSeed;
  void main(){
    vec3 n = normalize(vN);
    vec3 alb = uAlbedo * (1. - uVary * .5 + uVary * vSeed);
    gl_FragColor = vec4(applyFog(shade(alb, n), vec3(0.), vWorld), 1.);
  }
`;

const SIMPLE_VS = /* glsl */ `
  attribute float aSeed;
  uniform float uWobble;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vSeed;
  void main(){
    vec3 p = position;
    // lumpy canopy for trees
    p += normal * uWobble * (sin(p.x * 5.1 + aSeed * 40.) * sin(p.y * 4.3 + aSeed * 17.) * sin(p.z * 3.7));
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

function roofGeometry() {
  // gable roof, ridge along x, eaves overhanging, base at y=0
  const g = new THREE.BufferGeometry();
  const o = 0.5;
  const v = [
    // slope facing -z
    -o, 0, -o, o, 0, -o, o, 1, 0,
    -o, 0, -o, o, 1, 0, -o, 1, 0,
    // slope facing +z
    o, 0, o, -o, 0, o, -o, 1, 0,
    o, 0, o, -o, 1, 0, o, 1, 0,
    // gable ends
    -o, 0, o, -o, 0, -o, -o, 1, 0,
    o, 0, -o, o, 0, o, o, 1, 0,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function buildCity(env: Env, quality: number) {
  const group = new THREE.Group();
  const plan = planBuildings(quality);
  const r = rng(7);

  // buildings
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const bMat = new THREE.ShaderMaterial({ uniforms: { ...env }, vertexShader: BUILDING_VS, fragmentShader: BUILDING_FS });
  const buildings = new THREE.InstancedMesh(box, bMat, plan.length);
  const info = new Float32Array(plan.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  plan.forEach((b, i) => {
    m.compose(p.set(b.x, 0, b.z), q.identity(), s.set(b.w, b.h, b.d));
    buildings.setMatrixAt(i, m);
    info[i] = b.kind + Math.min(0.999, r());
  });
  box.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 1));
  buildings.computeBoundingSphere();
  group.add(buildings);

  // machiya roofs
  const houses = plan.filter((b) => b.kind === MACHIYA);
  const roofGeo = roofGeometry();
  const roofSeed = new Float32Array(houses.length);
  const roofMat = new THREE.ShaderMaterial({
    uniforms: { ...env, uAlbedo: { value: new THREE.Color(0.05, 0.053, 0.058) }, uVary: { value: 0.6 }, uWobble: { value: 0 } },
    vertexShader: SIMPLE_VS,
    fragmentShader: SIMPLE_FS,
    side: THREE.DoubleSide,
  });
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, houses.length);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  houses.forEach((b, i) => {
    const along = b.ridgeX ? b.w : b.d;
    const across = b.ridgeX ? b.d : b.w;
    m.compose(p.set(b.x, b.h, b.z), b.ridgeX ? q.identity() : yaw, s.set(along * 1.06, 0.32 + across * 0.05, across * 1.18));
    roofs.setMatrixAt(i, m);
    roofSeed[i] = r();
  });
  roofGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(roofSeed, 1));
  roofs.computeBoundingSphere();
  group.add(roofs);

  group.add(buildTrees(env, quality));
  group.add(buildStreetLights(env, quality));
  return { group, count: plan.length };
}

/* ---------- trees ---------- */

function buildTrees(env: Env, quality: number) {
  const r = rng(1192);
  const spots: [number, number, number][] = [];
  const add = (x: number, z: number, size: number) => spots.push([x, z, size]);
  const g = LANDMARKS.gosho;
  for (let i = 0; i < 700 * quality; i++) add(g.minX + r() * (g.maxX - g.minX), g.minZ + r() * (g.maxZ - g.minZ), 1 + r() * 1.4);
  const nj = LANDMARKS.nijo;
  for (let i = 0; i < 120 * quality; i++) add(nj.minX + r() * (nj.maxX - nj.minX), nj.minZ + r() * (nj.maxZ - nj.minZ), 0.8 + r());
  // cherry trees along the Kamo river banks
  for (let z = CITY.minZ; z < CITY.maxZ; z += 2.2 / quality) {
    const x = riverX(z);
    add(x - RIVER_HALF_WIDTH - 3.4, z + r(), 0.7 + r() * 0.5);
    add(x + RIVER_HALF_WIDTH + 3.4, z + r(), 0.7 + r() * 0.5);
  }
  for (let i = 0; i < 160; i++) add(LANDMARKS.toji.x + (r() - 0.5) * 22, LANDMARKS.toji.z + (r() - 0.5) * 22, 0.8 + r());
  // the wooded slope of Higashiyama in front of the camera
  const cam = VIEW.camera;
  for (let i = 0; i < 4200 * quality; i++) {
    const a = Math.PI * (0.55 + r() * 0.95);
    const d = 6 + Math.pow(r(), 0.7) * 150;
    const x = cam.x + Math.cos(a) * d;
    const z = cam.z - Math.sin(a) * d * 0.9;
    if (heightAt(x, z) > 0.9) add(x, z, 0.9 + r() * 1.6);
  }

  const geo = new THREE.IcosahedronGeometry(1, 1);
  const seeds = new Float32Array(spots.length);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env, uAlbedo: { value: new THREE.Color(0.022, 0.04, 0.022) }, uVary: { value: 0.9 }, uWobble: { value: 0.18 } },
    vertexShader: SIMPLE_VS,
    fragmentShader: SIMPLE_FS,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(([x, z, size], i) => {
    const y = heightAt(x, z);
    m.compose(new THREE.Vector3(x, y + size * 0.55, z), q, new THREE.Vector3(size, size * (0.8 + r() * 0.5), size));
    mesh.setMatrixAt(i, m);
    seeds[i] = r();
  });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.computeBoundingSphere();
  return mesh;
}

/* ---------- street lights ---------- */

const LIGHT_VS = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uPx;
  uniform float uCity;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    float d = -mv.z;
    float size = aSize * uPx / d;
    vA = clamp(size / 1.6, 0., 1.) * uCity * exp(-d * uFogDensity * .5);
    gl_PointSize = max(size, 1.6);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }
`;

const LIGHT_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main(){
    float r = length(gl_PointCoord - .5) * 2.;
    float a = exp(-r * r * 3.5) * vA;
    if (a < .003) discard;
    gl_FragColor = vec4(vColor * a, 1.);
  }
`;

function lightMaterial(env: Env, extra: Record<string, THREE.IUniform> = {}, vs = LIGHT_VS) {
  return new THREE.ShaderMaterial({
    uniforms: { uCity: env.uCity, uFogDensity: env.uFogDensity, uTime: env.uTime, uPx: { value: 600 }, ...extra },
    vertexShader: vs,
    fragmentShader: LIGHT_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildStreetLights(env: Env, quality: number) {
  const step = quality > 0.75 ? 1.6 : 2.4;
  const pos: number[] = [];
  const col: number[] = [];
  const size: number[] = [];
  const B = CITY.block;
  const push = (x: number, z: number, avenue: boolean) => {
    if (heightAt(x, z) > 0.3 || isRiver(x, z) || inRect(x, z, LANDMARKS.gosho)) return;
    pos.push(x, 0.6, z);
    if (avenue) col.push(2.6, 2.3, 1.9);
    else col.push(2.4, 1.25, 0.45);
    size.push(avenue ? 0.5 : 0.36);
  };
  for (let x = CITY.minX; x <= CITY.maxX; x += B) {
    const av = nearAvenue(x, AVENUES.northSouth, 1);
    for (let z = CITY.minZ; z <= CITY.maxZ; z += step) push(x, z, av);
  }
  for (let z = CITY.minZ; z <= CITY.maxZ; z += B) {
    const av = nearAvenue(z, AVENUES.eastWest, 1);
    for (let x = CITY.minX; x <= CITY.maxX; x += step) push(x, z, av);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  const points = new THREE.Points(geo, lightMaterial(env));
  points.frustumCulled = false;
  points.name = 'streetLights';
  return points;
}

/** Point sizes are given in world units; tell the shaders how many pixels one unit is at distance 1. */
export function setPointScale(root: THREE.Object3D, pxPerUnit: number) {
  root.traverse((o) => {
    const mat = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
    if (mat && mat.uniforms && mat.uniforms.uPx) mat.uniforms.uPx.value = pxPerUnit;
  });
}
