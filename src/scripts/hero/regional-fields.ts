import {classifyRings,VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {lonLat,tileXY} from '../kansai/coordinates';
import {inflate,json} from '../kansai/sources';
import {M_PER_DEG_LAT,M_PER_DEG_LON,ORIGIN,toLocal,type Box} from './geo';
import {FIELD,PADDY,RELIEF_CELL,type GroundFeature} from './ground-relief-data';

type FieldsIndex = { tiles: [number, number][] };

/** Exact outer terrain box already covered by public/kyoto/ground-relief/. */
const KYOTO_RELIEF_BOX: Box = [-35000, -20000, 14000, 36000];

const cellKey = (cx: number, cz: number) => cx + ',' + cz;

function signedArea2(ring: Float32Array) {
  let area = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return area;
}

function z12RangeForCell(cx: number, cz: number) {
  const minX = cx * RELIEF_CELL, minZ = cz * RELIEF_CELL;
  const maxX = minX + RELIEF_CELL, maxZ = minZ + RELIEF_CELL;
  const west = ORIGIN.lon + minX / M_PER_DEG_LON;
  const east = ORIGIN.lon + maxX / M_PER_DEG_LON;
  const north = ORIGIN.lat - minZ / M_PER_DEG_LAT;
  const south = ORIGIN.lat - maxZ / M_PER_DEG_LAT;
  const [x0, y0] = tileXY(west, north, 12).map(Math.floor);
  const [x1, y1] = tileXY(east, south, 12).map(Math.floor);
  return { x0, y0, x1, y1 };
}

/** Stream MAFF 2026 paddy and dry-field parcels across all five Kansai prefectures
 * outside the pre-baked Kyoto ground-relief sheets. */
export function createRegionalFields() {
  let available: Set<string> | undefined;
  let loadingIndex: Promise<Set<string>> | undefined;
  const tileCache = new Map<string, Promise<Map<string, GroundFeature[]>>>();

  async function ensureIndex() {
    if (available) return available;
    loadingIndex ??= json<FieldsIndex>('fields/index.json')
      .then(({ tiles }) => {
        available = new Set(tiles.map(([x, y]) => x + '/' + y));
        return available;
      })
      .catch(error => {
        loadingIndex = undefined;
        throw error;
      });
    return loadingIndex;
  }

  function decodeTile(tx: number, ty: number) {
    const key = tx + '/' + ty;
    const hit = tileCache.get(key);
    if (hit) {
      tileCache.delete(key);
      tileCache.set(key, hit);
      return hit;
    }
    const work = (async () => {
      const res = await fetch('/kansai/fields/' + key + '.pbf.gz');
      if (!res.ok) throw new Error('Regional fields ' + key + ' ' + res.status);
      const bytes = new Uint8Array(await inflate(new Uint8Array(await res.arrayBuffer())));
      const layer = new VectorTile(new Pbf(bytes)).layers.fields;
      const bins = new Map<string, GroundFeature[]>();
      if (!layer) return bins;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const kind = f.properties.kind === 1 ? PADDY : f.properties.kind === 2 ? FIELD : 0;
        if (!kind) continue;
        const extent = f.extent;
        for (const group of classifyRings(f.loadGeometry())) {
          const paths: Float32Array[] = [];
          for (const ring of group) {
            const n = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y
              ? ring.length - 1 : ring.length;
            if (n < 3) continue;
            const out = new Float32Array(n * 2);
            for (let k = 0; k < n; k++) {
              const [lon, lat] = lonLat(tx + ring[k].x / extent, ty + ring[k].y / extent, 12);
              const local = toLocal(lat, lon);
              out[k * 2] = local.x;
              out[k * 2 + 1] = local.z;
            }
            if (Math.abs(signedArea2(out)) < 60) {
              if (!paths.length) break;
              continue;
            }
            paths.push(out);
          }
          if (!paths.length) continue;
          const outer = paths[0];
          let sx = 0, sz = 0;
          const verts = outer.length / 2;
          for (let k = 0; k < outer.length; k += 2) { sx += outer[k]; sz += outer[k + 1]; }
          const mx = sx / verts, mz = sz / verts;
          // Parcels inside Kyoto's pre-baked relief extent are already served by ground-relief/*.bin.
          if (mx >= KYOTO_RELIEF_BOX[0] && mx <= KYOTO_RELIEF_BOX[2] && mz >= KYOTO_RELIEF_BOX[1] && mz <= KYOTO_RELIEF_BOX[3]) continue;
          const ck = cellKey(Math.floor(mx / RELIEF_CELL), Math.floor(mz / RELIEF_CELL));
          let list = bins.get(ck);
          if (!list) { list = []; bins.set(ck, list); }
          list.push({ kind, paths });
        }
      }
      return bins;
    })().catch(error => {
      if (tileCache.get(key) === work) tileCache.delete(key);
      throw error;
    });
    tileCache.set(key, work);
    if (tileCache.size > 6) tileCache.delete(tileCache.keys().next().value!);
    return work;
  }

  return {
    ready: () => !!available,
    ensureIndex,
    hasCell(cx: number, cz: number) {
      if (!available) return false;
      const minX = cx * RELIEF_CELL, minZ = cz * RELIEF_CELL;
      const maxX = minX + RELIEF_CELL, maxZ = minZ + RELIEF_CELL;
      // Skip cells wholly inside Kyoto's pre-baked ground-relief extent.
      if (minX >= KYOTO_RELIEF_BOX[0] && maxX <= KYOTO_RELIEF_BOX[2] && minZ >= KYOTO_RELIEF_BOX[1] && maxZ <= KYOTO_RELIEF_BOX[3]) {
        return false;
      }
      const { x0, y0, x1, y1 } = z12RangeForCell(cx, cz);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (available.has(tx + '/' + ty)) return true;
        }
      }
      return false;
    },
    async features(cx: number, cz: number): Promise<GroundFeature[]> {
      const tiles = await ensureIndex();
      const { x0, y0, x1, y1 } = z12RangeForCell(cx, cz);
      const wanted: [number, number][] = [];
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (tiles.has(tx + '/' + ty)) wanted.push([tx, ty]);
        }
      }
      if (!wanted.length) return [];
      const key = cellKey(cx, cz);
      const lists = await Promise.all(wanted.map(([tx, ty]) => decodeTile(tx, ty)));
      const out: GroundFeature[] = [];
      for (const bins of lists) {
        const items = bins.get(key);
        if (items) out.push(...items);
      }
      return out;
    },
  };
}
