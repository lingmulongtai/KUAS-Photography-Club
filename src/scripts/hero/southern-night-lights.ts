import type { GridMeta } from './data.ts';

type Grid = Pick<GridMeta, 'file' | 'nx' | 'nz'>;

/** White alpha in the slope maps means no emission. Keep the three normal channels intact. */
export function applySouthernNightLights(bytes: Uint8Array, grids: readonly (Grid | undefined)[], normals: Record<string, Uint8Array>) {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const sheets = grids.map(grid => {
    if (offset + 8 > bytes.length) throw new Error('Incomplete southern lighting header');
    const nx = header.getUint16(offset, true), nz = header.getUint16(offset+2, true);
    const first = header.getUint16(offset+4, true), rows = header.getUint16(offset+6, true);
    offset += 8;
    const end = offset + rows*nx, normal = grid && normals[grid.file];
    if (!nx || !rows || first+rows > nz || end > bytes.length || (grid && (grid.nx !== nx || grid.nz !== nz)) ||
        (normal && normal.length !== nx*nz*4)) throw new Error('Southern lighting grid mismatch');
    const light = bytes.subarray(offset, end);
    offset = end;
    return {normal, light, firstPixel: first*nx};
  });
  if (offset !== bytes.length) throw new Error('Unexpected southern lighting data');
  for (const {normal, light, firstPixel} of sheets) {
    if (!normal) continue;
    for (let i = 0, alpha = firstPixel*4+3; i < light.length; i++, alpha+=4) normal[alpha] = 255-light[i];
  }
}
