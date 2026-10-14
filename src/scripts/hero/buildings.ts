import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { CLASS, type BoxBuilding, type PolyBuilding } from './buildings-data';
import { hash1 } from './util';
import { inCampus } from './geo';
import { isDetailed } from './campus';

/*
 * The city: every PLATEAU building at its measured height.
 * Rectangles are instanced from two unit shapes, a flat-topped block and a pitched roof
 * (gabled for houses, hipped for big wooden halls such as temple buildings); other outlines
 * are extruded. Walls get windows that light up at night. Everything is split into 1.5 km
 * chunks so the parts behind the camera are culled.
 */

const CHUNK = 1500;
/** Walls run this far below the ground so buildings on slopes never float. */
const FOOTING = 6;

/* ---------- unit shapes ---------- */

interface Face {
  pts: number[][];
  n: number[];
  role: number;
}

/**
 * Unit shapes in a coded space: x and z in -0.5..0.5 (x along the long side), y = 0 ground,
 * 1 eaves (or the top of a flat block), 2 ridge. The vertex shader turns codes into metres.
 * role: 0 wall, 1 roof slope on a long side, 2 end of a pitched roof (gable wall or hip), 3 flat roof.
 */
function unitShape(faces: Face[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const role: number[] = [];
  const tri = (a: number[], b: number[], c: number[], n: number[], r: number) => {
    // wind counter-clockwise around the outward normal
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      pos.push(...p);
      nrm.push(...n);
      role.push(r);
    }
  };
  for (const f of faces) {
    if (f.pts.length === 3) tri(f.pts[0], f.pts[1], f.pts[2], f.n, f.role);
    else {
      tri(f.pts[0], f.pts[1], f.pts[2], f.n, f.role);
      tri(f.pts[0], f.pts[2], f.pts[3], f.n, f.role);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aRole', new THREE.Float32BufferAttribute(role, 1));
  return g;
}

const walls = (top: number): Face[] => [
  { pts: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, top, 0.5], [-0.5, top, 0.5]], n: [0, 0, 1], role: 0 },
  { pts: [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, top, -0.5], [0.5, top, -0.5]], n: [0, 0, -1], role: 0 },
  { pts: [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, top, -0.5], [0.5, top, 0.5]], n: [1, 0, 0], role: 0 },
  { pts: [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, top, 0.5], [-0.5, top, -0.5]], n: [-1, 0, 0], role: 0 },
];

function flatShape() {
  return unitShape([...walls(1), { pts: [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]], n: [0, 1, 0], role: 3 }]);
}

function pitchedShape() {
  return unitShape([
    ...walls(1),
    { pts: [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 2, 0], [-0.5, 2, 0]], n: [0, 1, 1], role: 1 },
    { pts: [[0.5, 1, -0.5], [-0.5, 1, -0.5], [-0.5, 2, 0], [0.5, 2, 0]], n: [0, 1, -1], role: 1 },
    { pts: [[0.5, 1, 0.5], [0.5, 1, -0.5], [0.5, 2, 0]], n: [1, 0, 0], role: 2 },
    { pts: [[-0.5, 1, -0.5], [-0.5, 1, 0.5], [-0.5, 2, 0]], n: [-1, 0, 0], role: 2 },
  ]);
}

/* ---------- shaders ---------- */

/** Instanced placement: decode the unit shape into metres and turn it to the building's angle. */
const INSTANCE_VS = /* glsl */ `
  attribute float aRole;
  attribute vec3 iPos;    // x, ground, z
  attribute vec3 iSize;   // long side, height, short side
  attribute float iRot;
  attribute vec4 iMeta;   // kind, seed, roof (0 flat, 1 gable, 2 hip), roof height
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vWall;
  varying vec4 vInfo;

  void main(){
    vec3 p = position;
    float w = iSize.x, h = iSize.y, d = iSize.z;
    float roof = iMeta.z;
    float rh = iMeta.w;
    float hip = step(1.5, roof);
    float eave = roof > .5 ? h - rh * .5 : h;
    float y = p.y < .5 ? -${FOOTING.toFixed(1)} : (p.y < 1.5 ? eave : eave + rh);
    vec2 xz = p.xz * vec2(w, d);
    if (p.y > 1.5){
      xz = vec2(sign(p.x) * max(w * .5 - hip * d * .5, 0.), 0.);
    }
    // roofs overhang the walls a little
    float oh = min(.55, d * .07);
    if (aRole == 1.){
      if (p.y < 1.5){ xz += sign(p.xz) * oh * vec2(1., 1.); y -= oh * rh / max(d * .5, 1.); }
      else xz.x += sign(p.x) * oh * (1. - hip);
    }
    if (aRole == 2. && hip > .5 && p.y < 1.5){ xz += sign(p.xz) * oh; y -= oh * rh / max(d * .5, 1.); }

    vec3 n = normal;
    if (aRole == 1.) n = normalize(vec3(0., d * .5, sign(p.z) * rh));
    if (aRole == 2. && hip > .5) n = normalize(vec3(sign(p.x) * rh, d * .5, 0.));

    float c = cos(iRot), s = sin(iRot);
    mat2 R = mat2(c, s, -s, c);
    vec2 wxz = R * xz;
    vec2 wn = R * n.xz;
    vec3 world = vec3(iPos.x + wxz.x, iPos.y + y, iPos.z + wxz.y);
    vWorld = world;
    vNormal = normalize(vec3(wn.x, n.y, wn.y));
    float along = abs(normal.x) > .5 ? p.z * d + 31. * sign(normal.x) : p.x * w + 17. * sign(normal.z);
    vWall = vec2(along, y);
    vInfo = vec4(iMeta.x, iMeta.y, h, aRole);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
  }
`;

/** Extruded outlines: positions are already in metres. */
const POLY_VS = /* glsl */ `
  attribute vec2 aWall;   // distance along the outline, height above ground
  attribute vec4 aInfo;   // kind, seed, height, role
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vWall;
  varying vec4 vInfo;
  void main(){
    vWorld = position;
    vNormal = normal;
    vWall = aWall;
    vInfo = aInfo;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.);
  }
`;

const BUILDING_FS = /* glsl */ `
  ${ENV_GLSL}
  ${SHADOW_GLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vWall;
  varying vec4 vInfo;

  vec3 pick4(float r, vec3 a, vec3 b, vec3 c, vec3 d){ return r < .25 ? a : r < .5 ? b : r < .75 ? c : d; }

  void main(){
    vec3 n = normalize(vNormal);
    // everything that takes screen-space derivatives runs first, before any branch or discard
    float sh = sunShadow(vWorld, n);
    vec2 fwWall = fwidth(vWall);
    // the detailed campus model (campus.ts) stands in for these blocks up close
    if (vInfo.x > 767.5 && uCampusDetail > .5) discard;
    float campus = step(255.5, vInfo.x) * uHighlight;
    // codes arrive through interpolation, so 4.0 can turn up as 3.99999: round before taking them
    // apart, or a house flips between wood and concrete from one pixel to the next
    float code = floor(vInfo.x + .5);
    float kind = mod(code, 256.);
    float cls = mod(kind, 4.);
    float use = floor(kind / 4. + .01);
    float seed = vInfo.y;
    float H = vInfo.z;
    float role = floor(vInfo.w + .5);
    vec3 v = normalize(vWorld - cameraPosition);
    float r1 = fract(seed * 13.17);
    float r2 = fract(seed * 71.31);
    bool wooden = cls < .5;
    bool roof = role > 2.5 || (role > .5 && n.y > .2);

    vec3 albedo;
    vec3 emit = vec3(0.);
    if (roof){
      if (wooden || role < 2.5){
        // kawara: blue-grey tiles, a few newer brown or slate roofs
        albedo = pick4(r1, vec3(.055, .06, .068), vec3(.075, .078, .085), vec3(.045, .046, .05), vec3(.09, .065, .05));
        // rows of tiles, faded to their average once a row is thinner than a couple of pixels
        float rows = 1. - smoothstep(.15, .4, max(fwWall.x * .6, fwWall.y * 3.));
        albedo *= .9 + .25 * mix(.5, vnoise(vWall * vec2(.6, 3.)), rows);
      } else {
        // flat concrete roofs, some darker waterproofing
        albedo = pick4(r1, vec3(.32, .31, .29), vec3(.24, .24, .23), vec3(.4, .39, .36), vec3(.16, .17, .18));
        albedo *= .85 + .3 * mix(.5, vnoise(vWorld.xz * .15 + seed), 1. - smoothstep(.2, .5, fwWall.x * .15));
      }
    } else {
      vec3 wall;
      // Kyoto's walls: dark wood and plaster on the old houses, muted tile and concrete elsewhere
      if (wooden) wall = pick4(r1, vec3(.36, .33, .28), vec3(.09, .065, .045), vec3(.24, .21, .18), vec3(.17, .16, .15));
      else if (use == 4. || H > 31.) wall = pick4(r1, vec3(.3, .31, .32), vec3(.2, .22, .24), vec3(.36, .34, .31), vec3(.14, .16, .19));
      else wall = pick4(r1, vec3(.4, .37, .33), vec3(.3, .27, .23), vec3(.44, .43, .41), vec3(.23, .2, .18));
      wall *= .85 + .3 * r2;

      // windows on a floor grid
      float floorH = wooden ? 2.9 : (use == 4. ? 3.7 : 3.1);
      float cellW = wooden ? 2.4 : (use == 2. ? 3.4 : 2.9);
      vec2 g = vec2(vWall.x / cellW, (vWall.y - .5) / floorH);
      vec2 id = floor(g);
      vec2 f = fract(g);
      vec2 fw = fwWall / vec2(cellW, floorH);
      float wx = smoothstep(.18 - fw.x, .18 + fw.x, f.x) * (1. - smoothstep(.82 - fw.x, .82 + fw.x, f.x));
      float wy = smoothstep(.32 - fw.y, .32 + fw.y, f.y) * (1. - smoothstep(.86 - fw.y, .86 + fw.y, f.y));
      // a window cell under ~4 pixels can't be drawn without shimmering: everything that switches
      // per cell blends to the facade's average as the cells shrink
      float tiny = smoothstep(.12, .3, max(fw.x, fw.y));
      float valid = mix(step(0., id.y) * step((id.y + 1.) * floorH, H + .2), step(0., vWall.y), tiny);
      float pane = mix(wx * wy, .35, tiny) * valid;
      // old wooden houses only have a window here and there
      if (wooden) pane *= mix(step(.45, hash12(id + seed * 7.)), .55, tiny);

      // glass by day: darker panes that pick up a little sky
      float glassRefl = .03 + .18 * pow(clamp(1. - dot(-v, n), 0., 1.), 4.);
      vec3 glass = vec3(.025, .03, .035) + skyColor(reflect(v, n)) * glassRefl * (1. - tiny);
      albedo = mix(wall, glass, pane * (.6 - .3 * tiny));

      // lit windows at night: warm homes and hotels, cooler offices. Some buildings are dark.
      float awake = step(.22, fract(seed * 5.31));
      float rate = uLit * (wooden ? .8 : 1.) * (use == 4. ? 1.3 : 1.) * awake;
      float lit = step(hash12(id * vec2(1.7, 3.1) + seed * 31.), rate);
      // far away a facade's windows are below a pixel: keep only a faint average so the city
      // reads as dark masses with points of light, not a lit sheet
      lit = mix(lit, rate * .04, tiny);
      vec3 warm = vec3(1., .58, .26);
      vec3 cool = vec3(.95, .85, .7);
      vec3 lampCol = mix(warm, cool, (use == 4. ? .8 : .15) * step(.4, hash12(id + seed)));
      float strength = wooden ? 1.8 : 2.6;
      emit += lampCol * lit * pane * strength * uCity;
      // shopfronts glow along the street
      if ((use == 3. || use == 5.) && id.y < .5) emit += warm * smoothstep(.1, .5, f.y) * valid * mix(1.2, .05, tiny) * uCity;
    }

    // the campus, when it is in focus: clean white facades, a teal line along the roofs, teal windows at night
    if (campus > 0.){
      albedo = mix(albedo, vec3(.62, .66, .66), campus * .55);
      float roofline = smoothstep(H - 1.2, H - .2, vWall.y) * (roof ? 0. : 1.);
      vec3 teal = vec3(.39, .86, .9);
      emit += teal * roofline * campus * (1.2 + 2. * uCity);
      emit += teal * .25 * campus * (roof ? .4 : 1.) * (.4 + uCity);
    }

    vec3 col = shade(albedo, n, vWorld, sh);
    gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
  }
`;

const DEPTH_FS = /* glsl */ `
  #include <packing>
  void main(){ gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }
`;

/* ---------- building the meshes ---------- */

function roofFor(b: BoxBuilding) {
  if ((b.kind & 3) !== CLASS.wooden || b.h > 16) return { type: 0, rh: 0 };
  const area = b.w * b.d;
  if (area > 260) {
    // temple halls and big old buildings: tall hipped roofs
    return { type: 2, rh: Math.min(b.h * 0.55, b.d * 0.42) };
  }
  return { type: 1, rh: Math.min(Math.max(b.d * 0.26, 1.2), b.h * 0.4) };
}

function instanced(shape: THREE.InstancedBufferGeometry, list: { b: BoxBuilding; y: number; seed: number }[], pitched: boolean) {
  const n = list.length;
  const geo = new THREE.InstancedBufferGeometry();
  for (const name of ['position', 'normal', 'aRole']) geo.setAttribute(name, shape.getAttribute(name));
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n * 3);
  const rot = new Float32Array(n);
  const meta = new Float32Array(n * 4);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = -Infinity, minY = Infinity;
  list.forEach(({ b, y, seed }, i) => {
    const r = pitched ? roofFor(b) : { type: 0, rh: 0 };
    pos.set([b.x, y, b.z], i * 3);
    size.set([b.w, b.h, b.d], i * 3);
    rot[i] = b.angle;
    const campus = inCampus(b.x, b.z) ? 256 + (isDetailed(b.kind, b.h, b.x, b.z) ? 512 : 0) : 0;
    meta.set([b.kind + campus, seed, r.type, r.rh], i * 4);
    minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
    minZ = Math.min(minZ, b.z); maxZ = Math.max(maxZ, b.z);
    minY = Math.min(minY, y - FOOTING); maxY = Math.max(maxY, y + b.h + r.rh);
  });
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 3));
  geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1));
  geo.setAttribute('iMeta', new THREE.InstancedBufferAttribute(meta, 4));
  geo.instanceCount = n;
  const box = new THREE.Box3(new THREE.Vector3(minX - 40, minY, minZ - 40), new THREE.Vector3(maxX + 40, maxY, maxZ + 40));
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return geo;
}

/** Walls and a triangulated flat roof for each outline, merged into one geometry. */
function extruded(list: { p: PolyBuilding; y: number; seed: number }[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const wall: number[] = [];
  const info: number[] = [];
  type V = [number, number, number, number, number];
  /** One triangle of vertices [x, y, z, u, v], wound counter-clockwise around the outward normal n. */
  const tri = (a: V, b: V, c: V, n: number[], inf: number[]) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const dot = (ab[1] * ac[2] - ab[2] * ac[1]) * n[0] + (ab[2] * ac[0] - ab[0] * ac[2]) * n[1] + (ab[0] * ac[1] - ab[1] * ac[0]) * n[2];
    for (const q of dot < 0 ? [a, c, b] : [a, b, c]) {
      pos.push(q[0], q[1], q[2]);
      nrm.push(n[0], n[1], n[2]);
      wall.push(q[3], q[4]);
      info.push(...inf);
    }
  };
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const { p, y, seed } of list) {
    const r = p.ring;
    const m = r.length / 2;
    const top = y + p.h;
    const bottom = y - FOOTING;
    // signed area decides which side of each edge is outside
    let area = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      area += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
    }
    const out = area >= 0 ? 1 : -1;
    let along = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < m; i++) {
      cx += r[i * 2] / m;
      cz += r[i * 2 + 1] / m;
    }
    const campus = inCampus(cx, cz) ? 256 + (isDetailed(p.kind, p.h, cx, cz) ? 512 : 0) : 0;
    const inf = [p.kind + campus, seed, p.h, 0];
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const n = [(out * (bz - az)) / len, 0, (-out * (bx - ax)) / len];
      const u0 = along, u1 = along + len;
      tri([ax, bottom, az, u0, -FOOTING], [bx, bottom, bz, u1, -FOOTING], [bx, top, bz, u1, p.h], n, inf);
      tri([ax, bottom, az, u0, -FOOTING], [bx, top, bz, u1, p.h], [ax, top, az, u0, p.h], n, inf);
      along = u1;
      box.expandByPoint(corner.set(ax, bottom, az));
      box.expandByPoint(corner.set(ax, top, az));
    }
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < m; i++) contour.push(new THREE.Vector2(r[i * 2], r[i * 2 + 1]));
    const roofInf = [p.kind + campus, seed, p.h, 3];
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const [a, b, c] = t.map((k) => contour[k]);
      tri([a.x, top, a.y, a.x, a.y], [b.x, top, b.y, b.x, b.y], [c.x, top, c.y, c.x, c.y], [0, 1, 0], roofInf);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 2));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return geo;
}

/** `keep` can thin out the boxes (phones leave out small houses far from the viewpoint). */
export function buildCity(env: Env, hf: Heightfield, data: { boxes: BoxBuilding[]; polys: PolyBuilding[] }, keep: (b: BoxBuilding) => boolean = () => true) {
  const group = new THREE.Group();
  const instMat = new THREE.ShaderMaterial({ uniforms: env, vertexShader: INSTANCE_VS, fragmentShader: BUILDING_FS });
  const polyMat = new THREE.ShaderMaterial({ uniforms: env, vertexShader: POLY_VS, fragmentShader: BUILDING_FS });
  const instDepth = new THREE.ShaderMaterial({ vertexShader: INSTANCE_VS, fragmentShader: DEPTH_FS });
  const polyDepth = new THREE.ShaderMaterial({ vertexShader: POLY_VS, fragmentShader: DEPTH_FS });
  const flat = flatShape();
  const pitched = pitchedShape();

  type Chunk = { flat: { b: BoxBuilding; y: number; seed: number }[]; pitched: { b: BoxBuilding; y: number; seed: number }[]; polys: { p: PolyBuilding; y: number; seed: number }[] };
  const chunks = new Map<string, Chunk>();
  const chunkOf = (x: number, z: number) => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { flat: [], pitched: [], polys: [] }));
    return c;
  };
  data.boxes.forEach((b, i) => {
    if (!keep(b)) return;
    const y = hf.height(b.x, b.z) + b.ground;
    const seed = hash1(i * 7 + 3);
    const c = chunkOf(b.x, b.z);
    if (roofFor(b).type > 0) c.pitched.push({ b, y, seed });
    else c.flat.push({ b, y, seed });
  });
  data.polys.forEach((p, i) => {
    const cx = p.ring[0];
    const cz = p.ring[1];
    const y = hf.height(cx, cz) + p.ground;
    chunkOf(cx, cz).polys.push({ p, y, seed: hash1(i * 13 + 5) });
  });

  for (const c of chunks.values()) {
    const meshes: [THREE.BufferGeometry, THREE.ShaderMaterial, THREE.ShaderMaterial][] = [];
    if (c.flat.length) meshes.push([instanced(flat, c.flat, false), instMat, instDepth]);
    if (c.pitched.length) meshes.push([instanced(pitched, c.pitched, true), instMat, instDepth]);
    if (c.polys.length) meshes.push([extruded(c.polys), polyMat, polyDepth]);
    for (const [geo, mat, depth] of meshes) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.depthMaterial = depth;
      group.add(mesh);
    }
  }
  return { group };
}
