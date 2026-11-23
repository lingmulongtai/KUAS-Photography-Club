import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import type { Box } from './geo';
import { rng } from './util';
import { forestCells, woodland, seasonalWoodland } from './forest-layout';
import { treeProfile, standDensity } from './tree-profile';
import { SHADOW_LAYER } from './shadow';

/** Ground photographs tint the crowns. The planting map is independent of the visited views. */
export function createForest(
  env: Env,
  hf: Pick<Heightfield,'height'|'bounds'|'normal'>,
  quality: number,
  photos: { photo: HTMLImageElement | ImageBitmap; box: Box; uv?:Box }[],
  coverage: (x: number, z: number) => number,
  excluded: (x: number, z: number) => boolean = () => false,
  extra: { x: number; y: number; z: number; cherry?: boolean }[] = [],
  photoFallback = false,
) {
  const samplers = photos.map(({photo, box: photoBox, uv=[0,0,1,1]}) => {
    const sw=Math.round((uv[2]-uv[0])*photo.width), sh=Math.round((uv[3]-uv[1])*photo.height);
    // Ground colour only blends 20% into tree crown tint when tree-cover.bin supplies the mask.
    const W = Math.min(photoFallback ? (quality > .75 ? 1024 : 512) : 512, sw);
    const H = Math.round(sh * W / sw);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(photo,uv[0]*photo.width,(1-uv[3])*photo.height,sw,sh,0,0,W,H);
    const px = g.getImageData(0, 0, W, H).data;
    return (x: number, z: number) => {
      const u = (x - photoBox[0]) / (photoBox[2] - photoBox[0]);
      const v = (z - photoBox[1]) / (photoBox[3] - photoBox[1]);
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
      const o = (Math.floor(v * H) * W + Math.floor(u * W)) * 4;
      return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
    };
  });
  const sample = (x: number, z: number) => {
    for (const read of samplers) {
      const colour = read(x, z);
      if (colour) return colour;
    }
    return null;
  };
  const slopeNormal={x:0,y:1,z:0};
  const density = (x: number, z: number) => {
    const mapped = coverage(x,z);
    if (mapped || !photoFallback) return mapped;
    const c = sample(x,z);
    return c && (woodland(c) || seasonalWoodland(c,hf.normal(x,z,10,slopeNormal).y)) ? .75 : 0;
  };
  const contains = (x:number,z:number) => density(x,z) > .25 && !excluded(x,z);

  function* trees(eye: { x: number; z: number }) {
    const r = rng(4242);
    const pos: number[] = [];
    const size: number[] = [];
    const tint: number[] = [];
    const kind: number[] = [];
    const lods: number[] = [];
    const shapes: number[] = [];
    const season:number[]=[];
    let scanned=0;
    const spread = [1.25, 1.55, 2.1, 3.1, 4.3, 5.5];
    for (const { x, z, lod, level, seed } of forestCells(eye, quality, hf.bounds)) {
        if (++scanned % 512 === 0) yield;
        const cover = density(x,z);
        if (seed >= cover || seed >= cover * (.55 + .45 * standDensity(x,z)) || excluded(x,z)) continue;
        const y = hf.height(x, z);
        const profile = treeProfile(x,z);
        const cedar = profile.cedar;
        pos.push(x, y - 0.5, z);
        const radius = (cedar ? 2.6 : 4.2) * profile.width;
        let cluster = lod === 0 ? 1 : spread[level];
        if (lod >= 2) {
          // Large representative crowns are for stand interiors. Keep the scale of an
          // individual tree beside open water, fields or a narrow mountain clearing.
          const edge = radius * cluster;
          if (density(x-edge,z) < .3 || density(x+edge,z) < .3 || density(x,z-edge) < .3 || density(x,z+edge) < .3) cluster = 1;
        }
        size.push(radius * cluster, (cedar ? 15 : 10.5) * profile.height);
        const c = sample(x,z) ?? profile.tint;
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

  // Keep the stepped silhouette through the middle distance. Only the horizon
  // reduces whole stands to a single block, with the mapped canopy below them.
  const closeCrown = voxelCrown();
  const midCrown = blocksGeometry([
    {c:[0,.56,0],s:[.9,.48,.88],shade:.4,bark:0},
    {c:[.15,.85,.08],s:[.58,.32,.56],shade:.7,bark:0},
  ]);
  const farCrown = blocksGeometry([{c:[0,.66,0],s:[.86,.65,.86],shade:.5,bark:0}]);
  const standCrown = blocksGeometry([
    {c:[-.13,.59,.02],s:[.67,.55,.78],shade:.42,bark:0},
    {c:[.20,.73,-.08],s:[.52,.50,.60],shade:.68,bark:0},
  ]);
  const closeCedar=voxelCedar();
  const midCedar=voxelCedar(2);
  const crownLods = [closeCrown, midCrown, standCrown, farCrown, farCrown];
  const cedarLods = [closeCedar, midCedar, midCedar, farCrown, farCrown];

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
      uniform float uSummer;
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
        // Gentle sRGB shift before fragment gamma decode gives lush midsummer emerald without neon clipping.
        leaves=mix(leaves,leaves*vec3(.86,1.12,.84)+vec3(0.,.012,.004),uSummer*(.52+.48*iSeason.x));
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
        col += uSunLight * alb * vec3(.9, 1.2, .42) * back * (.25 + .75 * sh) * (.55 + .35 * uSummer);
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
  // Invalidated meshes remain visible until their replacement is complete.
  const retired=new Set<THREE.Mesh>();
  let visibleCenter: { x: number; z: number } | undefined;
  const replace = (meshes:THREE.Mesh[], eye: { x: number; z: number }) => {
    group.clear();group.add(...meshes);
    visibleCenter = { x: eye.x, z: eye.z };
    for(const mesh of retired)mesh.geometry.dispose();
    retired.clear();
  };
  let count = 0;
  let generation = 0;
  let planted:{eye:{x:number;z:number};bearing:number} | undefined;
  /** All directions remain populated when the user turns; chunks outside the frustum are culled. */
  function* plantSteps(eye: { x: number; z: number }, _bearing: number):Generator<void,void,void> {
    planted={eye:{x:eye.x,z:eye.z},bearing:_bearing};
    const key=`${Math.round(eye.x)},${Math.round(eye.z)}`;
    const cached=populations.get(key);
    if(cached) {
      populations.delete(key);populations.set(key,cached);
      replace(cached.meshes,eye);count=cached.count;return;
    }
    const { pos, size, tint, kind, lods, shapes,season } = yield* trees(eye);
    const chunks = new Map<string, number[]>();
    // Small near tiles cull whole high-detail crowns behind the eye. Sparse outer
    // trees can share larger draws without changing their shapes or positions.
    const tileWidth = [96, 384, 1536, 3072, 8192];
    for(let i=0;i<kind.length;i++) {
      if(i && i%2048===0) yield;
      const k=lods[i] < 3 ? kind[i] : 0;
      const width = tileWidth[lods[i]];
      const key = `${Math.floor(pos[i * 3] / width)},${Math.floor(pos[i * 3 + 2] / width)},${k},${lods[i]}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key)!.push(i);
    }
    const meshes:THREE.Mesh[]=[];
    let committed=false,chunkCount=0;
    try {
    for (const idx of chunks.values()) {
      if(++chunkCount%12===0) yield;
      const first = idx[0];
      const shapesByLod = kind[first] === 1 ? cedarLods : crownLods;
      const shape = shapesByLod[lods[first]];
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(shape.index);
      geo.setAttribute('position', shape.getAttribute('position'));
      geo.setAttribute('normal', shape.getAttribute('normal'));
      geo.setAttribute('aBark', shape.getAttribute('aBark'));
      geo.setAttribute('aVox', shape.getAttribute('aVox'));
      const positions=new Float32Array(idx.length*3),sizes=new Float32Array(idx.length*2),
        tints=new Float32Array(idx.length*3),treeShapes=new Float32Array(idx.length*3),seasons=new Float32Array(idx.length*2);
      const bounds = new THREE.Box3();
      for (let j=0;j<idx.length;j++) {
        const i=idx[j],p=i*3,s=i*2,pOut=j*3,sOut=j*2;
        for(let k=0;k<3;k++){positions[pOut+k]=pos[p+k];tints[pOut+k]=tint[p+k];treeShapes[pOut+k]=shapes[p+k];}
        sizes[sOut]=size[s];sizes[sOut+1]=size[s+1];seasons[sOut]=season[s];seasons[sOut+1]=season[s+1];
        const x=pos[p],y=pos[p+1],z=pos[p+2],radius=size[s]*1.9;
        bounds.min.x=Math.min(bounds.min.x,x-radius);bounds.min.y=Math.min(bounds.min.y,y);bounds.min.z=Math.min(bounds.min.z,z-radius);
        bounds.max.x=Math.max(bounds.max.x,x+radius);bounds.max.y=Math.max(bounds.max.y,y+size[s+1]*1.6);bounds.max.z=Math.max(bounds.max.z,z+radius);
      }
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(positions, 3));
      geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 2));
      geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(tints, 3));
      geo.setAttribute('iShape', new THREE.InstancedBufferAttribute(treeShapes, 3));
      geo.setAttribute('iSeason',new THREE.InstancedBufferAttribute(seasons,2));
      geo.instanceCount = idx.length;
      geo.boundingBox = bounds;
      geo.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geo, material);
      mesh.layers.enable(SHADOW_LAYER);
      mesh.userData.depthMaterial = depthMaterial;
      meshes.push(mesh);
    }
    replace(meshes,eye);count=kind.length;
    populations.set(key,{meshes,count});committed=true;
    if(populations.size>3) {
      const oldest=populations.keys().next().value!;
      for(const mesh of populations.get(oldest)!.meshes) mesh.geometry.dispose();
      populations.delete(oldest);
    }
    } finally {
      if(!committed)for(const mesh of meshes)mesh.geometry.dispose();
    }
  }
  function plant(eye: { x: number; z: number }, bearing: number) {
    generation++;
    const steps=plantSteps(eye,bearing);
    while(!steps.next().done) { /* synchronous initial and viewpoint setup */ }
  }
  async function plantAsync(eye: { x: number; z: number }, bearing: number) {
    const request=++generation,steps=plantSteps({x:eye.x,z:eye.z},bearing);
    try {
      while(request===generation) {
        const deadline=performance.now()+5;
        do { if(steps.next().done)return; } while(request===generation && performance.now()<deadline);
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
    } finally { steps.return(); }
  }
  const cancelPlant = () => { generation++; };
  let following = false;
  function follow(eye: {x:number;z:number}, bearing: number) {
    const spacing = quality > .75 ? 160 : 110;
    if (following || (visibleCenter && Math.hypot(eye.x-visibleCenter.x,eye.z-visibleCenter.z) < spacing)) return;
    // While travelling, finish one population before sampling the latest camera
    // position on the next frame. Fast movement must not starve visible updates.
    following = true;
    return plantAsync(eye,bearing).finally(() => { following = false; });
  }
  const refreshExclusions = () => {
    cancelPlant();
    for(const population of populations.values()) for(const mesh of population.meshes) {
      if(mesh.parent===group)retired.add(mesh);else mesh.geometry.dispose();
    }
    populations.clear();
    return planted ? plantAsync(planted.eye,planted.bearing) : Promise.resolve();
  };
  return { group, plant, plantAsync, follow, cancelPlant, contains, refreshExclusions, get count() { return count; } };
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

/** Each face has four distinct shaded corners; its two triangles can reuse two of them. */
function blocksGeometry(blocks: Block[], hidden: (b: Block, n: [number, number, number]) => boolean = () => false) {
  const pos: number[] = [], nrm: number[] = [], vox: number[] = [], bark: number[] = [];
  const indices: number[] = [];
  for (const b of blocks) {
    for (const f of FACES) {
      if (hidden(b, f.n)) continue;
      const first = vox.length;
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      for (const [x, y, z] of f.corners) {
        pos.push(b.c[0] + x * b.s[0] / 2, b.c[1] + y * b.s[1] / 2, b.c[2] + z * b.s[2] / 2);
        nrm.push(...f.n);
        vox.push(b.shade);
        bark.push(b.bark);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
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
function voxelCedar(tiers=5) {
  const blocks: Block[] = [];
  for (let t = 0; t < tiers; t++) {
    const w = 0.95 * (1 - t / tiers) + 0.06;
    const h = 0.75 / tiers;
    blocks.push({ c: [0, 0.25 + h * (t + 0.5), 0], s: [w, h, w], shade: 0.25 + 0.6 * ((t * 0.37) % 1), bark: 0 });
  }
  if(tiers>2)blocks.push({ c: [0, 0.14, 0], s: [0.07, 0.28, 0.07], shade: 0.5, bark: 1 });
  return blocksGeometry(blocks);
}
