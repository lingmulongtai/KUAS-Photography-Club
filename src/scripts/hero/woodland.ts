export type Ring = [number, number][];
export interface Woodland { outer: Ring[]; holes: Ring[] }

export function inRing(x: number, z: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Relations retain their holes; cell lookup avoids scanning the entire city's forest. */
export function createWoodlandMask(polygons: Woodland[]) {
  const cells = new Map<string, Woodland[]>();
  for (const polygon of polygons) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const ring of polygon.outer) for (const [x, z] of ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    for (let x = Math.floor(x0 / 512); x <= Math.floor(x1 / 512); x++) for (let z = Math.floor(z0 / 512); z <= Math.floor(z1 / 512); z++) {
      const key = `${x},${z}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(polygon);
    }
  }
  return (x: number, z: number) => cells.get(`${Math.floor(x / 512)},${Math.floor(z / 512)}`)?.some(p => p.outer.some(r => inRing(x, z, r)) && !p.holes.some(r => inRing(x, z, r))) ?? false;
}
