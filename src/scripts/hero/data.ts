import * as THREE from 'three';
import type { Box } from './geo';

/** Everything the scene loads from public/kyoto/ (written by tools/kyoto-data). */
export const BASE = '/kyoto/';

/**
 * Fetch a gzip-compressed .bin file and return its bytes. Some servers send such files with
 * Content-Encoding: gzip and the browser has already unpacked them, so check the magic bytes.
 */
export async function loadBinary(file: string) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undo the byte-plane split: n little-endian int16 values stored as n low bytes then n high bytes. */
export function int16Planes(bytes: Uint8Array, offset: number, n: number) {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[offset + i] | (bytes[offset + n + i] << 8)) << 16 >> 16;
  return out;
}

export interface GridMeta {
  box: Box;
  step: number;
  nx: number;
  nz: number;
  file: string;
}

/** A sharper photo over a bounded area, loaded once a view that looks at it is chosen. */
export interface RegionalPhotoMeta {
  box: Box; file: string; size: [number,number]; bytes: number; zoom: number;
  mobile: {file:string;size:[number,number];bytes:number};
}

export interface TerrainMeta {
  far: GridMeta;
  near: GridMeta;
  aerialWide: { box: Box; file: string; size: [number, number]; high?: { file: string; size: [number, number]; bytes: number; zoom: number } };
  aerialCity: { box: Box; file: string; size: [number, number] };
  arashiyama?: RegionalPhotoMeta & {
    elevation: GridMeta;
    water: {file:string;bytes:number;baseSha256:string};
  };
  /** the slopes below Shogunzuka and Kiyomizu-dera (build_higashiyama.py) */
  higashiyama?: RegionalPhotoMeta;
}

/** An elevation grid in metres, decoded from decimetre deltas (see encode_heights in common.py). */
export async function loadGrid(meta: GridMeta) {
  const bytes = await loadBinary(meta.file);
  const n = meta.nx * meta.nz;
  const d = int16Planes(bytes, 0, n);
  const h = new Float32Array(n);
  let rowStart = 0;
  for (let j = 0; j < meta.nz; j++) {
    const o = j * meta.nx;
    rowStart = j === 0 ? d[0] : rowStart + d[o];
    let v = rowStart;
    h[o] = v / 10;
    for (let i = 1; i < meta.nx; i++) {
      v += d[o + i];
      h[o + i] = v / 10;
    }
  }
  return h;
}

export function loadTexture(file: string, maxAniso: number) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      BASE + file,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = maxAniso;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

export async function loadJSON<T>(file: string): Promise<T> {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json() as Promise<T>;
}
