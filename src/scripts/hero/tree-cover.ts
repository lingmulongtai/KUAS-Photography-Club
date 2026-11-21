import type { Box } from './geo';

export interface TreeCover {
  box: Box;
  width: number;
  height: number;
  /** WorldCover tree-covered area in fifteenths, or 16 for open cropland and water. */
  cells: Uint8Array;
}

export function decodeTreeCover(bytes: Uint8Array): TreeCover {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || header.getUint32(0) !== 0x4b544331) throw new Error('Invalid tree cover header');
  const x = header.getInt32(4, true), z = header.getInt32(8, true);
  const step = header.getUint32(12, true), width = header.getUint32(16, true), height = header.getUint32(20, true);
  if (!width || !height || !step || bytes.length !== 24 + width * height) throw new Error('Invalid tree cover grid');
  return { box: [x, z, x + step * width, z + step * height], width, height, cells: bytes.subarray(24) };
}
