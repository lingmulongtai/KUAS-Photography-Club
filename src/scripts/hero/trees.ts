import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import type { Box } from './geo';
import { rng } from './util';

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
) {
  const W = photo.width;
  const H = photo.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(photo, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const sample = (x: number, z: number) => {
    const u = (x - photoBox[0]) / (photoBox[2] - photoBox[0]);
    const v = (z - photoBox[1]) / (photoBox[3] - photoBox[1]);
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
    const o = (Math.floor(v * H) * W + Math.floor(u * W)) * 4;
    return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
  };

  function trees(eye: { x: number; z: number }, bearing: number) {
    const r = rng(4242);
    const spacing = quality > 0.75 ? 5.2 : 7.5;
    const reach = 1900;
    const fx = Math.sin((bearing * Math.PI) / 180);
    const fz = -Math.cos((bearing * Math.PI) / 180);
    const pos: number[] = [];
    const size: number[] = [];
    const tint: number[] = [];
    const kind: number[] = [];
    for (let gx = eye.x - reach; gx < eye.x + reach; gx += spacing) {
      for (let gz = eye.z - reach; gz < eye.z + reach; gz += spacing) {
        const x = gx + (r() - 0.5) * spacing * 0.9;
        const z = gz + (r() - 0.5) * spacing * 0.9;
        const dx = x - eye.x;
        const dz = z - eye.z;
        const d = Math.hypot(dx, dz);
        // only what can be seen: ahead of the viewpoint and a little to the sides
        if (d > reach || d < 140 || (dx * fx + dz * fz) / d < -0.25) continue;
        const c = sample(x, z);
        if (!c) continue;
        const lum = (c[0] + c[1] + c[2]) / 3;
        const green = c[1] - Math.max(c[0], c[2] * 0.95);
        if (green < 0.012 || lum > 0.42) continue;
        const y = hf.height(x, z);
        const cedar = r() < 0.28;
        const s = 0.75 + r() * 0.6;
        pos.push(x, y - 0.5, z);
        size.push(cedar ? 2.6 * s : 4.2 * s, cedar ? 15 * s : 10.5 * s);
        tint.push(c[0], c[1], c[2]);
        kind.push(cedar ? 1 : 0);
      }
    }
    for (const t of extra) {
      const s = 0.7 + r() * 0.35;
      pos.push(t.x, t.y - 0.5, t.z);
      size.push(3.4 * s, 9 * s);
      tint.push(0.2, 0.3, 0.15);
      kind.push(0);
    }
    return { pos, size, tint, kind };
  }

  // broadleaf crown: two flattened blobs; cedar: a narrow cone. Both unit-sized, base at y = 0.
  const blob1 = new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.7, 1).translate(0, 0.62, 0);
  const blob2 = new THREE.IcosahedronGeometry(0.36, 1).scale(1, 0.75, 1).translate(0.18, 0.86, 0.1);
  const crown = mergeGeometries([blob1, blob2]);
  const cone = new THREE.ConeGeometry(0.5, 1, 7, 1, true).translate(0, 0.55, 0).toNonIndexed();
  for (const geo of [crown, cone]) geo.deleteAttribute('uv');

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
        vTint = iTint;
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
        // photo colour as albedo, a little richer, darker inside the crown
        vec3 alb = pow(vTint, vec3(2.2)) * .85;
        alb = mix(vec3(dot(alb, vec3(.3, .55, .15))), alb, 1.25);
        alb *= .55 + .55 * smoothstep(.1, .9, vUp);
        float leaf = vnoise(vWorld.xz * 1.7 + vWorld.y * .9);
        alb *= .8 + .4 * leaf;
        float sh = sunShadow(vWorld, n);
        vec3 col = shade(alb, n, vWorld, sh);
        gl_FragColor = vec4(applyHaze(col, vec3(0.), vWorld), 1.);
      }
    `,
  });

  const group = new THREE.Group();
  let count = 0;
  /** Plant the forest around a viewpoint looking along `bearing` (degrees from north). */
  function plant(eye: { x: number; z: number }, bearing: number) {
    for (const m of [...group.children] as THREE.Mesh[]) {
      m.geometry.dispose();
      group.remove(m);
    }
    const { pos, size, tint, kind } = trees(eye, bearing);
    count = kind.length;
    for (const [shape, k] of [[crown, 0], [cone, 1]] as const) {
      const idx: number[] = [];
      kind.forEach((v, i) => v === k && idx.push(i));
      if (!idx.length) continue;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', shape.getAttribute('position'));
      geo.setAttribute('normal', shape.getAttribute('normal'));
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => pos.slice(i * 3, i * 3 + 3))), 3));
      geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => size.slice(i * 2, i * 2 + 2))), 2));
      geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(idx.flatMap((i) => tint.slice(i * 3, i * 3 + 3))), 3));
      geo.instanceCount = idx.length;
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }
  return { group, plant, get count() { return count; } };
}
