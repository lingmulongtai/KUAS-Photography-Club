import type { GridMeta } from './data';
import type { Heightfield } from './heightfield';
import { normalMaps } from './normal-map';

export async function initialNormals(terrain: Heightfield, grids: GridMeta[]) {
  if (typeof Worker !== 'undefined') {
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('./normal-map.worker.ts', import.meta.url), { type: 'module' });
      const active = worker;
      return await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        active.onmessage = event => event.data ? resolve(event.data) : reject(new Error('Terrain worker failed'));
        active.onerror = reject;
        active.onmessageerror = reject;
        active.postMessage({ terrain: terrain.snapshot(), grids });
      });
    } catch (error) {
      console.warn('Preparing terrain normals on the main thread', error);
    } finally {
      worker?.terminate();
    }
  }
  return normalMaps(terrain, grids);
}
