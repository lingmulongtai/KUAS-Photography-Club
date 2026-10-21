import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env.ts';
import { BUILT_GLSL } from './building-occlusion.ts';
import { CLASS, USAGE } from './buildings-data.ts';
import { rng } from './util.ts';

/*
 * The modelling that keeps the concrete city from looking flat, voxel-game style: pillars and
 * floor ledges standing out of the facades, balconies with solid parapets on apartment blocks,
 * a parapet round every flat roof, and the clutter on the roofs (air-conditioner units and their
 * ducts, stair and lift housings, substation cabinets, water tanks, aerials, red aviation lights
 * on the tallest buildings).
 * Only concrete buildings get them. Every part is a block in its building's frame, drawn as
 * instanced cubes per tile of the city (buildings.ts).
 */

/** Block parts and how they are coloured (see DETAIL_FS). */
export const PART = { structure: 0, rail: 1, unit: 2, tank: 3, housing: 4, beacon: 5, frame: 6, cabinet: 7, duct: 8 } as const;

/** Window grid of a facade, the same one the building shader draws (buildings.ts). */
export function facadeGrid(kind: number) {
  const wooden = (kind & 3) === CLASS.wooden;
  const use = kind >> 2;
  return {
    floorH: wooden ? 2.9 : use === USAGE.office ? 3.7 : 3.1,
    cellW: wooden ? 2.4 : use === USAGE.apartment ? 3.4 : 2.9,
  };
}

/** A growable list of blocks: centre, size, turn, parent's kind/seed/height, part, parent's ground. */
export class DetailList {
  center: number[] = [];
  size: number[] = [];
  rot: number[] = [];
  meta: number[] = [];
  base: number[] = [];
  get count() { return this.rot.length; }
  push(x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, kind: number, seed: number, part: number, h: number, ground: number) {
    this.center.push(x, y, z);
    this.size.push(sx, sy, sz);
    this.rot.push(rot);
    this.meta.push(kind, seed, part, h);
    this.base.push(ground);
  }
}

/**
 * Where a building's details go: `near` takes the many small parts (floor ledges, balconies) that
 * only show close to the camera, `mid` the rest (pillars, parapets, roof clutter).
 */
export interface DetailLists {
  near: DetailList;
  mid: DetailList;
}

/** Places blocks given in a building's own frame (x along `angle`, z across it, y above `ground`). */
function framed(out: DetailList, ox: number, oz: number, angle: number, kind: number, seed: number, h: number, ground: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, part: number) =>
    out.push(ox + c * lx - s * lz, ground + y, oz + s * lx + c * lz, sx, sy, sz, angle, kind, seed, part, h, ground);
}

type Put = ReturnType<typeof framed>;

/**
 * Roof clutter in a rectangle of the roof (centre cx, cz, size w × d in the frame of `put`):
 * a stair or lift housing, a water tank, a substation cabinet, rows of air-conditioner units,
 * an aerial, a beacon.
 */
function roofTop(put: Put, random: () => number, cx: number, cz: number, w: number, d: number, top: number, h: number) {
  const iw = w - 2.4, id = d - 2.4;
  if (iw < 1.5 || id < 1.5) return;
  const taken: number[][] = [];
  const place = (sw: number, sd: number) => {
    for (let t = 0; t < 6; t++) {
      if (sw > iw || sd > id) return null;
      const x = cx + (random() - 0.5) * (iw - sw), z = cz + (random() - 0.5) * (id - sd);
      if (taken.every(([a, b, c, e]) => Math.abs(x - a) > (sw + c) / 2 + 0.3 || Math.abs(z - b) > (sd + e) / 2 + 0.3)) {
        taken.push([x, z, sw, sd]);
        return [x, z];
      }
    }
    return null;
  };
  const area = iw * id;
  if (area > 90 && random() < 0.8) {
    const sw = 2.6 + random(), sd = 2.6 + random() * 1.2, sh = 2.6 + random() * 0.7;
    const at = place(sw, sd);
    if (at) put(at[0], top + sh / 2, at[1], sw, sh, sd, PART.housing);
  }
  if (h > 12 && random() < 0.45) {
    const at = place(2.3, 2.3);
    if (at) {
      put(at[0], top + 0.5, at[1], 1.7, 1, 1.7, PART.structure);
      put(at[0], top + 1.9, at[1], 2.2, 1.8, 2.2, PART.tank);
    }
  }
  // the building's electrical substation, a grey steel cabinet
  if (area > 60 && random() < 0.5) {
    const along = random() < 0.5;
    const cw = 2.4 + random() * 1.6;
    const at = along ? place(cw, 1.3) : place(1.3, cw);
    if (at) put(at[0], top + 1, at[1], along ? cw : 1.3, 2, along ? 1.3 : cw, PART.cabinet);
  }
  // air-conditioner units stand in short rows, their refrigerant pipes in a duct running off one end
  let units = Math.min(24, Math.max(2, Math.round((area / 22) * (0.6 + 0.8 * random()))));
  for (let miss = 0; units > 0 && miss < 6; ) {
    const row = Math.min(units, 2 + Math.floor(random() * 4));
    const along = random() < 0.5;
    const len = row * 1.25;
    const at = along ? place(len + 1.2, 0.8) : place(0.8, len + 1.2);
    if (!at) {
      miss++;
      continue;
    }
    const shift = -0.6;
    for (let i = 0; i < row; i++) {
      const o = shift + (i - (row - 1) / 2) * 1.25;
      put(at[0] + (along ? o : 0), top + 0.43, at[1] + (along ? 0 : o), along ? 1 : 0.6, 0.85, along ? 0.6 : 1, PART.unit);
    }
    const end = shift + (row * 1.25) / 2 + 0.6;
    put(at[0] + (along ? end : 0), top + 0.2, at[1] + (along ? 0 : end), along ? 1.2 : 0.3, 0.3, along ? 0.3 : 1.2, PART.duct);
    units -= row;
  }
  if (h > 20 && random() < 0.35) {
    const at = place(0.5, 0.5);
    const ah = 3 + random() * 3;
    if (at) put(at[0], top + ah / 2, at[1], 0.14, ah, 0.14, PART.unit);
  }
  // aviation lights on the tallest buildings, at two corners
  if (h > 45) {
    put(cx - w / 2 + 0.4, top + 1.15, cz - d / 2 + 0.4, 0.35, 0.35, 0.35, PART.beacon);
    put(cx + w / 2 - 0.4, top + 1.15, cz + d / 2 - 0.4, 0.35, 0.35, 0.35, PART.beacon);
  }
}

/** Facade treatment, chosen per building. */
function facadeStyle(kind: number, random: () => number) {
  const use = kind >> 2;
  if (use === USAGE.apartment || use === USAGE.house) return 'balconies';
  const r = random();
  return r < 0.4 ? 'grid' : r < 0.7 ? 'bands' : r < 0.9 ? 'fins' : 'plain';
}

/**
 * Details for a flat-roofed rectangular building: w × d × h after the renderer's inset and lift,
 * `ground` the bottom of its walls (where the window grid starts).
 */
export function boxDetails(out: DetailLists, b: { x: number; z: number; angle: number; kind: number }, w: number, d: number, h: number, ground: number, seed: number) {
  if (h < 5 || (b.kind & 3) !== CLASS.sturdy) return;
  const random = rng(Math.floor(seed * 4294967295));
  const put = framed(out.mid, b.x, b.z, b.angle, b.kind, seed, h, ground);
  const putNear = framed(out.near, b.x, b.z, b.angle, b.kind, seed, h, ground);
  const { floorH, cellW } = facadeGrid(b.kind);
  const style = facadeStyle(b.kind, random);
  // the four faces as the building shader lays out its window grid along them:
  // the coordinate along a face is the local position plus a fixed offset per face
  const faces = [
    { len: w, off: 17, at: (u: number, o: number) => [u, d / 2 + o], wide: true, side: 1 },
    { len: w, off: -17, at: (u: number, o: number) => [u, -d / 2 - o], wide: true, side: -1 },
    { len: d, off: 31, at: (u: number, o: number) => [w / 2 + o, u], wide: false, side: 1 },
    { len: d, off: -31, at: (u: number, o: number) => [-w / 2 - o, u], wide: false, side: -1 },
  ];
  const size = (wide: boolean, along: number, up: number, out_: number) => (wide ? [along, up, out_] : [out_, up, along]);
  const pillars = style === 'grid' || style === 'fins';
  if (pillars) {
    for (const f of faces) {
      // between windows, every second bay
      const step = cellW * 2;
      for (let k = Math.ceil((-f.len / 2 + 0.9 + f.off) / step); k * step - f.off < f.len / 2 - 0.9; k++) {
        const u = k * step - f.off;
        const [x, z] = f.at(u, 0.22);
        const [sx, , sz] = size(f.wide, 0.55, 0, 0.44);
        put(x, (h - 1) / 2, z, sx, h + 1, sz, PART.frame);
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(sx * w / 2, (h - 1) / 2, sz * d / 2, 0.9, h + 1, 0.9, PART.frame);
  }
  const floors = Math.floor((h - 1.7) / floorH);
  if ((style === 'grid' || style === 'bands')) {
    for (let k = 0; k < floors; k++) {
      const y = 0.5 + (k + 1.05) * floorH;
      if (y > h - 1.2) break;
      for (const f of faces) {
        const [x, z] = f.at(0, 0.17);
        const [sx, sy, sz] = size(f.wide, f.len + 0.6, 0.32, 0.34);
        putNear(x, y, z, sx, sy, sz, PART.frame);
      }
    }
  }
  if (style === 'balconies') {
    // balconies along one long side, one per floor, with a solid concrete parapet
    const f = faces[random() < 0.5 ? 0 : 1];
    const len = f.len - 0.6;
    for (let k = 0; k < floors; k++) {
      const y = 0.5 + (k + 1) * floorH;
      if (y + 1.2 > h) break;
      const [sx, , sz] = size(true, len, 0, 1);
      const [x, z] = f.at(0, 0.5);
      putNear(x, y + 0.09, z, sx, 0.18, sz, PART.frame);
      const [rx, rz] = f.at(0, 0.94);
      putNear(rx, y + 0.6, rz, len, 1, 0.12, PART.rail);
      // the ends, so each balcony reads as a box and not a shelf
      for (const e of [-1, 1]) {
        const [ex, ez] = f.at(e * (len / 2 - 0.06), 0.5);
        putNear(ex, y + 0.6, ez, 0.12, 1, 1, PART.rail);
      }
    }
  }
  if (h > 7) {
    put(0, h + 0.45, d / 2 - 0.15, w, 0.9, 0.3, PART.structure);
    put(0, h + 0.45, -d / 2 + 0.15, w, 0.9, 0.3, PART.structure);
    put(w / 2 - 0.15, h + 0.45, 0, 0.3, 0.9, d - 0.6, PART.structure);
    put(-w / 2 + 0.15, h + 0.45, 0, 0.3, 0.9, d - 0.6, PART.structure);
  }
  roofTop(put, random, 0, 0, w, d, h, h);
}

/** Details for an extruded outline: pillars and ledges along its edges, parapet, roof clutter. */
export function polyDetails(out: DetailLists, ring: Float32Array, kind: number, h: number, ground: number, seed: number) {
  if (h < 5 || (kind & 3) !== CLASS.sturdy) return;
  const random = rng(Math.floor(seed * 4294967295));
  const m = ring.length / 2;
  let area = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  const outward = area >= 0 ? 1 : -1;
  const { floorH, cellW } = facadeGrid(kind);
  const style = facadeStyle(kind, random);
  const busy = m > 40;
  let along = 0;
  let longest = 0, angle = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const nx = outward * tz, nz = -outward * tx;
    const a = Math.atan2(tz, tx);
    if (len > longest) { longest = len; angle = a; }
    // in the edge's frame local z points outward when the edge turns counter-clockwise
    const put = framed(out.mid, ax, az, a, kind, seed, h, ground);
    const putNear = framed(out.near, ax, az, a, kind, seed, h, ground);
    const o = (u: number, off: number) => [u, (nz * Math.cos(a) - nx * Math.sin(a)) * off] as const;
    if (h > 7) {
      const [lx, lz] = o(len / 2, -0.15);
      put(lx, h + 0.45, lz, len, 0.9, 0.3, PART.structure);
    }
    if (!busy && len > 3) {
      if (style === 'grid' || style === 'fins') {
        const step = cellW * 2;
        for (let k = Math.ceil((along + 0.6) / step); k * step < along + len - 0.6; k++) {
          const [lx, lz] = o(k * step - along, 0.22);
          put(lx, (h - 1) / 2, lz, 0.55, h + 1, 0.44, PART.frame);
        }
        put(0, (h - 1) / 2, 0, 0.9, h + 1, 0.9, PART.frame);
      }
      if ((style === 'grid' || style === 'bands' || style === 'balconies') && m <= 24) {
        for (let k = 0; ; k++) {
          const y = 0.5 + (k + 1.05) * floorH;
          if (y > h - 1.2) break;
          const [lx, lz] = o(len / 2, 0.17);
          putNear(lx, y, lz, len + 0.3, 0.32, 0.34, PART.frame);
        }
      }
    }
    along += len;
  }
  // roof clutter on the roof's inside, aligned to the longest edge
  let cx = 0, cz = 0;
  for (let i = 0; i < m; i++) { cx += ring[i * 2] / m; cz += ring[i * 2 + 1] / m; }
  const inside = (x: number, z: number) => {
    let hit = false;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  // the biggest square around the middle that stays inside the outline
  const c = Math.cos(angle), s = Math.sin(angle);
  let half = Math.sqrt(Math.abs(area) / 2) / 2;
  while (half > 2) {
    const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].every(([u, v]) => inside(cx + (c * u - s * v) * half, cz + (s * u + c * v) * half));
    if (ok) break;
    half *= 0.75;
  }
  if (half > 2) roofTop(framed(out.mid, cx, cz, angle, kind, seed, h, ground), random, 0, 0, half * 2, half * 2, h, h);
}

export const WALL_GLSL = /* glsl */ `
  vec3 pick4(float r, vec3 a, vec3 b, vec3 c, vec3 d){ return r < .25 ? a : r < .5 ? b : r < .75 ? c : d; }

  /** Kyoto's walls: dark wood and plaster on the old houses, muted tile and concrete elsewhere. */
  vec3 wallColor(float kind, float seed, float H){
    float cls = mod(kind, 4.);
    float use = floor(kind / 4. + .01);
    float r1 = fract(seed * 13.17);
    float r2 = fract(seed * 71.31);
    vec3 wall;
    if (cls < .5) wall = pick4(r1, vec3(.36, .33, .28), vec3(.09, .065, .045), vec3(.24, .21, .18), vec3(.17, .16, .15));
    else if (use == 4. || H > 31.) wall = pick4(r1, vec3(.3, .31, .32), vec3(.2, .22, .24), vec3(.36, .34, .31), vec3(.14, .16, .19));
    else wall = pick4(r1, vec3(.4, .37, .33), vec3(.3, .27, .23), vec3(.44, .43, .41), vec3(.23, .2, .18));
    return wall * (.85 + .3 * r2);
  }
`;

const DETAIL_VS = /* glsl */ `
  attribute vec3 iCenter;
  attribute vec3 iSize;
  attribute float iRot;
  attribute vec4 iMeta;   // parent kind, parent seed, part, parent height
  attribute float iBase;  // parent's ground
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vFace;
  varying vec3 vLocal;
  varying float vAbove;
  flat varying vec4 vInfo;
  void main(){
    vec3 lp = position * iSize;
    float c = cos(iRot), s = sin(iRot);
    mat2 R = mat2(c, s, -s, c);
    vec2 wxz = R * lp.xz;
    vec2 wn = R * normal.xz;
    vec3 world = iCenter + vec3(wxz.x, lp.y, wxz.y);
    vWorld = world;
    vNormal = vec3(wn.x, normal.y, wn.y);
    // face coordinates in metres for the block finish
    vFace = abs(normal.y) > .5 ? lp.xz : abs(normal.x) > .5 ? vec2(lp.z, world.y) : vec2(lp.x, world.y);
    vLocal = position;
    vAbove = world.y - iBase;
    vInfo = iMeta;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
  }
`;

const DETAIL_FS = /* glsl */ `
  ${ENV_GLSL}
  ${SHADOW_GLSL}
  ${BUILT_GLSL}
  ${WALL_GLSL}
  uniform float uVoxel;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vFace;
  varying vec3 vLocal;
  varying float vAbove;
  flat varying vec4 vInfo;
  void main(){
    vec3 n = normalize(vNormal);
    float sh = sunShadow(vWorld, n);
    vec2 fw = fwidth(vFace);
    float kind = mod(floor(vInfo.x + .5), 256.);
    float seed = vInfo.y;
    float part = floor(vInfo.z + .5);
    float H = vInfo.w;
    vec3 wall = wallColor(kind, seed, H);
    vec3 albedo;
    vec3 emit = vec3(0.);
    // the concrete frame stands out from the infill: pale on most buildings, dark on some
    vec3 frame = fract(seed * 29.7) < .65 ? mix(wall, vec3(.6, .59, .56), .6) * 1.1 : wall * .6;
    if (part < .5) albedo = wall * (n.y > .5 ? 1.18 : 1.07);
    else if (part > 7.5) albedo = vec3(.36, .36, .35);
    // substation cabinet: grey steel
    else if (part > 6.5) albedo = vec3(.5, .52, .5);
    else if (part > 5.5) albedo = frame * (n.y > .5 ? 1.12 : 1.);
    // balcony fronts: pale panels
    else if (part < 1.5) albedo = mix(vec3(.6, .59, .55), vec3(.5, .53, .55), step(.5, fract(seed * 5.1))) * (n.y > .5 ? 1.12 : 1.);
    else if (part < 2.5){
      // air-conditioner units: off-white casings with a dark fan grille on the front
      albedo = mix(vec3(.47, .47, .45), vec3(.6, .58, .53), fract(seed * 7.3));
      if (vLocal.z > .49){
        float r = length((vLocal.xy - vec2(-.12, 0.)) * vec2(1., .85));
        albedo *= mix(.3, 1., smoothstep(.27, .31, r));
      }
    }
    else if (part < 3.5) albedo = mix(vec3(.5, .58, .62), vec3(.58, .55, .48), step(.5, fract(seed * 3.1)));
    else if (part < 4.5) albedo = wall * .92;
    else {
      // aviation lights: dull red by day, blinking red at night
      albedo = vec3(.3, .05, .04);
      emit = vec3(1., .06, .03) * uCity * (.3 + 2.7 * step(.55, fract(uTime * .5 + seed * 3.)));
    }
    // undersides of ledges and balconies sit in their own shadow
    albedo *= n.y < -.5 ? .5 : 1.;
    // the same darker plinth and narrow-alley shade as the walls behind
    albedo *= mix(.73, 1., smoothstep(0., 2., vAbove));
    float block = smoothstep(.15, .65, builtAt(vWorld.xz, 30.));
    albedo *= 1. - .38 * block * (1. - smoothstep(1., 11., vAbove));
    // the block finish of the buildings
    vec2 vq = vFace / uVoxel;
    vec2 ve = min(fract(vq), 1. - fract(vq));
    vec2 vfw = fw / uVoxel;
    float vox = 1. - smoothstep(.1, .34, max(vfw.x, vfw.y));
    float vjit = hash12(floor(vq) + vec2(seed * 57.3 + n.x * 7.1, n.y * 19.3 + n.z * 3.7)) - .5;
    float vedge = smoothstep(0., .08 + max(vfw.x, vfw.y), min(ve.x, ve.y));
    albedo *= 1. + vox * (vjit * .14 - (1. - vedge) * .1);
    vec3 col = shade(seasonalSurface(albedo, n, vWorld), n, vWorld, sh);
    gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
  }
`;

/** The material shared by every tile's details. */
export function detailMaterial(env: Env, voxel: number) {
  return new THREE.ShaderMaterial({ uniforms: { ...env, uVoxel: { value: voxel } }, vertexShader: DETAIL_VS, fragmentShader: DETAIL_FS });
}

const cube = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.deleteAttribute('uv');
  return g;
})();

/** One instanced mesh for a list of details. */
export function detailMesh(list: DetailList, material: THREE.Material) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(cube.getIndex());
  geo.setAttribute('position', cube.getAttribute('position'));
  geo.setAttribute('normal', cube.getAttribute('normal'));
  geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(new Float32Array(list.center), 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(list.size), 3));
  geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(new Float32Array(list.rot), 1));
  geo.setAttribute('iMeta', new THREE.InstancedBufferAttribute(new Float32Array(list.meta), 4));
  geo.setAttribute('iBase', new THREE.InstancedBufferAttribute(new Float32Array(list.base), 1));
  geo.instanceCount = list.count;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < list.count; i++) {
    const r = Math.max(list.size[i * 3], list.size[i * 3 + 2]);
    box.expandByPoint(p.set(list.center[i * 3] - r, list.center[i * 3 + 1] - list.size[i * 3 + 1], list.center[i * 3 + 2] - r));
    box.expandByPoint(p.set(list.center[i * 3] + r, list.center[i * 3 + 1] + list.size[i * 3 + 1], list.center[i * 3 + 2] + r));
  }
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return new THREE.Mesh(geo, material);
}
