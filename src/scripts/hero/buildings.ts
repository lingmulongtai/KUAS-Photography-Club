import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { CLASS, type BoxBuilding, type PolyBuilding } from './buildings-data';
import { hash1 } from './util';
import { inCampus } from './geo';
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
  const tri = (a: number[], b: number[], c: number[], n: number[], r: number, l: number) => {
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
      level.push(l);
    }
  };
  for (const f of faces) {
    const l = f.level ?? 0.5;
    if (f.pts.length === 3) tri(f.pts[0], f.pts[1], f.pts[2], f.n, f.role, l);
    else {
      tri(f.pts[0], f.pts[1], f.pts[2], f.n, f.role, l);
      tri(f.pts[0], f.pts[2], f.pts[3], f.n, f.role, l);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
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
    vec3 p = position;
    float w = iSize.x, h = iSize.y, d = iSize.z;
    float roof = iMeta.z;
    float rh = iMeta.w;
    float hip = step(1.5, roof);
    float eave = roof > .5 ? h - rh * .5 : h;
    vec3 n = normal;
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

    float c = cos(iRot), s = sin(iRot);
    mat2 R = mat2(c, s, -s, c);
    vec2 wxz = R * xz;
    vec2 wn = R * n.xz;
    vec3 world = vec3(iPos.x + wxz.x, iPos.y + y, iPos.z + wxz.y);
    vWorld = world;
    vNormal = normalize(vec3(wn.x, n.y, wn.y));
    float along = abs(normal.x) > .5 ? p.z * d + 31. * sign(normal.x) : p.x * w + 17. * sign(normal.z);
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

const BUILDING_FS = /* glsl */ `
  ${ENV_GLSL}
  ${SHADOW_GLSL}
  ${BUILT_GLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vWall;
  flat varying vec4 vInfo;
  ${WALL_GLSL}

  void main(){
    vec3 n = normalize(vNormal);
    // everything that takes screen-space derivatives runs first, before any branch or discard
    float sh = sunShadow(vWorld, n);
    vec2 fwWall = fwidth(vWall);
    // which way along a wall its coordinate runs, for the depth of the window recesses
    vec3 across = normalize(vec3(-n.z, 0., n.x) + 1e-5);
    vec2 dWall = vec2(dFdx(vWall.x), dFdy(vWall.x));
    float alongSign = dot(dFdx(vWorld), across) * dWall.x + dot(dFdy(vWorld), across) * dWall.y < 0. ? -1. : 1.;
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
    if (roof){
      if (wooden || role < 2.5){
        // kawara: blue-grey tiles, a few newer brown or slate roofs
        albedo = pick4(r1, vec3(.055, .06, .068), vec3(.075, .078, .085), vec3(.045, .046, .05), vec3(.09, .065, .05));
        // rows of tiles, faded to their average once a row is thinner than a couple of pixels
        float rows = 1. - smoothstep(.15, .4, max(fwWall.x * .6, fwWall.y * 3.));
        albedo *= .9 + .25 * mix(.5, vnoise(vWall * vec2(.6, 3.)), rows);
      } else {
        // flat concrete roofs, some darker waterproofing
        albedo = pick4(r1, vec3(.12, .13, .14), vec3(.18, .17, .15), vec3(.095, .12, .14), vec3(.23, .22, .19));
        albedo *= .85 + .3 * mix(.5, vnoise(vWorld.xz * .15 + seed), 1. - smoothstep(.2, .5, fwWall.x * .15));
      }
    } else {
      vec3 wall = wallColor(kind, seed, H);
      // A darker plinth and the shadow below the eaves make a facade read as a building.
      wall *= mix(.73,1.,smoothstep(0.,2.,vWall.y));
      wall *= 1. - .22 * smoothstep(H-1.1,H-.15,vWall.y);
      // in densely built blocks the lower floors look onto narrow alleys and get little sky
      float block = smoothstep(.15, .65, builtAt(vWorld.xz, 30.));
      wall *= 1. - .38 * block * (1. - smoothstep(1., 11., vWall.y));

      // windows on a floor grid
      float floorH = wooden ? 2.9 : (use == 4. ? 3.7 : 3.1);
      float cellW = wooden ? 2.4 : (use == 2. ? 3.4 : 2.9);
      vec2 g = vec2(wallAt.x / cellW, (wallAt.y - .5) / floorH);
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

      // Concrete walls: each window sits in a recess. Seen at an angle the glass slides back from
      // the opening, so the opening's side and head show as darker concrete; the head also shades
      // the top of the glass, and a mullion splits the pane. Only while a window is big on screen.
      float deep = wooden ? 0. : 1. - smoothstep(.05, .14, max(fw.x, fw.y));
      float reveal = 0., head = 0., mullion = 0.;
      if (deep > 0.){
        float vn = max(dot(-v, n), .15);
        vec2 slide = vec2(dot(v, across) * alongSign, v.y) * .3 / vn / vec2(cellW, floorH);
        vec2 q = g - id + slide;
        float seen = step(.18, q.x) * step(q.x, .82) * step(.32, q.y) * step(q.y, .86);
        float hole = wx * wy * valid;
        reveal = hole * (1. - seen) * deep;
        head = smoothstep(.66, .86, q.y) * seen * deep;
        mullion = (1. - smoothstep(.008, .02, abs(q.x - .5))) * seen * deep;
        pane = mix(pane, pane * seen, deep);
      }

      // glass by day: darker panes that pick up a little sky
      float glassRefl = .03 + .18 * pow(clamp(1. - dot(-v, n), 0., 1.), 4.);
      vec3 glass = vec3(.025, .03, .035) + skyColor(reflect(v, n)) * glassRefl * (1. - tiny);
      glass *= 1. - .55 * head;
      glass = mix(glass, wall * .55, mullion);
      albedo = mix(wall, glass, pane * (.6 - .3 * tiny));
      albedo = mix(albedo, wall * (.42 + .2 * max(n.y, 0.)), reveal);

      // lit windows at night: warm homes and hotels, cooler offices. Some buildings are dark.
      float awake = step(.22, fract(seed * 5.31));
      float rate = uLit * (wooden ? .8 : 1.) * (use == 4. ? 1.3 : 1.) * awake;
      // Once single windows shrink under a few pixels, groups of rooms along a floor (2, then 4
      // windows wide) switch together, so every distance keeps points of light a few pixels
      // across. Fewer groups light than single windows would, so the city stays dark masses
      // with points of light rather than a lit sheet. Neighbouring group sizes cross-fade
      // without popping, and only beyond that does a facade fade to a dim average.
      float cells = max(fw.x, fw.y);
      rate *= mix(1., .25, tiny);
      float lod = clamp(log2(max(cells * 3., 1.)), 0., 2.);
      vec2 k0 = vec2(exp2(floor(lod)), 1.), k1 = vec2(min(k0.x * 2., 4.), 1.);
      k0.y = max(1., k0.x * .5); k1.y = max(1., k1.x * .5);
      float lit0 = step(hash12(floor(id / k0) * vec2(1.7, 3.1) + seed * 31. + (k0.x - 1.) * .37), rate);
      float lit1 = step(hash12(floor(id / k1) * vec2(1.7, 3.1) + seed * 31. + (k1.x - 1.) * .37), rate);
      float lit = mix(lit0, lit1, fract(lod));
      lit = mix(lit, rate * .4, smoothstep(1.4, 2.8, cells));
      vec3 warm = vec3(1., .58, .26);
      vec3 cool = vec3(.95, .85, .7);
      vec3 lampCol = mix(warm, cool, (use == 4. ? .8 : .15) * mix(step(.4, hash12(id + seed)), .6, tiny));
      // bright enough to glow through the haze from the hills, not so bright they burn out up close
      float strength = wooden ? .75 : 1.05;
      emit += lampCol * lit * pane * (1. - mullion) * strength * uCity;
      // shopfronts glow along the street
      float groundFloor=1.-smoothstep(floorH-fwWall.y,floorH+fwWall.y,vWall.y-.5);
      if (use == 3. || use == 5.) emit += warm * groundFloor * mix(smoothstep(.1,.5,f.y),.7,tiny) * valid * mix(1.2,.05,tiny) * uCity;
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

    vec3 col = shade(seasonalSurface(albedo,n,vWorld), n, vWorld, sh);
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
    const { lift, inset } = separation(seed);
    pos.set([b.x, y, b.z], i * 3);
    size.set([Math.max(1, b.w - 2 * inset), b.h + lift, Math.max(1, b.d - 2 * inset)], i * 3);
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

/**
 * `keep` can thin out the boxes (phones leave out small houses far from the viewpoint);
 * `dressed` buildings have facades modelled elsewhere and get no facade or roof details.
 */
export function buildCity(env: Env, hf: Heightfield, data: { boxes: BoxBuilding[]; polys: PolyBuilding[] }, keep: (b: BoxBuilding) => boolean = () => true, quality = 1, dressed: (b: BoxBuilding | PolyBuilding) => boolean = () => false) {
  const group = new THREE.Group();
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
  const flat = flatShape();
  const pitched = pitchedShape();
  const stepped = steppedShape();
  /** Pairs of the same houses: stepped roofs for chunks near the camera, plain slopes beyond. */
  const roofLods: { near: THREE.Mesh; far: THREE.Mesh; x: number; z: number }[] = [];

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

  /**
   * Facade and roof details, in tiles modelled the first time the camera comes near them: the
   * small parts (ledges, balconies) show close to the camera, the rest a little further out.
   * The parts are under a metre thick, finer than a texel of the sun's shadow map, so none casts one.
   */
  type Tile = { x: number; y: number; z: number; flat: Chunk['flat']; polys: Chunk['polys']; done: boolean; near: THREE.Mesh | null; mid: THREE.Mesh | null };
  const tiles = new Map<string, Tile>();
  const tileOf = (x: number, z: number) => {
    const kx = Math.floor(x / DETAIL_TILE), kz = Math.floor(z / DETAIL_TILE);
    const key = `${kx},${kz}`;
    let t = tiles.get(key);
    if (!t) {
      const cx = (kx + 0.5) * DETAIL_TILE, cz = (kz + 0.5) * DETAIL_TILE;
      tiles.set(key, (t = { x: cx, y: hf.height(cx, cz), z: cz, flat: [], polys: [], done: false, near: null, mid: null }));
    }
    return t;
  };
  for (const c of chunks.values()) {
    for (const e of c.flat) if (!inCampus(e.b.x, e.b.z) && !dressed(e.b)) tileOf(e.b.x, e.b.z).flat.push(e);
    for (const e of c.polys) if (!inCampus(e.p.ring[0], e.p.ring[1]) && !dressed(e.p)) tileOf(e.p.ring[0], e.p.ring[1]).polys.push(e);
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
      group.add(m);
      return m;
    };
    t.near = mesh(lists.near);
    t.mid = mesh(lists.mid);
    t.done = true;
  };

  for (const c of chunks.values()) {
    const meshes: [THREE.BufferGeometry, THREE.ShaderMaterial, THREE.ShaderMaterial][] = [];
    if (c.flat.length) meshes.push([instanced(flat, c.flat, false), instMat, instDepth]);
    if (c.polys.length) meshes.push([extruded(c.polys), polyMat, polyDepth]);
    const add = ([geo, mat, depth]: (typeof meshes)[number]) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.depthMaterial = depth;
      group.add(mesh);
      return mesh;
    };
    meshes.forEach(add);
    if (c.pitched.length) {
      const far = instanced(pitched, c.pitched, true);
      // the stepped houses share the far set's per-house data
      const near = new THREE.InstancedBufferGeometry();
      for (const name of ['position', 'normal', 'aRole', 'aLevel']) near.setAttribute(name, stepped.getAttribute(name));
      for (const name of ['iPos', 'iSize', 'iRot', 'iMeta']) near.setAttribute(name, far.getAttribute(name));
      near.instanceCount = far.instanceCount;
      near.boundingBox = far.boundingBox;
      near.boundingSphere = far.boundingSphere;
      const center = far.boundingSphere!.center;
      const pair = { far: add([far, instMat, instDepth]), near: add([near, stepMat, stepDepth]), x: center.x, z: center.z };
      pair.near.visible = false;
      roofLods.push(pair);
    }
  }
  return {
    group,
    /**
     * Swap stepped and plain roofs, and show facade details, by distance from the camera; call once
     * a frame. True when the roofs changed (the sun's shadow map needs redrawing).
     */
    updateLod(eye: { x: number; y: number; z: number }) {
      let changed = false;
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
        const d = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
        if (!t.done && d < nextD) {
          next = t;
          nextD = d;
        }
        if (t.mid) t.mid.visible = d < detailMid;
        if (t.near) t.near.visible = d < detailNear;
      }
      if (next) {
        modelDetails(next);
        if (next.mid) next.mid.visible = true;
        if (next.near) next.near.visible = nextD < detailNear;
      }
      return changed;
    },
  };
}
