// Bake the average emission of surface streets into the existing 30 m and 100 m terrain grids.
// Run with node --experimental-strip-types tools/kyoto-data/build-southern-night-lights.mjs.
import {readFile, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {BUILDINGS_BOX} from '../../src/scripts/hero/geo.ts';
import {LINE, loadLines} from '../../src/scripts/hero/lines-data.ts';
import {regionAt} from '../../src/scripts/hero/regional-loader.ts';
import {withoutTunnels} from '../../src/scripts/hero/tunnels.ts';

const root = new URL('../../public/kyoto/', import.meta.url);
globalThis.fetch = async url => new Response(await readFile(new URL(String(url).replace(/^\/kyoto\//, ''), root)));
const {regions} = JSON.parse(await readFile(new URL('regions.json', root), 'utf8'));
const {far, outer} = JSON.parse(await readFile(new URL('terrain.json', root), 'utf8'));
const grids = [far, outer].map(meta => ({...meta, light: new Float32Array(meta.nx * meta.nz)}));
const boundary = BUILDINGS_BOX[3];
const overlap = 240; // Metres of core streets for filtering across the Takeda boundary.
const litWidth = [0, 6, 12, 32, 45]; // Integrated light per metre, by the road ranks used by buildLamps.

function deposit(grid, x, z, energy) {
  const {box, nx, nz, step, light} = grid;
  // Match the texel centres used by the terrain shader and preserve energy across grid resolutions.
  const col = (x - box[0]) / (box[2] - box[0]) * nx - .5;
  const row = (z - box[1]) / (box[3] - box[1]) * nz - .5;
  const i = Math.floor(col), j = Math.floor(row);
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    if (i+dx < 0 || j+dy < 0 || i+dx >= nx || j+dy >= nz) continue;
    const weight = (dx ? col-i : 1-(col-i)) * (dy ? row-j : 1-(row-j));
    light[(j+dy)*nx+i+dx] += energy * weight / (step*step);
  }
}

// The manifest order also decides which overlapping region the running scene activates.
// Count each street once even where the Uji, southern Kyoto and Tennozan sheets overlap.
for (const region of [null, ...regions.filter(r => r.box[3] > boundary)]) {
  const lines = await withoutTunnels(region ? loadLines(undefined, region.lines.file, region.lines.box, region.lines.q) : loadLines());
  for (const {kind, attr, pts} of lines) {
    const width = litWidth[attr & 15];
    if (kind !== LINE.road || !width) continue;
    for (let i = 0; i+3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i+1], dx = pts[i+2]-ax, dz = pts[i+3]-az;
      if (Math.max(az, az+dz) < boundary-overlap) continue;
      const length = Math.hypot(dx, dz), count = Math.ceil(length / 12);
      for (let s = 0; s < count; s++) {
        const t = (s+.5)/count, x = ax + dx*t, z = az + dz*t;
        if (z < boundary-overlap) continue;
        const inCore = x >= BUILDINGS_BOX[0] && x < BUILDINGS_BOX[2] && z < boundary;
        if (region ? inCore || regionAt(regions, {x,z}) !== region : !inCore) continue;
        for (const grid of grids) deposit(grid, x, z, width * length / count);
      }
    }
  }
}

// Each sheet stores its dimensions and just the affected rows. The default outside is zero emission.
const chunks = [];
for (const {nx, nz, light} of grids) {
  const pixels = Uint8Array.from(light, density => Math.round(31 * (1-Math.exp(-density))) * 8);
  const start = Math.floor(pixels.findIndex(value => value > 0) / nx);
  const end = Math.floor(pixels.findLastIndex(value => value > 0) / nx) + 1;
  if (start < 0) throw new Error('No southern streets in terrain grid');
  const header = Buffer.alloc(8);
  [nx,nz,start,end-start].forEach((value, i) => header.writeUInt16LE(value, i*2));
  chunks.push(header, pixels.subarray(start*nx, end*nx));
}
const bytes = gzipSync(Buffer.concat(chunks), {level:9});
await writeFile(new URL('southern-night-lights.bin', root), bytes);
console.log(`Southern road lighting: ${bytes.length} bytes`);
