import {lonLat,tileXY} from './coordinates.ts';
import {cache,inflate,json} from './sources.ts';
import {toLocal,type Box} from '../hero/geo.ts';
import {SACRED,type SacredBuilding,type SacredKind} from './sacred-models.ts';

type RawSacredRow = [u16: number, v16: number, wDm: number, dDm: number, angleByte: number, hDm: number, kind: number];
interface SacredIndex { tiles: Record<string, number> }

export interface SacredSite extends SacredBuilding {
  lon: number;
  lat: number;
}

const isTorii = (kind: SacredKind) => kind === SACRED.torii || kind === SACRED.toriiStone;

/** Test whether a building footprint centre lies inside a procedural shrine/temple footprint. */
export function insideSacredFootprint(x: number, z: number, site: SacredBuilding) {
  if (isTorii(site.kind)) return false;
  const maxR = Math.max(site.w, site.d) * 0.6 + 1.5;
  const dx = x - site.x, dz = z - site.z;
  if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) return false;
  const c = Math.cos(site.angle), s = Math.sin(site.angle);
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return Math.abs(u) <= site.w * 0.56 + 1.1 && Math.abs(v) <= site.d * 0.56 + 1.1;
}

/** Fast 64 m spatial index for replacing generic buildings at shrine/temple footprints. */
export function sacredMatcher(sites: readonly SacredBuilding[]) {
  const bins = new Map<number, SacredBuilding[]>();
  const key = (cx: number, cz: number) => (cx + 16384) * 32768 + (cz + 16384);
  for (const s of sites) {
    if (isTorii(s.kind)) continue;
    const r = Math.max(s.w, s.d) * 0.6 + 2;
    for (let cx = Math.floor((s.x - r) / 64); cx <= Math.floor((s.x + r) / 64); cx++) {
      for (let cz = Math.floor((s.z - r) / 64); cz <= Math.floor((s.z + r) / 64); cz++) {
        const k = key(cx, cz);
        let list = bins.get(k);
        if (!list) { list = []; bins.set(k, list); }
        list.push(s);
      }
    }
  }
  return (x: number, z: number) => {
    const list = bins.get(key(Math.floor(x / 64), Math.floor(z / 64)));
    return !!list && list.some(s => insideSacredFootprint(x, z, s));
  };
}

export function decodeSacredTile(tx: number, ty: number, rows: RawSacredRow[]): SacredSite[] {
  return rows.map(([u16, v16, wDm, dDm, angByte, hDm, kind]) => {
    const [lon, lat] = lonLat(tx + u16 / 65535, ty + v16 / 65535, 12);
    const { x, z } = toLocal(lat, lon);
    return {
      lon,
      lat,
      x,
      z,
      w: wDm * 0.1,
      d: dDm * 0.1,
      angle: (angByte / 256) * Math.PI,
      h: hDm * 0.1,
      kind: kind as SacredKind,
      seed: ((u16 * 71.31 + v16 * 13.17) % 1000) / 1000,
    };
  });
}

let indexPromise: Promise<Set<string>> | undefined;
function sacredIndex() {
  indexPromise ??= json<SacredIndex>('sacred/index.json')
    .then(({ tiles }) => new Set(Object.keys(tiles)))
    .catch(error => {
      indexPromise = undefined;
      throw error;
    });
  return indexPromise;
}

const tileCache = cache(20, async (key: string) => {
  const [tx, ty] = key.split('/').map(Number);
  const res = await fetch('/kansai/sacred/' + tx + '-' + ty + '.json.gz');
  if (!res.ok) throw new Error('Sacred tile ' + key + ' ' + res.status);
  const rows: RawSacredRow[] = JSON.parse(new TextDecoder().decode(await inflate(new Uint8Array(await res.arrayBuffer()))));
  return decodeSacredTile(tx, ty, rows);
});

export async function sacredForZ16(x: number, y: number): Promise<SacredSite[]> {
  try {
    const available = await sacredIndex();
    const key = (x >> 4) + '/' + (y >> 4);
    if (!available.has(key)) return [];
    const [west, north] = lonLat(x, y, 16);
    const [east, south] = lonLat(x + 1, y + 1, 16);
    const all = await tileCache(key);
    return all.filter(s => s.lon >= west && s.lon < east && s.lat > south && s.lat <= north);
  } catch {
    return [];
  }
}

export async function sacredForBox(box: Box): Promise<SacredSite[]> {
  try {
    const available = await sacredIndex();
    const west = 135.7595 + box[0] / 91284.17129262601;
    const east = 135.7595 + box[2] / 91284.17129262601;
    const north = 35.0036 - box[1] / 110940.6404266756;
    const south = 35.0036 - box[3] / 110940.6404266756;
    const [x0, y0] = tileXY(west, north, 12).map(Math.floor);
    const [x1, y1] = tileXY(east, south, 12).map(Math.floor);
    const keys: string[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const k = tx + '/' + ty;
        if (available.has(k)) keys.push(k);
      }
    }
    const lists = await Promise.all(keys.map(k => tileCache(k)));
    const out: SacredSite[] = [];
    for (const list of lists) {
      for (const s of list) {
        if (s.x >= box[0] && s.x <= box[2] && s.z >= box[1] && s.z <= box[3]) out.push(s);
      }
    }
    return out;
  } catch {
    return [];
  }
}
