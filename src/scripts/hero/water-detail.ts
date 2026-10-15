import type { LineFeature } from './lines-data';

export interface WaterDetail {
  baseChecksum:number;
  replace:number[];
  polygons:{outer:number[];holes:number[][]}[];
}

/** Also works in the LAN preview where Web Crypto requires a secure origin. */
export function waterChecksum(bytes:Uint8Array) {
  let h=2166136261;
  for(const value of bytes) h=Math.imul(h^value,16777619)>>>0;
  return h;
}

/** Replace water rings only; every road/rail object and unrelated water ring is retained. */
export function applyWaterDetail(base:LineFeature[],detail:WaterDetail,checksum:number) {
  if(checksum!==detail.baseChecksum) throw new Error('Water detail does not match lines.bin');
  const removed=new Set(detail.replace);
  if(detail.replace.some(i=>!base[i]||(base[i].kind!==2&&base[i].kind!==3))) throw new Error('Water detail refers to a non-water feature');
  const out=base.filter((_,i)=>!removed.has(i));
  for(const polygon of detail.polygons) {
    out.push({kind:2,attr:1,pts:new Float32Array(polygon.outer)});
    for(const hole of polygon.holes) out.push({kind:3,attr:1,pts:new Float32Array(hole)});
  }
  return out;
}
