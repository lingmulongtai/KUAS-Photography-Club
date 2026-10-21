import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import type { Box } from './geo';
import { rng } from './util';
import { forestCells, woodland, seasonalWoodland } from './forest-layout';
import { treeProfile, standDensity } from './tree-profile';
import { SHADOW_LAYER } from './shadow';

/**
 * Real trees on the slopes in front of the viewpoint, where the aerial photo shows forest.
 * Each tree takes its colour from the photo under it, so the canopy matches the real woods:
 * broadleaf crowns (shii and kashi) mixed with conical cedars. plant() re-plants them around
 * another viewpoint; the extra trees (the campus edge) always stay.
 */
export function createForest(
  env: Env,
  hf: Heightfield,
  photo: HTMLImageElement | ImageBitmap,
  photoBox: Box,
  quality: number,
  /** extra broadleaf trees, e.g. along the campus edge */
  extra: { x: number; y: number; z: number;cherry?:boolean }[] = [],
  fallback?: { photo: HTMLImageElement | ImageBitmap; box: Box },
  excluded: (x: number, z: number) => boolean = () => false,
  forestArea: (x: number, z: number) => boolean = () => false,
) {
  const sampler = (photo: HTMLImageElement | ImageBitmap, photoBox: Box, maxWidth = photo.width) => {
    const W = Math.min(maxWidth, photo.width);
    const H = Math.round(photo.height * W / photo.width);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(photo, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    return (x: number, z: number) => {
      const u = (x - photoBox[0]) / (photoBox[2] - photoBox[0]);
      const v = (z - photoBox[1]) / (photoBox[3] - photoBox[1]);
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
      const o = (Math.floor(v * H) * W + Math.floor(u * W)) * 4;
      return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
    };
  };
  const citySample = sampler(photo, photoBox);
  const wideSample = fallback ? sampler(fallback.photo, fallback.box, quality > .75 ? 4096 : 2048) : null;
  /** sharper local photos (setRegionalPhoto), which take precedence over the city sheet */
  const regions:{box:Box;sample:ReturnType<typeof sampler>;seasonal:boolean;temporary?:boolean}[]=[];
  const inBox=(b:Box,x:number,z:number)=>x>=b[0]&&x<b[2]&&z>=b[1]&&z<b[3];
  const regionAt=(x:number,z:number)=>regions.find(r=>inBox(r.box,x,z));
  const sample = (x: number, z: number) => regionAt(x,z)?.sample(x,z) ?? citySample(x, z) ?? wideSample?.(x, z) ?? null;
  const slopeNormal={x:0,y:1,z:0};
  const wooded=(c:number[],x:number,z:number) => woodland(c)||forestArea(x,z)||
    (!!regionAt(x,z)?.seasonal&&seasonalWoodland(c,hf.normal(x,z,10,slopeNormal).y));
  const contains = (x:number,z:number) => {
    const c=sample(x,z);
    return !!c && !excluded(x,z) && wooded(c,x,z);
  };

  function trees(eye: { x: number; z: number }) {
    const r = rng(4242);
    const pos: number[] = [];
    const size: number[] = [];
    const tint: number[] = [];
    const kind: number[] = [];
    const lods: number[] = [];
    const shapes: number[] = [];
    const season:number[]=[];
    const detailed=regions.some(r=>inBox(r.box,eye.x,eye.z));
    for (const { x, z, lod, seed } of forestCells(eye, quality,detailed)) {
        const c = sample(x, z);
        if (!c || excluded(x, z) || !wooded(c,x,z)) continue;
        if (lod<2 && seed>standDensity(x,z)) continue;
        const y = hf.height(x, z);
        const profile = treeProfile(x,z);
        const cedar = profile.cedar;
        pos.push(x, y - 0.5, z);
        const cluster = lod === 3 ? quality>.75 ? 8 : 11 : lod === 2 ? 2.4 : lod === 1 ? 1.35 : 1;
        size.push((cedar ? 2.6 : 4.2) * profile.width * cluster, (cedar ? 15 : 10.5) * profile.height);
        tint.push(...profile.tint.map((v,i)=>v*.8+Math.min(c[i],.45)*.2));
        kind.push(cedar ? 1 : 0);
        season.push(cedar?0:1,0);
        lods.push(lod);
        shapes.push(profile.aspect,profile.lean,profile.crown);
    }
    for (const t of extra) {
      const s = 0.7 + r() * 0.35;
      pos.push(t.x, t.y - 0.5, t.z);
      size.push(3.4 * s, 9 * s);
      tint.push(0.2, 0.3, 0.15);
      kind.push(0);
      season.push(1,t.cherry?1:0);
      lods.push(0);
      const profile=treeProfile(t.x,t.z);
      shapes.push(profile.aspect,profile.lean,profile.crown);
    }
    return { pos, size, tint, kind, lods, shapes,season };
  }

  // broadleaf crown: two flattened blobs; cedar: a narrow cone. Both unit-sized, base at y = 0.
  const blob1 = new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.7, 1).translate(0, 0.62, 0);
  const blob2 = new THREE.IcosahedronGeometry(0.36, 1).scale(1, 0.75, 1).translate(0.18, 0.86, 0.1);
  const crown = mergeGeometries([blob1, blob2]);
  const trunk = new THREE.CylinderGeometry(.035, .05, .45, 6).translate(0, .225, 0).toNonIndexed();
  for(const geo of [crown,trunk]) geo.deleteAttribute('uv');
  crown.setAttribute('aBark',new THREE.Float32BufferAttribute(new Float32Array(crown.getAttribute('position').count),1));
  trunk.setAttribute('aBark',new THREE.Float32BufferAttribute(new Float32Array(trunk.getAttribute('position').count).fill(1),1));
  // Up close, crowns are built from blocks, voxel-game style (see voxelCrown); the smooth
  // shapes above stay for the middle distance, where blocks would only shimmer.
  const closeCrown = voxelCrown();
  void crown;
  const farCrown = new THREE.IcosahedronGeometry(.5, 0).scale(1, .65, 1).translate(0, .65, 0);
  // The 20-face crown has flat normals and glinted like a cut gem from the hills: shade it as
  // the ellipsoid it stands for.
  {
    const p = farCrown.getAttribute('position'), n = farCrown.getAttribute('normal');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i) / .25, (p.getY(i) - .65) / (.325 * .325), p.getZ(i) / .25).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
  }
  const cone = new THREE.ConeGeometry(0.5, .75, 7, 1, true).translate(0, .625, 0).toNonIndexed();
  for (const geo of [farCrown, cone]) {
    geo.deleteAttribute('uv');
    geo.setAttribute('aBark',new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count),1));
  }
  for (const geo of [farCrown, cone]) geo.setAttribute('aVox',new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count),1));
  const closeCedar=voxelCedar();

  const vertexShader = /* glsl */ `
      attribute vec3 iPos;
      attribute vec2 iSize;
      attribute vec3 iTint;
      attribute vec3 iShape;
      attribute vec2 iSeason;
      attribute float aBark;
      attribute float aVox;
      uniform float uTime;
      uniform float uSpring;
      uniform float uAutumn;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vTint;
      varying float vUp;
      varying float vBark;
      varying float vVox;
      void main(){
        float foliage=1.-aBark;
        vBark=aBark;
        vVox=aVox;
        vec3 scale=vec3(iSize.x*2.*iShape.x,iSize.y,iSize.x*2./iShape.x);
        vec3 p = position * scale;
        float upper=max(position.y-.4,0.);
        p.y += upper*iSize.y*(iShape.z-1.)*foliage;
        p.x += upper*iSize.x*2.*iShape.y*foliage;
        float a = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
        p.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xz;
        vec3 wp = iPos + p;
        // a breath of wind in the canopy
        wp.x += sin(uTime * 1.3 + iPos.x * .05) * .12 * position.y;
        vWorld = wp;
        vec3 n = normal / scale;
        if(position.y>.4) {
          n.y /= mix(1.,iShape.z,foliage);
          n.y -= n.x*iSize.x*2.*iShape.y/(iSize.y*mix(1.,iShape.z,foliage))*foliage;
        }
        n.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * n.xz;
        vNormal = normalize(normalize(n) + vec3(0., .15, 0.));
        float leafPhase=fract(sin(dot(iPos.xz,vec2(.13,.17)))*347.7);
        vec3 leaves=mix(iTint,mix(vec3(.5,.12,.035),vec3(.66,.4,.065),leafPhase),uAutumn*iSeason.x*(.45+.55*leafPhase));
        leaves=mix(leaves,vec3(.85,.62,.69),uSpring*iSeason.y);
        vTint = mix(leaves,vec3(.22,.15,.09),aBark);
        vUp = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }
    `;
  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vTint;
      varying float vUp;
      varying float vBark;
      varying float vVox;
      void main(){
        vec3 n = normalize(vNormal);
        float fp = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
        // clumps of leaves: world-space noise tilts the normal and opens darker gaps, so a crown
        // reads as foliage rather than a smooth ball. Clumps under a couple of pixels fade out.
        // Block crowns keep their flat faces and get a shade per block instead.
        float k = (1. - smoothstep(.25, .6, fp * 1.1)) * (1. - vBark) * step(vVox, 0.);
        float c1 = .5;
        if (k > 0.) {
          // only near crowns pay for the clumps; nothing below takes derivatives
          c1 = vnoise(vWorld.xz * 1.1 + vWorld.y * .7);
          float c2 = vnoise(vWorld.zy * 1.1 + vWorld.x * .7 + 5.3);
          n = normalize(n + vec3(c1 - .5, .25 * (c2 - .5), c2 - .5) * 1.1 * k);
        }
        float sh = sunShadow(vWorld, n);
        // photo-based tint as albedo; the inside and underside of a crown stay in its own shade
        vec3 alb = pow(vTint, vec3(2.2)) * 1.05;
        float occ = mix(.42, 1., smoothstep(.15, 1., vUp)) * mix(1., .62 + .6 * c1, k);
        alb *= mix(occ, .8, vBark);
        if (vVox > 0.) alb *= .8 + .4 * vVox;
        vec3 col = shade(seasonalSurface(alb,n,vWorld), n, vWorld, sh);
        // sunlight through the leaves when the tree stands against the sun
        vec3 v = normalize(vWorld - cameraPosition);
        float back = pow(max(dot(v, uSunDir), 0.), 5.) * (1. - vBark);
        col += uSunLight * alb * vec3(.9, 1.15, .45) * back * (.25 + .75 * sh) * .55;
        gl_FragColor = vec4(applyHaze(col, vec3(0.), vWorld), 1.);
      }
    `,
  });
  /** Trees cast sun shadows too, which settles them onto the ground (see shadow.ts). */
  const depthMaterial = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader,
    fragmentShader: /* glsl */ `
      #include <packing>
      void main(){ gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }
    `,
  });

  const group = new THREE.Group();
  // Repeated visits reuse three recent populations; evicted instance buffers are released.
  const populations=new Map<string,{meshes:THREE.Mesh[];count:number}>();
  let count = 0;
  let planted:{eye:{x:number;z:number};bearing:number} | undefined;
  /** All directions remain populated when the user turns; chunks outside the frustum are culled. */
  function plant(eye: { x: number; z: number }, _bearing: number) {
    planted={eye:{x:eye.x,z:eye.z},bearing:_bearing};
    const key=`${Math.round(eye.x)},${Math.round(eye.z)}`;
    for (const m of [...group.children] as THREE.Mesh[]) {
      group.remove(m);
    }
    const cached=populations.get(key);
    if(cached) {
      populations.delete(key);populations.set(key,cached);
      group.add(...cached.meshes);count=cached.count;return;
    }
    const { pos, size, tint, kind, lods, shapes,season } = trees(eye);
    count = kind.length;
    const chunks = new Map<string, number[]>();
    kind.forEach((k, i) => {
      const key = `${Math.floor(pos[i * 3] / 768)},${Math.floor(pos[i * 3 + 2] / 768)},${k},${lods[i]}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key)!.push(i);
    });
    for (const idx of chunks.values()) {
      const first = idx[0];
      const shape = kind[first] === 1 ? lods[first] === 0 ? closeCedar : cone : lods[first] === 0 ? closeCrown : farCrown;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', shape.getAttribute('position'));
      geo.setAttribute('normal', shape.getAttribute('normal'));
      geo.setAttribute('aBark', shape.getAttribute('aBark'));
      geo.setAttribute('aVox', shape.getAttribute('aVox'));
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => pos.slice(i * 3, i * 3 + 3))), 3));
      geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => size.slice(i * 2, i * 2 + 2))), 2));
      geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => tint.slice(i * 3, i * 3 + 3))), 3));
      geo.setAttribute('iShape', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => shapes.slice(i * 3, i * 3 + 3))), 3));
      geo.setAttribute('iSeason',new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap(i=>season.slice(i*2,i*2+2))),2));
      geo.instanceCount = idx.length;
      const bounds = new THREE.Box3();
      for (const i of idx) {
        const radius = size[i * 2] * 1.9;
        const [x, y, z] = pos.slice(i * 3, i * 3 + 3);
        bounds.expandByPoint(new THREE.Vector3(x - radius, y, z - radius));
        bounds.expandByPoint(new THREE.Vector3(x + radius, y + size[i * 2 + 1] * 1.6, z + radius));
      }
      geo.boundingBox = bounds;
      geo.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geo, material);
      mesh.layers.enable(SHADOW_LAYER);
      mesh.userData.depthMaterial = depthMaterial;
      group.add(mesh);
    }
    populations.set(key,{meshes:[...group.children] as THREE.Mesh[],count});
    if(populations.size>3) {
      const oldest=populations.keys().next().value!;
      for(const mesh of populations.get(oldest)!.meshes) mesh.geometry.dispose();
      populations.delete(oldest);
    }
  }
  /** Use a sharper photo over `box`. `seasonal` imagery (leafless or autumn) also accepts muted
   * canopy on slopes; summer imagery doesn't need that and would catch cemeteries on the hills. */
  const setRegionalPhoto = (photo:HTMLImageElement | ImageBitmap,box:Box,seasonal=false) => {
    const region={box,sample:sampler(photo,box),seasonal};
    const i=regions.findIndex(r=>r.box.every((v,k)=>v===box[k]));
    if(i<0) regions.push(region); else regions[i]=region;
    for(const population of populations.values()) for(const mesh of population.meshes) mesh.geometry.dispose();
    populations.clear();
    if(planted) plant(planted.eye,planted.bearing);
  };
  /** Replace the one outer-city photo, releasing its CPU pixels and cached populations. */
  const setOuterPhoto=(photo:HTMLImageElement|ImageBitmap|null,box:Box)=>{
    const i=regions.findIndex(r=>r.temporary);
    if(i>=0)regions.splice(i,1);
    if(photo)regions.unshift({box,sample:sampler(photo,box),seasonal:false,temporary:true});
    for(const population of populations.values())for(const mesh of population.meshes)mesh.geometry.dispose();
    populations.clear();
    if(planted)plant(planted.eye,planted.bearing);
  };
  return { group, plant, contains, setRegionalPhoto, setOuterPhoto, get count() { return count; } };
}

/** An axis-aligned block: centre, size, and a shade (0..1, 0 for none) shared by its faces. */
type Block = { c: [number, number, number]; s: [number, number, number]; shade: number; bark: number };

const FACES: { n: [number, number, number]; corners: [number, number, number][] }[] = [
  { n: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], corners: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], corners: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
];

/** Blocks as one non-indexed geometry; `hidden(block, face)` drops faces buried against a neighbour. */
function blocksGeometry(blocks: Block[], hidden: (b: Block, n: [number, number, number]) => boolean = () => false) {
  const pos: number[] = [], nrm: number[] = [], vox: number[] = [], bark: number[] = [];
  for (const b of blocks) {
    for (const f of FACES) {
      if (hidden(b, f.n)) continue;
      const q = f.corners.map(([x, y, z]) => [b.c[0] + x * b.s[0] / 2, b.c[1] + y * b.s[1] / 2, b.c[2] + z * b.s[2] / 2]);
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...q[i]);
        nrm.push(...f.n);
        vox.push(b.shade);
        bark.push(b.bark);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aVox', new THREE.Float32BufferAttribute(vox, 1));
  g.setAttribute('aBark', new THREE.Float32BufferAttribute(bark, 1));
  return g;
}

/**
 * A broadleaf crown of blocks filling the same two flattened blobs as the smooth crown, with a few
 * blocks knocked off the surface so the outline is ragged, and a square trunk.
 */
function voxelCrown() {
  const r = rng(77);
  const S = 0.16;
  const inside = (x: number, y: number, z: number) => {
    const a = (x / 0.5) ** 2 + ((y - 0.62) / 0.35) ** 2 + (z / 0.5) ** 2;
    const b = ((x - 0.18) / 0.36) ** 2 + ((y - 0.86) / 0.27) ** 2 + ((z - 0.1) / 0.36) ** 2;
    return Math.min(a, b);
  };
  const cells = new Set<string>();
  const blocks: Block[] = [];
  for (let i = -4; i <= 4; i++) for (let j = 0; j <= 8; j++) for (let k = -4; k <= 4; k++) {
    const x = i * S, y = 0.26 + j * S, z = k * S;
    const d = inside(x, y, z);
    // the outermost shell is thinned at random
    if (d > 1.05 || (d > 0.7 && r() < 0.3)) continue;
    cells.add(`${i},${j},${k}`);
    blocks.push({ c: [x, y, z], s: [S, S, S], shade: 0.05 + r() * 0.95, bark: 0 });
  }
  const key = (b: Block) => [Math.round(b.c[0] / S), Math.round((b.c[1] - 0.26) / S), Math.round(b.c[2] / S)];
  const crown = blocksGeometry(blocks, (b, n) => {
    const [i, j, k] = key(b);
    return cells.has(`${i + n[0]},${j + n[1]},${k + n[2]}`);
  });
  const trunk = blocksGeometry([{ c: [0, 0.2, 0], s: [0.08, 0.4, 0.08], shade: 0.5, bark: 1 }]);
  return mergeGeometries([crown, trunk]);
}

/** A cedar as a stack of shrinking square tiers. */
function voxelCedar() {
  const blocks: Block[] = [];
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const w = 0.95 * (1 - t / tiers) + 0.06;
    const h = 0.75 / tiers;
    blocks.push({ c: [0, 0.25 + h * (t + 0.5), 0], s: [w, h, w], shade: 0.25 + 0.6 * ((t * 0.37) % 1), bark: 0 });
  }
  blocks.push({ c: [0, 0.14, 0], s: [0.07, 0.28, 0.07], shade: 0.5, bark: 1 });
  return blocksGeometry(blocks);
}
