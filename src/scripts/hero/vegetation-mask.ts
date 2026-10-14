import type { BoxBuilding, PolyBuilding } from './buildings-data';

/** Spatial footprint lookup, built once; tree roots never sit inside measured buildings. */
export function createBuildingMask(boxes: BoxBuilding[], polys: PolyBuilding[]) {
  const cells = new Map<string, ((x: number, z: number) => boolean)[]>();
  const add = (x0: number, z0: number, x1: number, z1: number, hit: (x: number, z: number) => boolean) => {
    for (let x = Math.floor(x0 / 128); x <= Math.floor(x1 / 128); x++) {
      for (let z = Math.floor(z0 / 128); z <= Math.floor(z1 / 128); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(hit);
      }
    }
  };
  for (const b of boxes) {
    const radius = Math.hypot(b.w, b.d) / 2 + 6;
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    add(b.x - radius, b.z - radius, b.x + radius, b.z + radius, (x, z) => {
      const dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c + dz * s) < b.w / 2 + 5 && Math.abs(-dx * s + dz * c) < b.d / 2 + 5;
    });
  }
  for (const { ring } of polys) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    add(x0 - 5, z0 - 5, x1 + 5, z1 + 5, (x, z) => {
      let inside = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
        if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(1e-8, dx * dx + dz * dz)));
        if (Math.hypot(x - ax - t * dx, z - az - t * dz) < 5) return true;
      }
      return inside;
    });
  }
  return (x: number, z: number) => cells.get(`${Math.floor(x / 128)},${Math.floor(z / 128)}`)?.some(hit => hit(x, z)) ?? false;
}
