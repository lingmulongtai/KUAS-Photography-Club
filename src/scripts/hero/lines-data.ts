import { loadBinary } from './data';
import { BUILDINGS_BOX } from './geo';
import {applyWaterDetail,waterChecksum,type WaterDetail} from './water-detail';

/** Kinds of features in lines.bin (see tools/kyoto-data/build_lines.py). */
export const LINE = { road: 0, rail: 1, water: 2, waterHole: 3 } as const;

export interface LineFeature {
  kind: number;
  /** road: width rank 0..4 | category << 4; rail: 1 elevated | 2 multi-track */
  attr: number;
  /** x0, z0, x1, z1 … metres */
  pts: Float32Array;
}

export async function loadLines(waterFile?:string) {
  const bytes = await loadBinary('lines.bin');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(0, true);
  let o = 4;
  const kinds = bytes.subarray(o, o + count);
  o += count;
  const attrs = bytes.subarray(o, o + count);
  o += count;
  const ns = new Uint16Array(count);
  for (let i = 0; i < count; i++) ns[i] = dv.getUint16(o + i * 2, true);
  o += count * 2;
  let total = 0;
  for (let i = 0; i < count; i++) total += ns[i];
  const read = (off: number, i: number) => ((bytes[off + i] | (bytes[off + total + i] << 8)) << 16) >> 16;
  const ox = o;
  const oz = o + total * 2;
  const [minX, minZ] = BUILDINGS_BOX;
  const out: LineFeature[] = new Array(count);
  let x = 0;
  let z = 0;
  let k = 0;
  for (let i = 0; i < count; i++) {
    const pts = new Float32Array(ns[i] * 2);
    for (let j = 0; j < ns[i]; j++, k++) {
      x += read(ox, k);
      z += read(oz, k);
      pts[j * 2] = minX + x * 0.5;
      pts[j * 2 + 1] = minZ + z * 0.5;
    }
    out[i] = { kind: kinds[i], attr: attrs[i], pts };
  }
  if(!waterFile) return out;
  try {
    const detail=JSON.parse(new TextDecoder().decode(await loadBinary(waterFile))) as WaterDetail;
    return applyWaterDetail(out,detail,waterChecksum(bytes));
  } catch(error) {
    console.warn('Regional water unavailable; retaining base water',error);
    return out;
  }
}
