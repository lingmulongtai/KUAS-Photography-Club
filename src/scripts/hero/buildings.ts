import * as THREE from 'three';
import {finishSteps,prepareSteps,yieldTask} from './task-yield';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { CLASS, type BoxBuilding, type PolyBuilding } from './buildings-data';
import { hash1 } from './util';
import { inCampus, type Box } from './geo';
import { panoramaHouses, type PlacedHouse } from './panorama-blocks';
import { isDetailed } from './campus';
import { BUILT_GLSL } from './building-occlusion';
import { DetailList, WALL_GLSL, boxDetails, detailMaterial, detailMesh, polyDetails } from './building-details';

/*
 * The city: every PLATEAU building at its measured height.
 * Rectangles are instanced from two unit shapes, a flat-topped block and a pitched roof
 * (gabled for houses, hipped for big wooden halls such as temple buildings); other outlines
 * are extruded. Walls get windows that light up at night. Everything is split into 1.5 km
 * chunks so the parts behind the camera are culled.
 */

const CHUNK = 1500;
/** Edge of one block of the voxel finish, metres. */
const VOXEL = 0.75;
/** Within this distance of the camera (metres to a chunk's centre), pitched roofs are built as stairs. */
const STEPPED_NEAR = 2200;
/** Size of the tiles facade details are modelled and shown in. */
const DETAIL_TILE = 400;
/** Walls run this far below the ground so buildings on slopes never float. */
const FOOTING = 6;

/**
 * Neighbouring houses often have the same measured height, and their fitted rectangles overlap
 * a little, so two roofs (or two street fronts) can lie in exactly the same plane and fight over
 * every pixel as the camera moves. Each building gets its own few centimetres of extra height
 * and inset so one of them always wins.
 */
const separation = (seed: number) => ({ lift: 0.06 + 0.42 * ((seed * 97.13) % 1), inset: 0.04 + 0.22 * ((seed * 57.71) % 1) });

/* ---------- unit shapes ---------- */

interface Face {
  pts: number[][];
  n: number[];
  role: number;
  /** stepped roofs: half the width of the block this face belongs to, in coded units */
  level?: number;
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
  const level: number[] = [];
  const indices: number[] = [];
  const corners = new Map<number[], number>();
  const tri = (a: number[], b: number[], c: number[], n: number[], r: number, l: number) => {
    // wind counter-clockwise around the outward normal
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      const corner = corners.get(p);
      indices.push(corner ?? role.length);
      if (corner !== undefined) continue;
      corners.set(p, role.length);
      pos.push(...p);
      nrm.push(...n);
      role.push(r);
      level.push(l);
    }
  };
  for (const f of faces) {
    corners.clear(); // Different faces have different normals, even at a shared corner.
    const l = f.level ?? 0.5;
    if (f.pts.length === 3) tri(f.pts[0], f.pts[1], f.pts[2], f.n, f.role, l);
    else {
      tri(f.pts[0], f.pts[1], f.pts[2], f.n, f.role, l);
      tri(f.pts[0], f.pts[2], f.pts[3], f.n, f.role, l);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aRole', new THREE.Float32BufferAttribute(role, 1));
  g.setAttribute('aLevel', new THREE.Float32BufferAttribute(level, 1));
  return g;
}

const walls = (top: number): Face[] => [
  { pts: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, top, 0.5], [-0.5, top, 0.5]], n: [0, 0, 1], role: 0 },
  { pts: [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, top, -0.5], [0.5, top, -0.5]], n: [0, 0, -1], role: 0 },
  { pts: [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, top, -0.5], [0.5, top, 0.5]], n: [1, 0, 0], role: 0 },
  { pts: [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, top, 0.5], [-0.5, top, -0.5]], n: [-1, 0, 0], role: 0 },
];

function flatShape(sides = walls(1)) {
  return unitShape([...sides, { pts: [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]], n: [0, 1, 0], role: 3 }]);
}

function pitchedShape(sides = walls(1)) {
  return unitShape([
    ...sides,
    { pts: [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 2, 0], [-0.5, 2, 0]], n: [0, 1, 1], role: 1 },
    { pts: [[0.5, 1, -0.5], [-0.5, 1, -0.5], [-0.5, 2, 0], [0.5, 2, 0]], n: [0, 1, -1], role: 1 },
    { pts: [[0.5, 1, 0.5], [0.5, 1, -0.5], [0.5, 2, 0]], n: [1, 0, 0], role: 2 },
    { pts: [[-0.5, 1, -0.5], [-0.5, 1, 0.5], [-0.5, 2, 0]], n: [-1, 0, 0], role: 2 },
  ]);
}

/** Steps in a stepped roof. */
const ROOF_STEPS = 3;

/**
 * The pitched roof built from blocks, the way a voxel game builds one: each course is a slab a
 * little narrower than the one below, so gables and hips become stairs. Codes as above, except
 * that y runs 1..2 continuously over the roof and `level` carries each course's half-width
 * (the vertex shader pulls hips in from the ends by the same amount).
 */
function steppedShape() {
  const faces: Face[] = [...walls(1)];
  const N = ROOF_STEPS;
  for (let k = 0; k < N; k++) {
    const w = 0.5 * (1 - k / N);
    const inner = k < N - 1 ? 0.5 * (1 - (k + 1) / N) : 0;
    const y0 = 1 + k / N, y1 = 1 + (k + 1) / N;
    const level = w;
    // the treads left uncovered by the next course up, on both long sides
    faces.push({ pts: [[-0.5, y1, inner], [0.5, y1, inner], [0.5, y1, w], [-0.5, y1, w]], n: [0, 1, 0], role: 1, level });
    if (inner > 0) faces.push({ pts: [[-0.5, y1, -w], [0.5, y1, -w], [0.5, y1, -inner], [-0.5, y1, -inner]], n: [0, 1, 0], role: 1, level });
    else faces.push({ pts: [[-0.5, y1, -w], [0.5, y1, -w], [0.5, y1, 0], [-0.5, y1, 0]], n: [0, 1, 0], role: 1, level });
    // treads at the ends, which only show on a hip (there the next course is shorter as well);
    // x = ±0.25 marks the next course's end
    if (inner > 0) {
      faces.push({ pts: [[0.5, y1, -inner], [0.5, y1, inner], [0.25, y1, inner], [0.25, y1, -inner]], n: [0, 1, 0], role: 1, level });
      faces.push({ pts: [[-0.25, y1, -inner], [-0.25, y1, inner], [-0.5, y1, inner], [-0.5, y1, -inner]], n: [0, 1, 0], role: 1, level });
    }
    // risers on the long sides
    faces.push({ pts: [[-0.5, y0, w], [0.5, y0, w], [0.5, y1, w], [-0.5, y1, w]], n: [0, 0, 1], role: 1, level });
    faces.push({ pts: [[0.5, y0, -w], [-0.5, y0, -w], [-0.5, y1, -w], [0.5, y1, -w]], n: [0, 0, -1], role: 1, level });
    // ends: a stepped gable wall, or the stairs of a hip
    faces.push({ pts: [[0.5, y0, w], [0.5, y0, -w], [0.5, y1, -w], [0.5, y1, w]], n: [1, 0, 0], role: 2, level });
    faces.push({ pts: [[-0.5, y0, -w], [-0.5, y0, w], [-0.5, y1, w], [-0.5, y1, -w]], n: [-1, 0, 0], role: 2, level });
  }
  // the underside of the eaves course, which overhangs the walls
  faces.push({ pts: [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]], n: [0, -1, 0], role: 1, level: 0.5 });
  return unitShape(faces);
}

/* ---------- shaders ---------- */

/** Instanced placement: decode the unit shape into metres and turn it to the building's angle. */
const INSTANCE_VS = /* glsl */ `
  #ifdef DISTRICT_HOUSES
    attribute float iSlot;
    uniform sampler2D uNearby;
    uniform vec4 uDetail;
  #endif
  attribute float aRole;
  attribute float aLevel;
  attribute vec3 iPos;    // x, ground, z
  attribute vec3 iSize;   // long side, height, short side
  attribute float iRot;
  attribute vec4 iMeta;   // kind, seed, roof (0 flat, 1 gable, 2 hip), roof height
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vWall;
  flat varying vec4 vInfo;

  void main(){
    #ifdef DISTRICT_HOUSES
      vec2 uv=(vec2(mod(iSlot,16.),floor(iSlot/16.))+.5)/16.;
      if(texture2D(uNearby,uv).r>.5 || (all(greaterThanEqual(iPos.xz,uDetail.xy)) && all(lessThan(iPos.xz,uDetail.zw)))){
        gl_Position=vec4(2.,2.,2.,1.);return;
      }
    #endif
    vec3 p = position;
    vec3 face = normal;
    float c = cos(iRot), s = sin(iRot);
  #ifdef BLOCK_OVERVIEW
    // This mesh submits two walls. Rotate each canonical wall to the camera-facing
    // side of its house, preserving winding and the original window coordinates.
    if (aRole == 0.) {
      vec2 eye = cameraPosition.xz - iPos.xz;
      vec2 axis = face.x > .5 ? vec2(c, s) : vec2(-s, c);
      if (dot(eye, axis) < 0.) { p.xz = -p.xz; face.xz = -face.xz; }
    }
  #endif
    float w = iSize.x, h = iSize.y, d = iSize.z;
    float roof = iMeta.z;
    float rh = iMeta.w;
    float hip = step(1.5, roof);
    float eave = roof > .5 ? h - rh * .5 : h;
    vec3 n = face;
  #ifdef STEPPED
    float y = p.y < .5 ? -${FOOTING.toFixed(1)} : eave + max(p.y - 1., 0.) * rh;
    vec2 xz = p.xz * vec2(w, d);
    if (aRole > .5){
      // each course's ends: the full length on a gable, pulled in like the sides on a hip
      float lv = aLevel - (abs(p.x) < .4 ? .5 / float(${ROOF_STEPS}) : 0.);
      float halfLen = max(w * .5 - hip * (.5 - lv) * d, min(w * .5, lv * d));
      xz.x = sign(p.x) * halfLen;
      // the eaves course overhangs the walls a little
      float oh = min(.55, d * .07) * step(.49, aLevel);
      xz.x += sign(p.x) * oh;
      xz.y += sign(p.z) * step(.49, abs(p.z)) * oh;
    }
  #else
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

    if (aRole == 1.) n = normalize(vec3(0., d * .5, sign(p.z) * rh));
    if (aRole == 2. && hip > .5) n = normalize(vec3(sign(p.x) * rh, d * .5, 0.));
  #endif

    mat2 R = mat2(c, s, -s, c);
    vec2 wxz = R * xz;
    vec2 wn = R * n.xz;
    vec3 world = vec3(iPos.x + wxz.x, iPos.y + y, iPos.z + wxz.y);
    vWorld = world;
    vNormal = normalize(vec3(wn.x, n.y, wn.y));
    float along = abs(face.x) > .5 ? p.z * d + 31. * sign(face.x) : p.x * w + 17. * sign(face.z);
    // level faces are laid out across their plane, so the blocks of a roof run both ways
    vWall = abs(normal.y) > .5 ? xz : vec2(along, y);
    float role = aRole;
  #ifdef STEPPED
    // the stairs at the ends of a hip are roof, not wall
    if (aRole == 2. && hip > .5) role = 1.;
  #endif
    vInfo = vec4(iMeta.x, iMeta.y, h, role);
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
  flat varying vec4 vInfo;
  void main(){
    vWorld = position;
    vNormal = normal;
    vWall = aWall;
    vInfo = aInfo;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.);
  }
`;

export const BUILDING_FS = /* glsl */ `
  ${ENV_GLSL}
  ${SHADOW_GLSL}
  ${BUILT_GLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vWall;
  flat varying vec4 vInfo;
  ${WALL_GLSL}
  #ifdef REGIONAL_OVERVIEW
    uniform vec4 uDetailBox;
  #endif

  void main(){
    vec3 n = normalize(vNormal);
    // everything that takes screen-space derivatives runs first, before any branch or discard
    float sh = sunShadow(vWorld, n);
    vec2 fwWall = fwidth(vWall);
    // which way along a wall its coordinate runs, for the depth of the window recesses
    vec3 across = normalize(vec3(-n.z, 0., n.x) + 1e-5);
    vec2 dWall = vec2(dFdx(vWall.x), dFdy(vWall.x));
    float alongSign = dot(dFdx(vWorld), across) * dWall.x + dot(dFdy(vWorld), across) * dWall.y < 0. ? -1. : 1.;
    #ifdef REGIONAL_OVERVIEW
      if(all(greaterThanEqual(vWorld.xz,uDetailBox.xy))&&all(lessThan(vWorld.xz,uDetailBox.zw)))discard;
    #endif
    // the detailed campus model (campus.ts) stands in for these blocks up close
    if (vInfo.x > 767.5 && uCampusDetail > .5) discard;
    float campus = step(255.5, vInfo.x) * uHighlight;
    // codes arrive through interpolation, so 4.0 can turn up as 3.99999: round before taking them
    // apart, or a house flips between wood and concrete from one pixel to the next
    float code = floor(vInfo.x + .5);
    float kind = mod(code, 256.);
    float cls = mod(kind, 4.);
    float use = floor(kind / 4. + .01);
    // Building identity is constant across the primitive. Perspective interpolation
    // perturbs a seed by a few ULPs, enough for the window hash to flip on/off.
    float seed = vInfo.y;
    float H = vInfo.z;
    float role = floor(vInfo.w + .5);
    vec3 v = normalize(vWorld - cameraPosition);
    float r1 = fract(seed * 13.17);
    float r2 = fract(seed * 71.31);
    bool wooden = cls < .5;
    bool roof = role > 2.5 || (role > .5 && role < 1.5) || (role > .5 && n.y > .2);

    // Close up, every surface is built of blocks, like a voxel game: each block has its own
    // shade and a slightly darker edge, and windows snap to whole blocks. Blocks smaller than a
    // few pixels would shimmer, so they fade to the plain surface with distance.
    vec2 vq = vWall / ${VOXEL.toFixed(2)};
    vec2 vcell = floor(vq);
    vec2 ve = min(fract(vq), 1. - fract(vq));
    vec2 vfw = fwWall / ${VOXEL.toFixed(2)};
    float vox = 1. - smoothstep(.1, .34, max(vfw.x, vfw.y));
    float vjit = hash12(vcell + vec2(seed * 57.3 + n.x * 7.1, n.y * 19.3 + n.z * 3.7)) - .5;
    float vedge = smoothstep(0., .08 + max(vfw.x, vfw.y), min(ve.x, ve.y));
    float voxShade = 1. + vox * (vjit * .18 - (1. - vedge) * .1);
    // (only the old wooden houses: concrete walls get real window recesses instead, below)
    vec2 wallAt = mix(vWall, (vcell + .5) * ${VOXEL.toFixed(2)}, wooden ? vox : 0.);

    vec3 albedo;
    vec3 emit = vec3(0.);
    vec3 specRefl = vec3(0.);
    float modernGlass = 0.;
    if (roof){
      if (wooden || role < 2.5){
        // kawara: blue-grey tiles, a few newer brown or slate roofs
        albedo = pick4(r1, vec3(.055, .06, .068), vec3(.075, .078, .085), vec3(.045, .046, .05), vec3(.09, .065, .05));
        // rows of tiles, faded to their average once a row is thinner than a couple of pixels
        float rows = 1. - smoothstep(.15, .4, max(fwWall.x * .6, fwWall.y * 3.));
        albedo *= .9 + .25 * mix(.5, vnoise(vWall * vec2(.6, 3.)), rows);
      } else {
        // flat concrete roofs: waterproof membrane tone + mid/far penthouse & rooftop equipment texture
        albedo = pick4(r1, vec3(.12, .13, .145), vec3(.175, .165, .148), vec3(.095, .118, .135), vec3(.22, .208, .185));
        float rFoot = max(fwWall.x, fwWall.y);
        float fineR = 1. - smoothstep(.2, .55, rFoot * .15);
        float medR = 1. - smoothstep(.25, .85, rFoot * .055);
        // Subtle membrane seam grid & rooftop mechanical pad variation visible at mid-range overlooks
        vec2 roofCell = vWorld.xz * .085 + vec2(seed * 19.3, seed * 37.1);
        float equip = step(.72, hash12(floor(roofCell))) * smoothstep(.15, .32, min(fract(roofCell.x), 1. - fract(roofCell.x)))
                    * smoothstep(.15, .32, min(fract(roofCell.y), 1. - fract(roofCell.y)));
        float patchVar = mix(.5, vnoise(vWorld.xz * .045 + seed * 11.), medR);
        float fineVar = mix(.5, vnoise(vWorld.xz * .16 + seed), fineR);
        albedo *= .78 + .26 * patchVar + .18 * fineVar;
        albedo = mix(albedo, albedo * (.68 + .55 * r2) + vec3(.03), equip * medR * .65);
      }
    } else {
      vec3 wall = wallColor(kind, seed, H);
      // Enrich concrete/urban architectural material palette (limestone, sandstone, tile, charcoal, cool steel)
      // so mid & far skylines read as distinct buildings instead of uniform grey blocks.
      if (!wooden) {
        float archStyle = fract(seed * 23.71);
        vec3 archTint = archStyle < .22 ? vec3(.90, .95, 1.04)   // cool steel / slate office
                      : archStyle < .46 ? vec3(1.06, 1.00, .91)  // warm limestone / cream tile
                      : archStyle < .66 ? vec3(1.04, .92, .83)   // sandstone / terracotta masonry
                      : archStyle < .84 ? vec3(.84, .88, .92)    // sleek charcoal / dark granite
                      : vec3(1.02, 1.01, .98);                   // crisp architectural white concrete
        wall *= archTint;
      }
      // Vertical architectural massing: darker lobby/plinth base, brighter upper exposure, crisp roof crown/parapet.
      float hNorm = clamp(vWall.y / max(H, 4.), 0., 1.);
      float podiumH = min(5.2, max(2.2, H * .16));
      wall *= mix(.64, 1., smoothstep(0., podiumH, vWall.y));
      wall *= mix(.86, 1.08, hNorm);
      float crownH = clamp(H * .065, 1.2, 3.8);
      float inCrown = smoothstep(H - crownH, H - crownH * .35, vWall.y);
      float corniceLine = smoothstep(H - crownH - 1.4, H - crownH - .2, vWall.y) * (1. - inCrown);
      wall *= 1. - .28 * corniceLine;
      wall = mix(wall, wall * (.78 + .32 * r2), inCrown * (wooden ? .35 : .85));
      // in densely built blocks the lower floors look onto narrow alleys and get little sky
      float block = smoothstep(.15, .65, builtAt(vWorld.xz, 30.));
      wall *= 1. - .38 * block * (1. - smoothstep(1., 11., vWall.y));

      // windows on a floor grid with directional anti-aliasing (oblique angles keep horizontal floor ribbons crisp!)
      float floorH = wooden ? 2.9 : (use == 4. || H > 28. ? 3.6 : 3.15);
      float cellW = wooden ? 2.4 : (use == 2. ? 3.4 : 2.85);
      vec2 g = vec2(wallAt.x / cellW, (wallAt.y - .5) / floorH);
      vec2 id = floor(g);
      vec2 f = fract(g);
      vec2 fw = fwWall / vec2(cellW, floorH);
      float wx = smoothstep(.16 - fw.x, .16 + fw.x, f.x) * (1. - smoothstep(.84 - fw.x, .84 + fw.x, f.x));
      float wy = smoothstep(.28 - fw.y, .28 + fw.y, f.y) * (1. - smoothstep(.86 - fw.y, .86 + fw.y, f.y));
      // Separate X and Y anti-aliasing so oblique walls preserve crisp horizontal window strips
      // instead of collapsing to a flat monotone box at 500 m.
      float tinyX = smoothstep(.16, .46, fw.x);
      float tinyY = smoothstep(.16, .46, fw.y);
      float tiny = tinyX * tinyY;
      float valid = mix(step(0., id.y) * step((id.y + 1.) * floorH, H - crownH * .45 + .5), step(1.2, vWall.y) * (1. - inCrown * .85), tinyY);
      float paneX = mix(wx, .62, tinyX);
      float paneY = mix(wy, .52, tinyY);
      float pane = paneX * paneY * valid;
      // old wooden houses only have a window here and there
      if (wooden) pane *= mix(step(.45, hash12(id + seed * 7.)), .55, max(tinyX, tinyY));

      // Concrete walls: each window sits in a recess. Seen at an angle the glass slides back from
      // the opening, so the opening's side and head show as darker concrete; the head also shades
      // the top of the glass, and a mullion splits the pane. Only while a window is big on screen.
      float deep = wooden ? 0. : 1. - smoothstep(.05, .16, max(fw.x, fw.y));
      float reveal = 0., head = 0., mullion = 0.;
      if (deep > 0.){
        float vn = max(dot(-v, n), .15);
        vec2 slide = vec2(dot(v, across) * alongSign, v.y) * .3 / vn / vec2(cellW, floorH);
        vec2 q = g - id + slide;
        float seen = step(.16, q.x) * step(q.x, .84) * step(.28, q.y) * step(q.y, .86);
        float hole = wx * wy * valid;
        reveal = hole * (1. - seen) * deep;
        head = smoothstep(.66, .86, q.y) * seen * deep;
        mullion = (1. - smoothstep(.008, .02, abs(q.x - .5))) * seen * deep;
        pane = mix(pane, pane * seen, deep);
      }

      // Modern commercial, office, hotel & high-rise towers get reflective glass curtain-wall facades.
      // Regional skyline buildings arrive with use==0, so also infer modern glass facades from height + seed.
      float inferredModern = wooden ? 0. : smoothstep(14., 36., H) * (.35 + .65 * step(.42, fract(seed * 19.37)));
      modernGlass = wooden ? 0. : clamp(max((use == 4. ? .86 : use == 2. ? .52 : 0.) + smoothstep(16., 42., H) * .55, inferredModern), 0., 1.);
      float curtain = modernGlass * smoothstep(.18, .82, modernGlass);
      if (curtain > .01) {
        // Curtain-wall glass spans wider across each floor with sleek aluminum mullions & dark spandrel bands.
        float cwX = mix(smoothstep(.04 - fw.x, .04 + fw.x, f.x) * (1. - smoothstep(.96 - fw.x, .96 + fw.x, f.x)), .82, tinyX);
        float cwY = mix(smoothstep(.15 - fw.y, .15 + fw.y, f.y) * (1. - smoothstep(.93 - fw.y, .93 + fw.y, f.y)), .68, tinyY);
        pane = mix(pane, cwX * cwY * valid, curtain * .85);
      }

      // Multi-scale architectural macro-facade texture for mid & far distances (500 m – 8 km):
      // Gaussian pre-filtered 2-floor & 4-floor spandrel bands + structural vertical bay columns
      // prevent buildings from collapsing into flat monotone grey boxes while staying 100% shimmer-free.
      if (!wooden) {
        float d2y = fw.y * .5, d4y = fw.y * .25, d3x = fw.x * .333;
        float ribbon2 = cos(6.283185 * (vWall.y - .5) / (floorH * 2.)) * exp(-d2y * d2y * 7.5);
        float ribbon4 = cos(6.283185 * (vWall.y - .5) / (floorH * 4.)) * exp(-d4y * d4y * 7.5);
        float colBay = cos(6.283185 * vWall.x / (cellW * 3.)) * exp(-d3x * d3x * 7.5);
        float midMask = smoothstep(.14, .44, max(fw.x, fw.y)) * valid;
        // Blend crisp architectural floor striations and structural vertical bay shadows into pane & wall tone.
        float macroPane = clamp(.52 + .24 * ribbon2 + .14 * ribbon4 - .13 * colBay * (1. - curtain * .5), .15, .92);
        pane = mix(pane, macroPane * valid, midMask * .62);
        // Subtle structural pier shading on concrete walls between bays & floors.
        wall *= 1. + midMask * (.08 * colBay + .07 * ribbon4);
      }

      // Glass reflection: mirror sky, clouds, horizon glow & solar/lunar specular glints on modern towers.
      float ndotv = clamp(dot(-v, n), 0., 1.);
      float fresnel = pow(1. - ndotv, 3.4);
      vec3 reflDir = reflect(v, n);
      reflDir.y = clamp(reflDir.y + .06, -.1, 1.);
      vec3 rNorm = normalize(reflDir);
      vec3 skyRefl = skyColor(rNorm);
      // Subtle reflected clouds & lower city horizon tone on vertical glass panes.
      if (rNorm.y > .04) {
        vec2 cUv = vWorld.xz * .000045 + rNorm.xz / max(rNorm.y + .22, .24) * .65 + vec2(uTime * .0014, 0.);
        float cBand = smoothstep(.46, .78, fbm(cUv * 2.1)) * smoothstep(.04, .32, rNorm.y);
        skyRefl = mix(skyRefl, mix(uCloudLight * .88 + uHorizon * .24, uHorizon * .45, uCity), cBand * .38);
      } else {
        skyRefl = mix(skyRefl, uHorizon * .42 + vec3(.03, .035, .04), smoothstep(.04, -.08, rNorm.y) * .65);
      }
      // Per-pane & per-floor glass tint variation (distinct blue-teal, slate-grey, bronze-tinted towers).
      float paneVar = mix(.85 + .30 * hash12(id + seed * 19.3), .92 + .16 * hash12(floor(id * vec2(.25, .5)) + seed * 13.7), tiny);
      vec3 towerGlass = pick4(fract(seed * 37.9), vec3(.018, .036, .056), vec3(.024, .034, .042), vec3(.036, .032, .028), vec3(.016, .044, .052));
      vec3 glassTint = mix(vec3(.022, .028, .036), towerGlass, modernGlass);
      vec3 glass = glassTint * paneVar;
      glass *= 1. - .52 * head * (1. - curtain * .65);
      glass = mix(glass, wall * .52, mullion * (1. - curtain * .55));
      float paneCoverage = pane * mix(.68 - .16 * tiny, .88 - .10 * tiny, modernGlass);
      albedo = mix(wall, glass, paneCoverage);
      albedo = mix(albedo, wall * (.42 + .2 * max(n.y, 0.)), reveal * (1. - curtain * .7));

      // Direct specular reflection added after diffuse shading so curtain-wall & mid-rise windows genuinely mirror the sky & sun.
      float skyscraperBoost = 1. + .38 * smoothstep(46., 110., H) * modernGlass;
      float reflAmt = mix(.06 + .24 * fresnel, .18 + .64 * fresnel, modernGlass) * paneCoverage * (1. - mullion * .7) * skyscraperBoost;
      float sunGlint = pow(max(dot(rNorm, uSunDir), 0.), mix(90., 42., modernGlass)) * (.16 + .58 * modernGlass) * skyscraperBoost;
      float moonGlint = pow(max(dot(rNorm, uMoonDir), 0.), 60.) * (1.1 + 1.8 * modernGlass);
      specRefl = skyRefl * reflAmt * paneVar * mix(1., .86, tiny)
               + (uSunLight * sunGlint + uMoonLight * moonGlint) * paneCoverage * (1. - mullion * .7) * sh;

      // Lit windows at night: crisp amber homes/hotels and cool offices across near, mid, AND far skylines
      // calibrated against the 0.12 night bloom threshold so cities sparkle vividly without fogging out.
      float awake = step(.16, fract(seed * 5.31));
      float urbanTall = smoothstep(14., 38., H);
      float effLit = max(uLit, .22);
      float rate = effLit * (wooden ? .48 : (.56 + .22 * urbanTall)) * (use == 4. ? 1.18 : 1.) * awake;
      // Multi-scale window-cluster LOD: preserve crisp illuminated window dashes/points across every distance
      // (1x1 near -> 2x1 -> 4x2 -> 8x2 far) without collapsing brightness or causing bloom whiteout.
      float cells = max(fw.x, fw.y);
      rate *= mix(1., .36, smoothstep(.2, 1.4, cells));
      float lod = clamp(log2(max(cells * 2.8, 1.)), 0., 3.);
      vec2 k0 = vec2(exp2(floor(lod)), 1.), k1 = vec2(min(k0.x * 2., 8.), 1.);
      k0.y = max(1., min(2., k0.x * .5)); k1.y = max(1., min(2., k1.x * .5));
      float lit0 = step(hash12(floor(id / k0) * vec2(1.7, 3.1) + seed * 31. + (k0.x - 1.) * .37), rate);
      float lit1 = step(hash12(floor(id / k1) * vec2(1.7, 3.1) + seed * 31. + (k1.x - 1.) * .37), rate);
      float lit = mix(lit0, lit1, fract(lod));
      lit = mix(lit, rate * .52, smoothstep(3.0, 6.5, cells));
      float coolMix = ((use == 4. || urbanTall > .45) ? .68 : .18) * mix(step(.38, hash12(id + seed)), .58, tiny);
      float litPane = mix(pane, max(pane, .64 * valid), smoothstep(.18, .55, cells));
      float farBoost = 1. + .16 * smoothstep(.25, 1.2, cells) * (wooden ? .2 : .75);
      emit += cityWindowRadiance(coolMix, wooden) * lit * litPane * (1. - mullion) * farBoost * .58;
      // Street-level commercial shopfronts & hotel/office lobbies glow warmly along urban blocks.
      float groundFloor = 1. - smoothstep(floorH * 1.1 - fwWall.y, floorH * 1.1 + fwWall.y, vWall.y - .4);
      bool commercialFront = (use == 3. || use == 5.) || (!wooden && H >= 7. && fract(seed * 11.37) > .42);
      if (commercialFront) {
        float shopFade = mix(.42, .09, smoothstep(.2, 1.6, cells));
        emit += WARM_WINDOW * groundFloor * mix(smoothstep(.1, .5, f.y), .75, tinyY) * step(0., vWall.y) * shopFade * uCity;
      }
      // Select tall skyscrapers (>=52 m) get subtle architectural parapet/crown accent uplighting at night.
      if (!wooden && H >= 52. && fract(seed * 17.31) > .56) {
        float crownAccent = smoothstep(H - 2.6, H - .5, vWall.y);
        vec3 crownCol = fract(seed * 41.7) > .45 ? vec3(.86, .92, 1.0) : vec3(1.0, .82, .56);
        emit += crownCol * crownAccent * .18 * uCity;
      }
      emit *= cityLightShimmer(vWorld);
    }

    albedo *= voxShade;

    // the campus, when it is in focus: clean white facades, a teal line along the roofs, teal windows at night
    if (campus > 0.){
      albedo = mix(albedo, vec3(.62, .66, .66), campus * .55);
      float roofline = smoothstep(H - 1.2, H - .2, vWall.y) * (roof ? 0. : 1.);
      vec3 teal = vec3(.39, .86, .9);
      emit += teal * roofline * campus * (1.2 + 2. * uCity);
      emit += teal * .25 * campus * (roof ? .4 : 1.) * (.4 + uCity);
    }

    vec3 col = shade(seasonalSurface(albedo,n,vWorld), n, vWorld, sh) + specRefl;
    gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
  }
`;

const DEPTH_FS = /* glsl */ `
  #include <packing>
  uniform float uCampusDetail;
  flat varying vec4 vInfo;
  void main(){
    if (vInfo.x > 767.5 && uCampusDetail > .5) discard;
    gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
  }
`;

/**
 * Shared material for Japanese rooftop aviation obstacle lights (航空障害灯) on high-rises.
 * Medium-intensity red beacons (>=115 m) pulse crisply; low-intensity red beacons (65–115 m)
 * burn faintly nearby and dissolve naturally into atmospheric haze at distance.
 */
export function aviationBeaconMaterial(env: Env): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: env,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      attribute vec2 aBeacon; // x: phase [0..1], y: flash (1 = pulsing medium-intensity, 0 = steady low-intensity)
      varying float vPower;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vec4 mv = viewMatrix * wp;
        float dist = max(35., -mv.z);
        float night = smoothstep(.18, .68, uCity);
        bool isMedium = aBeacon.y > .5;
        float pulse = isMedium
          ? (.12 + .88 * pow(.5 + .5 * sin(uTime * 3.1 + aBeacon.x * 6.28318), 3.0))
          : (.86 + .14 * sin(uTime * 1.4 + aBeacon.x * 12.566));
        // Realistic atmospheric distance falloff: low-intensity 32 cd bulbs fade by 5.2 km,
        // medium-intensity 2,000 cd flashing beacons soften cleanly before 11.5 km overlooks.
        float farFade = isMedium
          ? (1. - smoothstep(3800., 11500., dist))
          : (1. - smoothstep(1800., 5200., dist));
        vPower = night * pulse * farFade * (isMedium ? .68 : .42);
        float basePx = isMedium ? 680. : 420.;
        gl_PointSize = isMedium
          ? clamp(basePx / dist + 1.2, 1.5, 4.6)
          : clamp(basePx / dist + 1.0, 1.3, 3.4);
        gl_Position = vPower > .015 ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vPower;
      void main(){
        vec2 d = gl_PointCoord - .5;
        float r2 = dot(d, d);
        if (r2 > .25) discard;
        float core = exp(-r2 * 34.);
        float halo = exp(-r2 * 9.0) * .18;
        vec3 red = mix(vec3(1.0, .07, .03), vec3(1.0, .34, .18), core * .55);
        gl_FragColor = vec4(red * (core * 1.15 + halo) * vPower, 1.);
      }
    `,
  });
}

/** Build a lightweight Points cloud for rooftop aviation obstacle lights. */
export function aviationBeaconPoints(
  positions: Float32Array,
  meta: Float32Array,
  material: THREE.ShaderMaterial,
): THREE.Points | null {
  if (!positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aBeacon', new THREE.BufferAttribute(meta, 2));
  geo.computeBoundingSphere();
  const pts = new THREE.Points(geo, material);
  pts.name = 'aviation-beacons';
  return pts;
}

/* ---------- building the meshes ---------- */

function roofFor(b: BoxBuilding) {
  if (b.roof) return b.roof;
  if ((b.kind & 3) !== CLASS.wooden || b.h > 16) return { type: 0, rh: 0 };
  const area = b.w * b.d;
  if (area > 260) {
    // temple halls and big old buildings: tall hipped roofs
    return { type: 2, rh: Math.min(b.h * 0.55, b.d * 0.42) };
  }
  return { type: 1, rh: Math.min(Math.max(b.d * 0.26, 1.2), b.h * 0.4) };
}

function* instancedSteps(shape: THREE.InstancedBufferGeometry, list: PlacedHouse[], pitched: boolean) {
  const n = list.length;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(shape.index);
  for (const name of ['position', 'normal', 'aRole']) geo.setAttribute(name, shape.getAttribute(name));
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n * 3);
  const rot = new Float32Array(n);
  const meta = new Float32Array(n * 4);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = -Infinity, minY = Infinity;
  for(let i=0;i<n;i++){
    if(i && i%512===0)yield;
    const {b,y,seed,roofSource}=list[i];
    const r = pitched ? roofFor(roofSource ?? b) : { type: 0, rh: 0 };
    const { lift, inset } = separation(seed);
    const o3 = i * 3, o4 = i * 4;
    pos[o3] = b.x; pos[o3 + 1] = y; pos[o3 + 2] = b.z;
    size[o3] = Math.max(1, b.w - 2 * inset); size[o3 + 1] = b.h + lift; size[o3 + 2] = Math.max(1, b.d - 2 * inset);
    rot[i] = b.angle;
    const campus = inCampus(b.x, b.z) ? 256 + (isDetailed(b.kind, b.h, b.x, b.z) ? 512 : 0) : 0;
    meta[o4] = b.kind + campus; meta[o4 + 1] = seed; meta[o4 + 2] = r.type; meta[o4 + 3] = r.rh;
    if (b.x < minX) minX = b.x; if (b.x > maxX) maxX = b.x;
    if (b.z < minZ) minZ = b.z; if (b.z > maxZ) maxZ = b.z;
    const bottom = y - FOOTING, top = y + b.h + r.rh;
    if (bottom < minY) minY = bottom; if (top > maxY) maxY = top;
  }
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

function instanced(shape:THREE.InstancedBufferGeometry,list:PlacedHouse[],pitched:boolean){
  return finishSteps(instancedSteps(shape,list,pitched));
}

/** Distant regional streets share Kyoto's panorama unit meshes, window shader and roof profiles. */
export async function residentHouseBatch(env:Env,houses:PlacedHouse[],pitched:boolean,slots:number[],
  nearby:THREE.DataTexture,detail:{value:THREE.Vector4}){
  const sides=walls(1).filter(face=>face.n[0]>0 || face.n[2]>0);
  const shape=pitched?pitchedShape(sides):flatShape(sides);
  const geometry=await prepareSteps(instancedSteps(shape,houses,pitched));
  shape.dispose();
  geometry.setAttribute('iSlot',new THREE.InstancedBufferAttribute(new Uint8Array(slots),1));
  const material=new THREE.ShaderMaterial({uniforms:{...env,uNearby:{value:nearby},uDetail:detail},
    vertexShader:INSTANCE_VS,fragmentShader:BUILDING_FS,defines:{BLOCK_OVERVIEW:1,DISTRICT_HOUSES:1}});
  return new THREE.Mesh(geometry,material);
}

/** Walls and a triangulated flat roof for each outline, merged into one geometry. */
function* extrudedSteps(list: { p: PolyBuilding; y: number; seed: number }[]) {
  // Six wall vertices per edge and at most (m-2) roof triangles per simple ring.
  const capacity=list.reduce((n,{p})=>n+6*p.ring.length/2+3*Math.max(0,p.ring.length/2-2),0);
  const pos=new Float32Array(3*capacity),nrm=new Float32Array(3*capacity);
  const wall=new Float32Array(2*capacity),info=new Float32Array(4*capacity);
  let count=0,pointsSinceYield=0;
  /** Write one triangle of vertices (x,y,z,u,v) wound counter-clockwise around outward normal (nx,ny,nz). */
  const tri = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    nx: number, ny: number, nz: number,
    i0: number, i1: number, i2: number, i3: number,
  ) => {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const dot = (aby * acz - abz * acy) * nx + (abz * acx - abx * acz) * ny + (abx * acy - aby * acx) * nz;
    const flip = dot < 0;
    const p1x = flip ? cx : bx, p1y = flip ? cy : by, p1z = flip ? cz : bz, p1u = flip ? cu : bu, p1v = flip ? cv : bv;
    const p2x = flip ? bx : cx, p2y = flip ? by : cy, p2z = flip ? bz : cz, p2u = flip ? bu : cu, p2v = flip ? bv : cv;
    let o3 = count * 3, o2 = count * 2, o4 = count * 4;
    pos[o3] = ax; pos[o3 + 1] = ay; pos[o3 + 2] = az;
    pos[o3 + 3] = p1x; pos[o3 + 4] = p1y; pos[o3 + 5] = p1z;
    pos[o3 + 6] = p2x; pos[o3 + 7] = p2y; pos[o3 + 8] = p2z;
    nrm[o3] = nx; nrm[o3 + 1] = ny; nrm[o3 + 2] = nz;
    nrm[o3 + 3] = nx; nrm[o3 + 4] = ny; nrm[o3 + 5] = nz;
    nrm[o3 + 6] = nx; nrm[o3 + 7] = ny; nrm[o3 + 8] = nz;
    wall[o2] = au; wall[o2 + 1] = av;
    wall[o2 + 2] = p1u; wall[o2 + 3] = p1v;
    wall[o2 + 4] = p2u; wall[o2 + 5] = p2v;
    info[o4] = i0; info[o4 + 1] = i1; info[o4 + 2] = i2; info[o4 + 3] = i3;
    info[o4 + 4] = i0; info[o4 + 5] = i1; info[o4 + 6] = i2; info[o4 + 7] = i3;
    info[o4 + 8] = i0; info[o4 + 9] = i1; info[o4 + 10] = i2; info[o4 + 11] = i3;
    count += 3;
  };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const { p, y, seed } of list) {
    const r = p.ring;
    const m = r.length / 2;
    if(pointsSinceYield>=256){yield;pointsSinceYield=0;}
    pointsSinceYield+=m;
    const top = y + p.h + separation(seed).lift;
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
      cx += r[i * 2];
      cz += r[i * 2 + 1];
    }
    cx /= m; cz /= m;
    const campus = inCampus(cx, cz) ? 256 + (isDetailed(p.kind, p.h, cx, cz) ? 512 : 0) : 0;
    const i0 = p.kind + campus, i1 = seed, i2 = p.h;
    if (bottom < minY) minY = bottom;
    if (top > maxY) maxY = top;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = (out * (bz - az)) / len, nz = (-out * (bx - ax)) / len;
      const u0 = along, u1 = along + len;
      tri(ax, bottom, az, u0, -FOOTING, bx, bottom, bz, u1, -FOOTING, bx, top, bz, u1, p.h, nx, 0, nz, i0, i1, i2, 0);
      tri(ax, bottom, az, u0, -FOOTING, bx, top, bz, u1, p.h, ax, top, az, u0, p.h, nx, 0, nz, i0, i1, i2, 0);
      along = u1;
      if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
      if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
    }
    const contour: THREE.Vector2[] = new Array(m);
    for (let i = 0; i < m; i++) contour[i] = new THREE.Vector2(r[i * 2], r[i * 2 + 1]);
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const a = contour[t[0]], b = contour[t[1]], c = contour[t[2]];
      tri(a.x, top, a.y, a.x, a.y, b.x, top, b.y, b.x, b.y, c.x, top, c.y, c.x, c.y, 0, 1, 0, i0, i1, i2, 3);
    }
  }
  const box = minX <= maxX ? new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)) : new THREE.Box3();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0,count*3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0,count*3), 3));
  geo.setAttribute('aWall', new THREE.BufferAttribute(wall.subarray(0,count*2), 2));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info.subarray(0,count*4), 4));
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return geo;
}

/**
 * `keep` can thin out the boxes (phones leave out small houses far from the viewpoint);
 * `dressed` buildings have facades modelled elsewhere and get no facade or roof details.
 */
type PanoramaEye = { x: number; z: number };

/** Keep the same measured positions and facade seeds when changing the unit mesh. */
function instanceShape(shape: THREE.InstancedBufferGeometry, source: THREE.InstancedBufferGeometry) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(shape.index);
  for (const name of ['position', 'normal', 'aRole', 'aLevel']) geometry.setAttribute(name, shape.getAttribute(name));
  for (const name of ['iPos', 'iSize', 'iRot', 'iMeta']) geometry.setAttribute(name, source.getAttribute(name));
  geometry.instanceCount = source.instanceCount;
  geometry.boundingBox = source.boundingBox;
  geometry.boundingSphere = source.boundingSphere;
  return geometry;
}

export function* buildCitySteps(env: Env, hf: Pick<Heightfield,'height'>, data: CityData, keep: (b: BoxBuilding) => boolean, quality: number, dressed: CityPredicate=()=>false, panoramaEye?: PanoramaEye, replaceable?: ReadonlySet<BoxBuilding | PolyBuilding>, emitBeacons = true) {
  const group = new THREE.Group();
  const fallback = new THREE.Group();
  if (replaceable) group.add(fallback);
  const detailMat = detailMaterial(env, VOXEL);
  // beyond these the parts are thinner than a pixel
  const detailMid = quality > 0.75 ? 950 : 650;
  const detailNear = quality > 0.75 ? 450 : 300;
  const instMat = new THREE.ShaderMaterial({ uniforms: env, vertexShader: INSTANCE_VS, fragmentShader: BUILDING_FS });
  const polyMat = new THREE.ShaderMaterial({ uniforms: env, vertexShader: POLY_VS, fragmentShader: BUILDING_FS });
  const instDepth = new THREE.ShaderMaterial({ uniforms:env, vertexShader: INSTANCE_VS, fragmentShader: DEPTH_FS });
  const polyDepth = new THREE.ShaderMaterial({ uniforms:env, vertexShader: POLY_VS, fragmentShader: DEPTH_FS });
  const stepMat = new THREE.ShaderMaterial({ uniforms: env, vertexShader: INSTANCE_VS, fragmentShader: BUILDING_FS, defines: { STEPPED: 1 } });
  const stepDepth = new THREE.ShaderMaterial({ uniforms:env, vertexShader: INSTANCE_VS, fragmentShader: DEPTH_FS, defines: { STEPPED: 1 } });
  const beaconMat = emitBeacons ? aviationBeaconMaterial(env) : null;
  const beaconPos: number[] = [];
  const beaconMeta: number[] = [];
  const flat = flatShape();
  const pitched = pitchedShape();
  const stepped = steppedShape();
  const overview = panoramaEye ? new THREE.Group() : null;
  const facingWalls = walls(1).filter(face => face.n[0] > 0 || face.n[2] > 0);
  const proxyShapes = overview ? { flat: flatShape(facingWalls), pitched: pitchedShape(facingWalls) } : null;
  const proxyMaterial = overview ? new THREE.ShaderMaterial({ uniforms: env, vertexShader: INSTANCE_VS, fragmentShader: BUILDING_FS, defines: { BLOCK_OVERVIEW: 1 } }) : null;
  const blocks: { proxy: THREE.Group; originals: THREE.Mesh[]; distance: number }[] = [];
  let complete=false;
  try {
  /** Pairs of the same houses: stepped roofs for chunks near the camera, plain slopes beyond. */
  const roofLods: { near: THREE.Mesh; far: THREE.Mesh; x: number; z: number }[] = [];

  type Chunk = { x: number; z: number; parent: THREE.Group; flat: PlacedHouse[]; pitched: PlacedHouse[]; polys: { p: PolyBuilding; y: number; seed: number }[] };
  const chunks = new Map<string, Chunk>();
  const chunkOf = (x: number, z: number, building: BoxBuilding | PolyBuilding) => {
    const proxy = replaceable?.has(building);
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}${proxy ? ':fallback' : ''}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { x: (Math.floor(x / CHUNK) + .5) * CHUNK, z: (Math.floor(z / CHUNK) + .5) * CHUNK, parent: proxy ? fallback : group, flat: [], pitched: [], polys: [] }));
    return c;
  };
  for(let i=0;i<data.boxes.length;i++) {
    if(i && i%512===0)yield;
    const b=data.boxes[i];
    if (!keep(b)) continue;
    const y = hf.height(b.x, b.z) + b.ground;
    const seed = hash1(i * 7 + 3);
    const c = chunkOf(b.x, b.z, b);
    if (roofFor(b).type > 0) c.pitched.push({ b, y, seed });
    else c.flat.push({ b, y, seed });
    if (emitBeacons && b.h >= 65 && b.w * b.d >= 180 && (b.kind & 3) !== CLASS.wooden && !dressed(b)) {
      const top = y + b.h + 1.9;
      const flash = b.h >= 115 ? 1 : 0;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const hw = b.w * 0.42, hd = b.d * 0.42;
      if (b.h >= 135) {
        beaconPos.push(b.x + ca * hw - sa * hd, top, b.z + sa * hw + ca * hd);
        beaconMeta.push(seed, flash);
        beaconPos.push(b.x - ca * hw + sa * hd, top, b.z - sa * hw - ca * hd);
        beaconMeta.push(seed, flash);
      } else {
        beaconPos.push(b.x, top, b.z);
        beaconMeta.push(seed, flash);
      }
    }
  }
  for(let i=0;i<data.polys.length;i++) {
    if(i && i%512===0)yield;
    const p=data.polys[i];
    const cx = p.ring[0];
    const cz = p.ring[1];
    const y = hf.height(cx, cz) + p.ground;
    const seed = hash1(i * 13 + 5);
    chunkOf(cx, cz, p).polys.push({ p, y, seed });
    if (emitBeacons && p.h >= 65 && (p.kind & 3) !== CLASS.wooden && !dressed(p)) {
      let mx = 0, mz = 0, area2 = 0;
      const m = p.ring.length / 2;
      for (let k = 0; k < m; k++) {
        const j = (k + 1) % m;
        mx += p.ring[k * 2]; mz += p.ring[k * 2 + 1];
        area2 += p.ring[k * 2] * p.ring[j * 2 + 1] - p.ring[j * 2] * p.ring[k * 2 + 1];
      }
      if (Math.abs(area2) * 0.5 >= 180) {
        beaconPos.push(mx / m, y + p.h + 1.9, mz / m);
        beaconMeta.push(seed, p.h >= 115 ? 1 : 0);
      }
    }
  }

  /**
   * Facade and roof details, in tiles modelled the first time the camera comes near them: the
   * small parts (ledges, balconies) show close to the camera, the rest a little further out.
   * The parts are under a metre thick, finer than a texel of the sun's shadow map, so none casts one.
   */
  type Tile = { x: number; y: number; z: number; parent: THREE.Group; flat: Chunk['flat']; polys: Chunk['polys']; done: boolean; near: THREE.Mesh | null; mid: THREE.Mesh | null };
  const tiles = new Map<string, Tile>();
  const tileOf = (x: number, z: number, parent: THREE.Group) => {
    const kx = Math.floor(x / DETAIL_TILE), kz = Math.floor(z / DETAIL_TILE);
    const key = `${kx},${kz}${parent === fallback ? ':fallback' : ''}`;
    let t = tiles.get(key);
    if (!t) {
      const cx = (kx + 0.5) * DETAIL_TILE, cz = (kz + 0.5) * DETAIL_TILE;
      tiles.set(key, (t = { x: cx, y: hf.height(cx, cz), z: cz, parent, flat: [], polys: [], done: false, near: null, mid: null }));
    }
    return t;
  };
  let tiled=0;
  for (const c of chunks.values()) {
    for (const e of c.flat) { if(++tiled%512===0)yield; if (!inCampus(e.b.x, e.b.z) && !dressed(e.b)) tileOf(e.b.x, e.b.z, c.parent).flat.push(e); }
    for (const e of c.polys) { if(++tiled%512===0)yield; if (!inCampus(e.p.ring[0], e.p.ring[1]) && !dressed(e.p)) tileOf(e.p.ring[0], e.p.ring[1], c.parent).polys.push(e); }
  }
  const modelDetails = (t: Tile) => {
    const lists = { near: new DetailList(), mid: new DetailList() };
    for (const { b, y, seed } of t.flat) {
      const { lift, inset } = separation(seed);
      boxDetails(lists, b, Math.max(1, b.w - 2 * inset), Math.max(1, b.d - 2 * inset), b.h + lift, y, seed);
    }
    for (const { p, y, seed } of t.polys) polyDetails(lists, p.ring, p.kind, p.h + separation(seed).lift, y, seed);
    const mesh = (list: DetailList) => {
      if (!list.count) return null;
      const m = detailMesh(list, detailMat);
      m.visible = false;
      t.parent.add(m);
      return m;
    };
    t.near = mesh(lists.near);
    t.mid = mesh(lists.mid);
    t.done = true;
  };

  const blockGeometry = (shape: THREE.InstancedBufferGeometry, full: THREE.InstancedBufferGeometry, houses: PlacedHouse[], hasRoofs: boolean) => {
    const compact = panoramaHouses(houses, b => dressed(b) || inCampus(b.x, b.z));
    return compact.length === houses.length ? instanceShape(shape, full) : instanced(shape, compact, hasRoofs);
  };
  for (const c of chunks.values()) {
    yield;
    const add = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, depth: THREE.ShaderMaterial) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.depthMaterial = depth;
      c.parent.add(mesh);
      return mesh;
    };
    let block: (typeof blocks)[number] | undefined;
    if (panoramaEye && overview && c.parent !== fallback && (c.flat.length || c.pitched.length)) {
      const west = panoramaEye.x - c.x, across = Math.abs(panoramaEye.z - c.z);
      const distance = Math.hypot(Math.max(0, west - CHUNK / 2), Math.max(0, across - CHUNK / 2));
      if (west > CHUNK / 2 && across < west * 1.25 && distance >= 850) {
        block = { proxy: new THREE.Group(), originals: [], distance };
        block.proxy.visible = false;
        overview.add(block.proxy);
        blocks.push(block);
      }
    }
    if (c.flat.length) {
      const full = instanced(flat, c.flat, false);
      const mesh = add(full, instMat, instDepth);
      if (block && proxyShapes && proxyMaterial) {
        block.originals.push(mesh);
        block.proxy.add(new THREE.Mesh(blockGeometry(proxyShapes.flat, full, c.flat, false), proxyMaterial));
      }
    }
    if (c.polys.length) add(yield* extrudedSteps(c.polys), polyMat, polyDepth);
    if (c.pitched.length) {
      const far = instanced(pitched, c.pitched, true);
      // the stepped houses share the far set's per-house data
      const near = instanceShape(stepped, far);
      const center = far.boundingSphere!.center;
      const pair = { far: add(far, instMat, instDepth), near: add(near, stepMat, stepDepth), x: center.x, z: center.z };
      pair.near.visible = false;
      roofLods.push(pair);
      if (block && proxyShapes && proxyMaterial) {
        block.originals.push(pair.near, pair.far);
        block.proxy.add(new THREE.Mesh(blockGeometry(proxyShapes.pitched, far, c.pitched, true), proxyMaterial));
      }
    }
  }
  if (beaconMat && beaconPos.length) {
    const beacons = aviationBeaconPoints(new Float32Array(beaconPos), new Float32Array(beaconMeta), beaconMat);
    if (beacons) group.add(beacons);
  }
  complete=true;
  return {
    group, overview, fallback,
    // Streamed street tiles also own materials for details that are created later.
    materials: [instMat, polyMat, stepMat, detailMat],
    dispose(){
      group.traverse(object=>{if(object instanceof THREE.Mesh || object instanceof THREE.Points)object.geometry.dispose();});
      overview?.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose();});
      for(const material of [instMat,polyMat,stepMat,detailMat,instDepth,polyDepth,stepDepth,proxyMaterial,beaconMat])material?.dispose();
      flat.dispose();pitched.dispose();stepped.dispose();
    },
    /**
     * Swap stepped and plain roofs, and show facade details, by distance from the camera; call once
     * a frame. True when the roofs changed (the sun's shadow map needs redrawing).
     */
    updateLod(eye: { x: number; y: number; z: number }, panoramaFocalPixels = 0,
      scheduleDetail?:(distance:number,build:()=>void)=>void) {
      let changed = false;
      for (const block of blocks) {
        // Keep full geometry where a 1.5 m detail still spans a screen pixel.
        const use = panoramaFocalPixels > 0 && block.distance > 1.5 * panoramaFocalPixels;
        if (use === block.proxy.visible) continue;
        block.proxy.visible = use;
        // Layer 1 still draws the measured buildings into the sun shadow map.
        for (const mesh of block.originals) if (use) mesh.layers.disable(0); else mesh.layers.enable(0);
      }
      for (const l of roofLods) {
        const near = Math.hypot(l.x - eye.x, l.z - eye.z) < STEPPED_NEAR;
        if (l.near.visible === near) continue;
        l.near.visible = near;
        l.far.visible = !near;
        changed = true;
      }
      // one tile's details are modelled per frame, the nearest first, so flying into a new area never stalls
      let next: Tile | null = null, nextD = detailMid;
      for (const t of tiles.values()) {
        if (!t.parent.visible) continue;
        const d = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
        if (!t.done && d < nextD) {
          next = t;
          nextD = d;
        }
        if (t.mid) t.mid.visible = d < detailMid;
        if (t.near) t.near.visible = d < detailNear;
      }
      if (next) {
        const tile=next;
        const build=()=>{
          modelDetails(tile);
          if (tile.mid) tile.mid.visible = true;
          if (tile.near) tile.near.visible = nextD < detailNear;
        };
        if(scheduleDetail)scheduleDetail(nextD,build);else build();
      }
      return changed;
    },
  };
  } finally {
    if(!complete){
      group.traverse(object=>{if(object instanceof THREE.Mesh || object instanceof THREE.Points)object.geometry.dispose();});
      overview?.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      proxyMaterial?.dispose();
      beaconMat?.dispose();
      for(const material of [detailMat,instMat,polyMat,instDepth,polyDepth,stepMat,stepDepth])material.dispose();
      flat.dispose();pitched.dispose();stepped.dispose();
    }
  }
}

/** Street furniture on facades is built on approach. Link its material with the roofs
 * before rendering the first close-up, without allocating any of the detail geometry. */
export function prepareCityMaterials(materials:THREE.Material[],prepare:(mesh:THREE.Object3D)=>Promise<unknown>){
  const layout=new THREE.BufferGeometry();
  layout.setAttribute('position',new THREE.Float32BufferAttribute([],3));
  layout.setAttribute('normal',new THREE.Float32BufferAttribute([],3));
  return prepare(new THREE.Mesh(layout,materials)).finally(()=>layout.dispose());
}

type CityData = { boxes: BoxBuilding[]; polys: PolyBuilding[] };
type CityPredicate = (b: BoxBuilding | PolyBuilding) => boolean;
export function buildCity(env:Env,hf:Pick<Heightfield,'height'>,data:CityData,keep:(b:BoxBuilding)=>boolean=()=>true,quality=1,dressed:CityPredicate=()=>false) {
  const steps=buildCitySteps(env,hf,data,keep,quality,dressed);
  for(;;){const step=steps.next();if(step.done)return step.value;}
}

/** Keep the renderer responsive while a neighbouring region builds its city. */
export async function buildCityAsync(env:Env,hf:Pick<Heightfield,'height'>,data:CityData,keep:(b:BoxBuilding)=>boolean,quality:number,current:()=>boolean,dressed:CityPredicate=()=>false,panoramaEye?:PanoramaEye,replaceable?:ReadonlySet<BoxBuilding | PolyBuilding>,emitBeacons=true) {
  const steps=buildCitySteps(env,hf,data,keep,quality,dressed,panoramaEye,replaceable,emitBeacons);
  try {
    while(current()){
      const deadline=performance.now()+5;
      do {const step=steps.next();if(step.done)return step.value;} while(current()&&performance.now()<deadline);
      await yieldTask();
    }
    return null;
  } finally {steps.return(undefined as never);}
}

/** Resident rooflines use the same outlines, roof shapes and night windows as the core.
 * Only nearby regional models need individual balconies, stepped tiles and shadow-map submissions. */
export async function buildResidentCity(env:Env,hf:Pick<Heightfield,'height'>,data:CityData,extent?:Box,step:()=>Promise<void>=yieldTask) {
  const mesh=new THREE.Group();
  const uniforms={...env,uDetailBox:{value:new THREE.Vector4()}};
  const material=(vertexShader:string)=>new THREE.ShaderMaterial({
    uniforms,vertexShader,fragmentShader:BUILDING_FS,defines:extent?{REGIONAL_OVERVIEW:1}:{},
  });
  const houses=material(INSTANCE_VS),polygons=material(POLY_VS);
  const flat=flatShape(),pitched=pitchedShape();
  type Tile={flat:PlacedHouse[];pitched:PlacedHouse[];polys:{p:PolyBuilding;y:number;seed:number}[]};
  const tiles=new Map<string,Tile>();
  const tileAt=(x:number,z:number)=>{
    const key=Math.floor(x/CHUNK)+','+Math.floor(z/CHUNK);
    let t=tiles.get(key);
    if(!t){t={flat:[],pitched:[],polys:[]};tiles.set(key,t);}
    return t;
  };
  let deadline=performance.now()+5;
  for(const [i,b] of data.boxes.entries()){
    const tile=tileAt(b.x,b.z);
    (roofFor(b).type?tile.pitched:tile.flat).push({b,y:hf.height(b.x,b.z)+b.ground,seed:hash1(i*7+3)});
    if(performance.now()>deadline){await step();deadline=performance.now()+5;}
  }
  for(const [i,p] of data.polys.entries()){
    const x=p.ring[0],z=p.ring[1];
    tileAt(x,z).polys.push({p,y:hf.height(x,z)+p.ground,seed:hash1(i*13+5)});
    if(performance.now()>deadline){await step();deadline=performance.now()+5;}
  }
  const batches:THREE.Mesh[]=[];
  for(const t of tiles.values()){
    if(t.flat.length)batches.push(new THREE.Mesh(instanced(flat,t.flat,false),houses));
    if(t.pitched.length)batches.push(new THREE.Mesh(instanced(pitched,t.pitched,true),houses));
    if(t.polys.length){
      const steps=extrudedSteps(t.polys);
      for(;;){
        const next=steps.next();
        if(next.done){batches.push(new THREE.Mesh(next.value,polygons));break;}
        if(performance.now()>deadline){await step();deadline=performance.now()+5;}
      }
    }
    if(performance.now()>deadline){await step();deadline=performance.now()+5;}
  }
  for(const batch of batches){
    if(!batch.geometry.boundingBox)batch.geometry.computeBoundingBox();
    mesh.add(batch);
  }
  return {mesh,setDetailBox(box:Box|null){
    uniforms.uDetailBox.value.fromArray(box??[0,0,0,0]);
    mesh.visible=!(box&&extent&&box[0]<=extent[0]&&box[1]<=extent[1]&&box[2]>=extent[2]&&box[3]>=extent[3]);
    if(mesh.visible)for(const batch of batches){
      const bounds=batch.geometry.boundingBox!;
      batch.visible=!(box&&bounds.min.x>=box[0]&&bounds.min.z>=box[1]&&bounds.max.x<box[2]&&bounds.max.z<box[3]);
    }
  }};
}
