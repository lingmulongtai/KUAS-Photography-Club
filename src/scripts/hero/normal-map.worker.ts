import { Heightfield } from './heightfield';
import { normalMaps } from './normal-map';
import type { GridMeta } from './data';

self.onmessage = async ({ data }: MessageEvent<{ terrain: ReturnType<Heightfield['snapshot']>; grids: GridMeta[] }>) => {
  try {
    const terrain = Heightfield.fromSnapshot(data.terrain);
    const maps = await normalMaps(terrain, data.grids, async () => {});
    self.postMessage(maps, { transfer: Object.values(maps).map(map => map.buffer) });
  } catch {
    self.postMessage(null);
  }
};
