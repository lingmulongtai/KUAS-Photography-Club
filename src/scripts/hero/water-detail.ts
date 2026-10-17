import type { LineFeature } from './lines-data';

export interface WaterDetail {
  baseChecksum:number;
  replace:number[];
  polygons:{outer:number[];holes:number[][]}[];
  attr?:number;
}

/** Also works in the LAN preview where Web Crypto requires a secure origin. */
export function waterChecksum(bytes:Uint8Array) {
  let h=2166136261;
  for(const value of bytes) h=Math.imul(h^value,16777619)>>>0;
  return h;
}

/** Replace water rings only; every road/rail object and unrelated water ring is retained. */
export function applyWaterDetail(base:LineFeature[],detail:WaterDetail,checksum:number) {
  return applyWaterDetails(base,[detail],checksum);
}

/** Patches refer to the original indices, so combine them before removing any rings. */
export function applyWaterDetails(base:LineFeature[],details:WaterDetail[],checksum:number) {
  const removed=new Set<number>();
  for(const detail of details) {
    if(checksum!==detail.baseChecksum) throw new Error('Water detail does not match lines.bin');
    if(detail.replace.some(i=>!base[i]||(base[i].kind!==2&&base[i].kind!==3))) throw new Error('Water detail refers to a non-water feature');
    if(detail.replace.some(i=>removed.has(i)))throw new Error('Overlapping water patches require a combined source');
    detail.replace.forEach(i=>removed.add(i));
  }
  const out=base.filter((_,i)=>!removed.has(i));
  for(const detail of details)for(const polygon of detail.polygons) {
    out.push({kind:2,attr:detail.attr??1,pts:new Float32Array(polygon.outer)});
    for(const hole of polygon.holes) out.push({kind:3,attr:detail.attr??1,pts:new Float32Array(hole)});
  }
  return out;
}
