import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import type { Box } from './geo';
import { rng } from './util';
import { forestCells, woodland } from './forest-layout';

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
  extra: { x: number; y: number; z: number }[] = [],
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
  const sample = (x: number, z: number) => citySample(x, z) ?? wideSample?.(x, z) ?? null;

  function trees(eye: { x: number; z: number }) {
    const r = rng(4242);
    const pos: number[] = [];
    const size: number[] = [];
    const tint: number[] = [];
    const kind: number[] = [];
    const lods: number[] = [];
    for (const { x, z, lod, seed } of forestCells(eye, quality)) {
        const c = sample(x, z);
        if (!c || excluded(x, z) || (!woodland(c) && !forestArea(x, z))) continue;
        const y = hf.height(x, z);
        const cedar = seed < .28;
        const s = .8 + seed * .65;
        pos.push(x, y - 0.5, z);
        const cluster = lod === 2 ? 2.4 : lod === 1 ? 1.35 : 1;
        size.push((cedar ? 2.6 : 4.2) * s * cluster, (cedar ? 15 : 10.5) * s);
        tint.push(c[0] * .9, Math.max(c[1], c[0] * 1.08), c[2] * .83);
        kind.push(cedar ? 1 : 0);
        lods.push(lod);
    }
    for (const t of extra) {
      const s = 0.7 + r() * 0.35;
      pos.push(t.x, t.y - 0.5, t.z);
      size.push(3.4 * s, 9 * s);
      tint.push(0.2, 0.3, 0.15);
      kind.push(0);
      lods.push(0);
    }
    return { pos, size, tint, kind, lods };
  }

  // broadleaf crown: two flattened blobs; cedar: a narrow cone. Both unit-sized, base at y = 0.
  const blob1 = new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.7, 1).translate(0, 0.62, 0);
  const blob2 = new THREE.IcosahedronGeometry(0.36, 1).scale(1, 0.75, 1).translate(0.18, 0.86, 0.1);
  const crown = mergeGeometries([blob1, blob2]);
  const trunk = new THREE.CylinderGeometry(.035, .05, .45, 6).translate(0, .225, 0).toNonIndexed();
  const closeCrown = mergeGeometries([crown, trunk]);
  const farCrown = new THREE.IcosahedronGeometry(.5, 0).scale(1, .65, 1).translate(0, .65, 0);
  const cone = new THREE.ConeGeometry(0.5, 1, 7, 1, true).translate(0, 0.55, 0).toNonIndexed();
  for (const geo of [crown, closeCrown, farCrown, cone]) geo.deleteAttribute('uv');

  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute vec3 iPos;
      attribute vec2 iSize;
      attribute vec3 iTint;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vTint;
      varying float vUp;
      void main(){
        vec3 p = position * vec3(iSize.x * 2., iSize.y, iSize.x * 2.);
        float a = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
        p.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xz;
        vec3 wp = iPos + p;
        // a breath of wind in the canopy
        wp.x += sin(uTime * 1.3 + iPos.x * .05) * .12 * position.y;
        vWorld = wp;
        vec3 n = normal;
        n.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * n.xz;
        vNormal = normalize(n + vec3(0., .35, 0.));
        vTint = position.y < .3 ? vec3(.22, .15, .09) : iTint;
        vUp = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vTint;
      varying float vUp;
      void main(){
        vec3 n = normalize(vNormal);
        float sh = sunShadow(vWorld, n);
        float fp = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
        // photo colour as albedo, a little richer, darker inside the crown
        vec3 alb = pow(vTint, vec3(2.2)) * 1.3;
        alb = mix(vec3(dot(alb, vec3(.3, .55, .15))), alb, 1.1);
        alb *= .55 + .55 * smoothstep(.1, .9, vUp);
        // clumps of leaves, smoothed away once they are smaller than a couple of pixels
        float leaf = mix(.5, vnoise(vWorld.xz * 1.7 + vWorld.y * .9), 1. - smoothstep(.25, .6, fp * 1.7));
        alb *= .8 + .4 * leaf;
        vec3 col = shade(alb, n, vWorld, sh);
        gl_FragColor = vec4(applyHaze(col, vec3(0.), vWorld), 1.);
      }
    `,
  });

  const group = new THREE.Group();
  let count = 0;
  /** All directions remain populated when the user turns; chunks outside the frustum are culled. */
  function plant(eye: { x: number; z: number }, _bearing: number) {
    for (const m of [...group.children] as THREE.Mesh[]) {
      m.geometry.dispose();
      group.remove(m);
    }
    const { pos, size, tint, kind, lods } = trees(eye);
    count = kind.length;
    const chunks = new Map<string, number[]>();
    kind.forEach((k, i) => {
      const key = `${Math.floor(pos[i * 3] / 768)},${Math.floor(pos[i * 3 + 2] / 768)},${k},${lods[i]}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key)!.push(i);
    });
    for (const idx of chunks.values()) {
      const first = idx[0];
      const shape = kind[first] === 1 ? cone : lods[first] === 0 ? closeCrown : farCrown;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', shape.getAttribute('position'));
      geo.setAttribute('normal', shape.getAttribute('normal'));
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => pos.slice(i * 3, i * 3 + 3))), 3));
      geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => size.slice(i * 2, i * 2 + 2))), 2));
      geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => tint.slice(i * 3, i * 3 + 3))), 3));
      geo.instanceCount = idx.length;
      const bounds = new THREE.Box3();
      for (const i of idx) {
        const radius = size[i * 2] * 1.4;
        const [x, y, z] = pos.slice(i * 3, i * 3 + 3);
        bounds.expandByPoint(new THREE.Vector3(x - radius, y, z - radius));
        bounds.expandByPoint(new THREE.Vector3(x + radius, y + size[i * 2 + 1] * 1.4, z + radius));
      }
      geo.boundingBox = bounds;
      geo.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geo, material);
      group.add(mesh);
    }
  }
  return { group, plant, get count() { return count; } };
}
