import { loadBinary, loadJSON } from './data.ts';
import type { Box } from './geo';

/** Building classes and uses as stored in buildings.bin (see tools/kyoto-data/build_buildings.py). */
export const CLASS = { wooden: 0, sturdy: 1, shed: 3 } as const;
export const USAGE = { unknown: 0, house: 1, apartment: 2, shop: 3, office: 4, hotel: 5, public: 6, works: 7 } as const;

export interface BoxBuilding {
  x: number;
  z: number;
  /** long side (along the angle) and short side, metres */
  w: number;
  d: number;
  angle: number;
  h: number;
  ground: number;
  kind: number;
}

export interface PolyBuilding {
  /** outline x0, z0, x1, z1 … in metres, counter-clockwise seen from above */
  ring: Float32Array;
  h: number;
  ground: number;
  kind: number;
}

interface Meta {
  box: Box;
  q: number;
  boxes: number;
  polys: number;
  points: number;
}

export async function loadBuildings(metaFile='buildings.json',binFile='buildings.bin') {
  const [meta, bytes] = await Promise.all([loadJSON<Meta>(metaFile), loadBinary(binFile)]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nb = dv.getUint32(0, true);
  const np = dv.getUint32(4, true);
  const npts = dv.getUint32(8, true);
  let o = 12;
  const u16 = (n: number) => {
    const out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = bytes[o + i] | (bytes[o + n + i] << 8);
    o += 2 * n;
    return out;
  };
  const u8 = (n: number) => {
    const out = bytes.subarray(o, o + n);
    o += n;
    return out;
  };
  const i8 = (n: number) => {
    const out = new Int8Array(bytes.buffer, bytes.byteOffset + o, n);
    o += n;
    return out;
  };
  const dx = u16(nb);
  const dz = u16(nb);
  const w = u8(nb);
  const d = u8(nb);
  const ang = u8(nb);
  const h = u8(nb);
  const g = i8(nb);
  const kind = u8(nb);
  const pn = u8(np);
  const ph = u8(np);
  const pk = u8(np);
  const pg = i8(np);
  const pdx = u16(npts);
  const pdz = u16(npts);

  const q = meta.q;
  const [minX, minZ] = meta.box;
  const boxes: BoxBuilding[] = new Array(nb);
  let x = 0;
  let z = 0;
  for (let i = 0; i < nb; i++) {
    x = (x + dx[i]) & 0xffff;
    z = (z + dz[i]) & 0xffff;
    boxes[i] = {
      x: minX + x * q,
      z: minZ + z * q,
      w: w[i] * q,
      d: d[i] * q,
      angle: (ang[i] / 256) * Math.PI,
      h: h[i] * 0.5,
      ground: g[i] * q,
      kind: kind[i],
    };
  }
  const polys: PolyBuilding[] = new Array(np);
  x = 0;
  z = 0;
  let k = 0;
  for (let i = 0; i < np; i++) {
    const ring = new Float32Array(pn[i] * 2);
    for (let j = 0; j < pn[i]; j++, k++) {
      x = (x + pdx[k]) & 0xffff;
      z = (z + pdz[k]) & 0xffff;
      ring[j * 2] = minX + x * q;
      ring[j * 2 + 1] = minZ + z * q;
    }
    polys[i] = { ring, h: ph[i] * 0.5, ground: pg[i] * q, kind: pk[i] };
  }
  return { boxes, polys };
}
