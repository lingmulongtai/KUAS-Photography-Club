import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';

const bundle = buildSync({
  stdin: {
    contents: `export {createRegionalFields} from './src/scripts/hero/regional-fields';
export {toLocal} from './src/scripts/hero/geo';
export {PADDY,FIELD,RELIEF_CELL} from './src/scripts/hero/ground-relief-data';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const publicRoot = new URL('../public/', import.meta.url);
const localFetch = async url => {
  const bytes = readFileSync(new URL(String(url).replace(/^\//, ''), publicRoot));
  return { ok: true, status: 200, json: async () => JSON.parse(bytes.toString('utf8')), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const mod = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
  module: mod,
  fetch: localFetch,
  Response,
  Blob,
  DecompressionStream,
  Uint8Array,
  Float32Array,
  Map,
  Set,
});
const { createRegionalFields, toLocal, PADDY, FIELD, RELIEF_CELL } = mod.exports;

test('regional MAFF fields supply paddies and dry fields outside Kyoto relief bounds across all outer prefectures', async () => {
  const rf = createRegionalFields();
  await rf.ensureIndex();
  // Inside Kyoto core: delegated to pre-baked ground-relief/*.bin
  const kyoto = toLocal(35.01, 135.76);
  assert.equal(rf.hasCell(Math.floor(kyoto.x / RELIEF_CELL), Math.floor(kyoto.z / RELIEF_CELL)), false);

  // Outer Kansai farmland areas: Omihachiman (Shiga), Kashihara (Nara), Himeji plains (Hyogo), Sakai/Izumi (Osaka)
  const spots = [
    ['Omihachiman (Shiga)', 35.145, 136.115],
    ['Kashihara (Nara)', 34.495, 135.785],
    ['Himeji / Kakogawa (Hyogo)', 34.815, 134.82],
    ['Izumi / Sakai (Osaka)', 34.48, 135.46],
  ];
  for (const [name, lat, lon] of spots) {
    const p = toLocal(lat, lon);
    const cx = Math.floor(p.x / RELIEF_CELL), cz = Math.floor(p.z / RELIEF_CELL);
    assert.equal(rf.hasCell(cx, cz), true, name + ' has MAFF fields');
    // Search immediate 3x3 cells so a spot near a village centre still hits surrounding parcels.
    let paddies = 0, fields = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = await rf.features(cx + dx, cz + dz);
        for (const f of list) {
          if (f.kind === PADDY) paddies++;
          if (f.kind === FIELD) fields++;
          assert.ok(f.paths.length >= 1 && f.paths[0].length >= 6);
        }
      }
    }
    assert.ok(paddies + fields > 20, `${name} produced ${paddies} paddies and ${fields} dry fields`);
  }
});
