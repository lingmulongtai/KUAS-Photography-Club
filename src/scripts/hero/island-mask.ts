/** Area in square metres of an outline x0, z0, x1, z1 … */
export function ringArea(r: Float32Array) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return Math.abs(a) / 2;
}

/**
 * Islands are the holes in the water areas. Garden ponds such as Kyoko-chi at the Golden
 * Pavilion hold small planted islands that the aerial photo, half water and half pine, never
 * marks as woodland, and the coarse water mask swallows: without this they showed as bare
 * flat cut-outs in the pond. Only islands of `minArea`..`maxArea` square metres count, so
 * stepping stones and long river sandbars stay open.
 */
export function islandMask(holes: Float32Array[], minArea = 12, maxArea = 12000) {
  const cells = new Map<string, Float32Array[]>();
  for (const r of holes) {
    const a = ringArea(r);
    if (a > maxArea || a < minArea) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
      z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
    }
    for (let cx = Math.floor(x0 / 128); cx <= Math.floor(x1 / 128); cx++) {
      for (let cz = Math.floor(z0 / 128); cz <= Math.floor(z1 / 128); cz++) {
        const key = `${cx},${cz}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(r);
      }
    }
  }
  const inside = (r: Float32Array, x: number, z: number) => {
    let hit = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
    }
    return hit;
  };
  return (x: number, z: number) => cells.get(`${Math.floor(x / 128)},${Math.floor(z / 128)}`)?.some((r) => inside(r, x, z)) ?? false;
}
