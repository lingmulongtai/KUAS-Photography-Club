import * as THREE from 'three';
import {expandGzip} from './gzip.ts';
import type { Box } from './geo';

/** Everything the scene loads from public/kyoto/ (written by tools/kyoto-data). */
export const BASE = '/kyoto/';

type InflateReply={id:number;bytes?:Uint8Array<ArrayBuffer>;error?:string};
const inflating=new Map<number,{resolve:(b:Uint8Array<ArrayBuffer>)=>void;reject:(e:Error)=>void}>();
let decoder:Worker|null|undefined,nextId=0;

function binaryWorker(){
  if(decoder!==undefined)return decoder;
  try{
    decoder=new Worker(new URL('./gzip.worker.ts',import.meta.url),{type:'module'});
    decoder.onmessage=({data}:{data:InflateReply})=>{
      const job=inflating.get(data.id);
      if(!job)return;
      inflating.delete(data.id);
      if(data.bytes)job.resolve(data.bytes);
      else job.reject(new Error(data.error));
    };
    decoder.onerror=()=>{
      decoder?.terminate();decoder=null;
      for(const job of inflating.values())job.reject(new Error('Binary decoder stopped'));
      inflating.clear();
    };
  }catch{decoder=null;}
  return decoder;
}

/**
 * Fetch a gzip-compressed .bin file and return its bytes. Some servers send such files with
 * Content-Encoding: gzip and the browser has already unpacked them, so check the magic bytes.
 */
export async function loadBinary(file: string,priority?:RequestPriority) {
  const res = await fetch(BASE + file,priority?{priority}:undefined);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if(bytes.byteLength>=256*1024 && typeof window!=='undefined' && typeof Worker==='function'){
    const worker=binaryWorker();
    if(worker){
      const id=++nextId;
      try{
        return await new Promise<Uint8Array<ArrayBuffer>>((resolve,reject)=>{
          inflating.set(id,{resolve,reject});
          // Keep the compressed input for local recovery if the worker is interrupted.
          worker.postMessage({id,bytes});
        });
      }catch{inflating.delete(id);}
    }
  }
  return expandGzip(bytes);
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

export interface BasinSheet { id:string; box:Box; uv:Box }
export interface BasinAtlas { file:string; sheets:BasinSheet[] }
export interface TerrainMeta {
  basinTransport?: {file:string;box:Box;q:number;trackBox?:Box};
  otokuni?: RegionalPhotoMeta;
  aerialBasin?: BasinAtlas & {compact:BasinAtlas; mobile:BasinAtlas};
  /** Coarser outer mountains; the original basin grids retain priority. */
  outer?: GridMeta;
  sonobeElevation?: GridMeta;
  naraElevation?: GridMeta;
  aerialOuter?: RegionalPhotoMeta;
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
  kameokaCampus?:RegionalPhotoMeta & {elevation:GridMeta};
  byodoin?:RegionalPhotoMeta;
  tennozan?:RegionalPhotoMeta;
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

/** Decode before the first GPU upload. Data maps retain their original colour channels. */
export async function decodedTexture(url:string,priority?:RequestPriority){
  const loadImage=async(source:string)=>{
    const value=await new THREE.TextureLoader().loadAsync(source);
    await (value.image as HTMLImageElement).decode?.();
    return value;
  };
  let texture:THREE.Texture;
  if(typeof createImageBitmap==='function'){
    const res=await (priority?fetch(url,{priority}):fetch(url));
    if(!res.ok)throw new Error(url+' '+res.status);
    const blob=await res.blob();
    // WebGL unpack flags do not flip an ImageBitmap. Apply the same orientation as TextureLoader here.
    const bitmap=await createImageBitmap(blob,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'}).catch(()=>null);
    if(bitmap){
      texture=new THREE.Texture(bitmap);
      texture.flipY=false;
      texture.addEventListener('dispose',()=>bitmap.close());
    }else{
      const objectUrl=URL.createObjectURL(blob);
      try{texture=await loadImage(objectUrl);}
      finally{URL.revokeObjectURL(objectUrl);}
    }
  }else{
    texture=await loadImage(url);
  }
  texture.needsUpdate=true;
  return texture;
}

export async function loadTexture(file:string,maxAniso:number,priority?:RequestPriority){
  const texture=await decodedTexture(BASE+file,priority);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=maxAniso;
  texture.generateMipmaps=true;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.needsUpdate=true;
  return texture;
}

export async function loadJSON<T>(file: string): Promise<T> {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json() as Promise<T>;
}
