import * as THREE from 'three';
import type { Box } from './geo';
import type { TreeCover } from './tree-cover';
import type { Woodland } from './woodland';

/** Trees and terrain share the same coverage, including the holes in mapped woods. */
export function buildWoodlandTexture(polygons: Woodland[], fallbackBox: Box, cover: TreeCover | null, textureLimit: number) {
  const box = cover?.box ?? fallbackBox;
  const width = cover?.width ?? 2048, height = cover?.height ?? 2048;
  const sx = width / (box[2] - box[0]), sz = height / (box[3] - box[1]);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(sx, 0, 0, sz, -box[0] * sx, -box[1] * sz);
  ctx.fillStyle = 'white';
  for (const polygon of polygons) {
    ctx.beginPath();
    for (const ring of [...polygon.outer, ...polygon.holes]) {
      ctx.moveTo(...ring[0]);
      for (let j = 1; j < ring.length; j++) ctx.lineTo(...ring[j]);
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const density = new Uint8Array(width * height);
  // Only one strip of temporary RGBA pixels is needed for the polygon edges.
  for (let row = 0; row < height; row += 128) {
    const pixels = ctx.getImageData(0, row, width, Math.min(128, height - row)).data;
    const offset = row * width;
    for (let j = 0; j < pixels.length / 4; j++) {
      const satellite = cover?.cells[offset + j] ?? 0;
      const mapped = pixels[j * 4 + 3];
      density[offset + j] = satellite === 16 ? 0 : Math.max(satellite * 17, mapped * .8);
    }
  }
  // WebGL2 guarantees 2048 texels. Keep the full CPU planting grid on smaller GPUs too.
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / textureLimit));
  const w = Math.ceil(width / stride), h = Math.ceil(height / stride);
  let ground = density;
  if (stride > 1) {
    ground = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let j = z * stride; j < Math.min((z + 1) * stride, height); j++) {
        for (let i = x * stride; i < Math.min((x + 1) * stride, width); i++) {
          sum += density[j * width + i];
          count++;
        }
      }
      ground[z * w + x] = Math.round(sum / count);
    }
  }
  const texture = new THREE.DataTexture(ground, w, h, THREE.RedFormat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const sample = (x: number, z: number) => {
    const ix = Math.floor((x - box[0]) * sx), iz = Math.floor((z - box[1]) * sz);
    return ix >= 0 && iz >= 0 && ix < width && iz < height ? density[iz * width + ix] / 255 : 0;
  };
  return { texture, box, sample };
}
