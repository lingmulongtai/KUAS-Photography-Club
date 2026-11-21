export const RELIEF_CELL = 512;
export const CELLS_PER_SHEET = 8;
export const RELIEF_SHEET = RELIEF_CELL * CELLS_PER_SHEET;
export const PADDY = 1, FIELD = 2, BANK = 3;

export interface GroundFeature {
  kind: typeof PADDY | typeof FIELD | typeof BANK;
  /** Local metres, in x,z order. Field interiors follow the exterior ring.
   * A bank is an open line with water on its left in the x,z plane. */
  paths: Float32Array[];
}
export type GroundIndex = Record<string, number[]>;

export function groundSheet(cx: number, cz: number) {
  const x = Math.floor(cx / CELLS_PER_SHEET), z = Math.floor(cz / CELLS_PER_SHEET);
  const cell = cx - x * CELLS_PER_SHEET + (cz - z * CELLS_PER_SHEET) * CELLS_PER_SHEET;
  return { key: `${x}_${z}`, x, z, cell };
}

/** Read the small cell directory without decoding a whole rural valley into JS objects. */
export function readGroundSheet(bytes: Uint8Array, sx: number, sz: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x4b475231) throw new Error('Unknown ground relief format');
  const cells = new Map<number, { offset: number; count: number }>();
  let at = 5;
  for (let i = 0; i < view.getUint8(4); i++) {
    const id = view.getUint8(at), count = view.getUint16(at + 1, true);
    at += 3;
    if (id >= CELLS_PER_SHEET ** 2 || cells.has(id)) throw new Error('Invalid ground cell');
    cells.set(id, { offset: at, count });
    for (let j = 0; j < count; j++) {
      const kind = view.getUint8(at++), paths = view.getUint8(at++);
      if (kind < PADDY || kind > BANK || !paths || (kind === BANK && paths !== 1)) throw new Error('Invalid ground feature');
      for (let p = 0; p < paths; p++) {
        const length = view.getUint16(at, true);
        if (length < (kind === BANK ? 2 : 3)) throw new Error('Invalid ground path');
        at += 2 + length * 4;
      }
    }
  }
  if (at !== bytes.byteLength) throw new Error('Invalid ground sheet length');
  return {
    cells,
    *features(id: number): Generator<GroundFeature> {
      const cell = cells.get(id);
      if (!cell) return;
      let offset = cell.offset;
      for (let i = 0; i < cell.count; i++) {
        const kind = view.getUint8(offset++) as GroundFeature['kind'], count = view.getUint8(offset++);
        const paths: Float32Array[] = [];
        for (let p = 0; p < count; p++) {
          const length = view.getUint16(offset, true);
          offset += 2;
          const path = new Float32Array(length * 2);
          for (let j = 0; j < path.length; j += 2, offset += 4) {
            path[j] = sx * RELIEF_SHEET + .5 * view.getInt16(offset, true);
            path[j+1] = sz * RELIEF_SHEET + .5 * view.getInt16(offset + 2, true);
          }
          paths.push(path);
        }
        yield { kind, paths };
      }
    },
  };
}
