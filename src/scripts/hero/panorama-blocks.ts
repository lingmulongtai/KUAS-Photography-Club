import type { BoxBuilding } from './buildings-data';

export interface PlacedHouse {
  b: BoxBuilding;
  y: number;
  seed: number;
  /** Preserve the roof profile of a measured house when joining a row. */
  roofSource?: BoxBuilding;
}

/** Join only adjoining low-rise footprints with similar eaves and roof directions. */
function adjoining(a: PlacedHouse, b: PlacedHouse): PlacedHouse | undefined {
  const first = a.b, next = b.b;
  if (first.kind !== next.kind || Math.abs(a.y - b.y) > 1.5 || Math.abs(first.h - next.h) > 2) return;
  const difference = next.angle - first.angle;
  const parallel = Math.abs(Math.cos(difference)), skew = Math.abs(Math.sin(difference));
  if (parallel < .985) return;
  const cos = Math.cos(first.angle), sin = Math.sin(first.angle);
  const dx = next.x - first.x, dz = next.z - first.z;
  const along = dx * cos + dz * sin, across = dz * cos - dx * sin;
  const halfW = (next.w * parallel + next.d * skew) / 2, halfD = (next.d * parallel + next.w * skew) / 2;
  if (Math.abs(along) > first.w / 2 + halfW + 2 || Math.abs(across) > first.d / 2 + halfD + 2) return;
  const left = Math.min(-first.w / 2, along - halfW), right = Math.max(first.w / 2, along + halfW);
  const back = Math.min(-first.d / 2, across - halfD), front = Math.max(first.d / 2, across + halfD);
  const w = right - left, d = front - back;
  const area = first.w * first.d + next.w * next.d;
  // A diagonal pair or a courtyard must not become a rectangular building.
  if (w > 48 || d > 20 || d > w || w * d * .82 > area) return;
  const x = (left + right) / 2, z = (back + front) / 2;
  const weight = next.w * next.d / area;
  return {
    b: { ...first, x: first.x + x * cos - z * sin, z: first.z + x * sin + z * cos, w, d, h: first.h + (next.h - first.h) * weight },
    y: a.y + (b.y - a.y) * weight, seed: a.seed, roofSource: first,
  };
}

export function panoramaHouses(houses: PlacedHouse[], protectedBuilding: (house: BoxBuilding) => boolean) {
  const result: PlacedHouse[] = [];
  const cells = new Map<string, number[]>();
  for (const house of houses) {
    const b = house.b;
    if (b.h > 13 || b.w > 25 || b.d > 16 || b.w * b.d > 200 || (b.kind >> 2) > 2 || protectedBuilding(b)) {
      result.push(house);
      continue;
    }
    const key = Math.floor(b.x / 40) + ',' + Math.floor(b.z / 40);
    let row = cells.get(key);
    if (!row) cells.set(key, row = []);
    let joined = false;
    for (let i = 0; i < row.length; i++) {
      const index = row[i];
      const pair = adjoining(result[index], house);
      if (!pair) continue;
      result[index] = pair;
      row.splice(i, 1);
      joined = true;
      break;
    }
    if (!joined) row.push(result.push(house) - 1);
  }
  return result;
}
