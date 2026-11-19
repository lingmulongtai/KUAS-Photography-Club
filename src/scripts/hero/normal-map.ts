import type { GridMeta } from './data.ts';
import type { Heightfield } from './heightfield.ts';

/** Yield a browser task without nested setTimeout's minimum-delay clamp. */
function yieldTask(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Bake the original central-difference normals, sharing heights without rounding them to Float32. */
export async function normalMapBytes(
  hf: Pick<Heightfield, 'height'>,
  meta: Pick<GridMeta, 'box' | 'step' | 'nx' | 'nz'>,
  pause: () => Promise<void> = yieldTask,
): Promise<Uint8Array> {
  // Snapshot metadata before the first task boundary.
  const { box: [minX, minZ], step, nx, nz } = meta;
  const data = new Uint8Array(nx * nz * 4);
  const stride = nx + 2;
  // The shipped grids use integer world coordinates. A fractional grid keeps the
  // original sample arithmetic, since (x + step) can round differently from x(i+1).
  const shared = Number.isInteger(minX) && Number.isInteger(minZ) && Number.isInteger(step);
  const rows = shared ? new Float64Array(stride * 3) : null;
  const fill = (offset: number, row: number) => {
    const z = minZ + row * step;
    for (let i = -1; i <= nx; i++) rows![offset + i + 1] = hf.height(minX + i * step, z);
  };
  let previous = 0, current = stride, next = stride * 2;
  if (rows) { fill(previous, -1); fill(current, 0); }
  for (let j = 0; j < nz; j++) {
    if (rows) fill(next, j + 1);
    const z = minZ + j * step;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * step;
      const dx = rows ? rows[current + i + 2] - rows[current + i] : hf.height(x + step, z) - hf.height(x - step, z);
      const dz = rows ? rows[next + i + 1] - rows[previous + i + 1] : hf.height(x, z + step) - hf.height(x, z - step);
      const normalX = -dx / (2 * step), normalZ = -dz / (2 * step);
      const length = Math.hypot(normalX, 1, normalZ);
      const o = (j * nx + i) * 4;
      data[o] = Math.round((normalX / length * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((1 / length * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((normalZ / length * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
    const oldPrevious = previous;
    previous = current; current = next; next = oldPrevious;
    // Paint and input can run between batches; the texture is published only when complete.
    if ((j + 1) % 16 === 0 && j + 1 < nz) await pause();
  }
  return data;
}
