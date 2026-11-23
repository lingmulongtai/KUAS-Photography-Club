import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {plazaSurface,replacesKyotoStation} from '../src/scripts/hero/kyoto-station.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('only the station main block is replaced; platform roofs are retained',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});const data=await loadBuildings();
  assert.equal(data.polys.filter(p=>replacesKyotoStation(p.ring)).length,1);
  assert.ok(data.polys.some(p=>p.ring[0]>-250&&p.ring[0]<180&&p.ring[1]>2080&&p.ring[1]<2140&&!replacesKyotoStation(p.ring)));
});

async function verifyDistrictAsset(filename) {
  const file = await readFile(new URL('../public/kyoto/' + filename, import.meta.url));
  assert.equal(file.toString('ascii', 0, 4), 'glTF');
  assert.equal(file.readUInt32LE(8), file.length);
  const model = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)));
  assert.ok(model.extensionsRequired.includes('EXT_meshopt_compression'));
  assert.ok(model.images.every(image => image.mimeType === 'image/webp' && Number.isInteger(image.bufferView)));
  assert.equal(model.images.length, 10);
  let triangles = 0;
  for (const mesh of model.meshes) for (const primitive of mesh.primitives) triangles += model.accessors[primitive.indices].count / 3;
  const bounds = new THREE.Box3();
  for (const node of model.nodes.filter(node => node.mesh !== undefined)) {
    for (const primitive of model.meshes[node.mesh].primitives) {
      const pos = model.accessors[primitive.attributes.POSITION];
      for (const point of [pos.min, pos.max]) {
        bounds.expandByPoint(new THREE.Vector3(...point)
          .multiply(new THREE.Vector3(...node.scale)).add(new THREE.Vector3(...node.translation)));
      }
    }
  }
  assert.ok(bounds.min.x < -460 && bounds.max.x > 370 && bounds.max.x < 385);
  assert.ok(bounds.min.z < -350 && bounds.max.z < 55);
  assert.ok(bounds.max.y > 59 && bounds.max.y < 80, 'the detailed district leaves the tower to its landmark');
  assert.ok(!model.materials.some(material => material.name.startsWith('District tower ')));
  assert.ok(model.materials.some(material => material.name.startsWith('District facade ')));
  assert.ok(model.materials.some(material => material.name.startsWith('Plaza-')));
  assert.ok(model.materials.some(material => material.name === 'Atrium glazing'));
  assert.ok(model.meshes.some(mesh => mesh.primitives.some(primitive =>
    model.materials[primitive.material].name === 'KYcb0061_org.001'
  )), 'the opaque station envelope can be selected for planar wall lighting');
  return {bytes: file.length, triangles};
}

test('every station profile retains the surveyed district, embedded photos and plaza', async () => {
  const full = await verifyDistrictAsset('kyoto-station-district.glb');
  const compact = await verifyDistrictAsset('kyoto-station-district-compact.glb');
  const far = await verifyDistrictAsset('kyoto-station-district-far.glb');
  assert.ok(compact.bytes < full.bytes * .85, 'the compact detail profile reduces the download');
  assert.ok(far.bytes < full.bytes * .3, 'the distant profile is a fraction of the detail download');
  assert.ok(far.triangles < full.triangles * .35, 'the distant profile is simplified from the detail model');
});

test('plaza layers take street surfaces instead of their survey display colours', async () => {
  const file = await readFile(new URL('../public/kyoto/kyoto-station-district.glb', import.meta.url));
  const model = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)));
  const surface = material => plazaSurface({name: material.name,
    color: new THREE.Color().fromArray(material.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1])});
  const kinds = Object.fromEntries(model.materials.filter(m => m.name.startsWith('Plaza-'))
    .map(m => [m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).map(v => v.toFixed(2)).join(','), surface(m)]));
  assert.deepEqual(kinds, {'0.92,0.92,0.92': 2, '0.19,0.30,0.00': 3, '0.32,0.32,0.32': 1, '0.50,0.50,0.50': 1});
  assert.equal(surface(model.materials.find(m => m.name.startsWith('District facade'))), 0);
});

test('the station replacement indices match the shipped city footprints', async () => {
  const matches = JSON.parse(await readFile(new URL('../src/data/kyoto-station-replacements.json', import.meta.url), 'utf8'));
  const file = await readFile(new URL('../public/kyoto/buildings.bin', import.meta.url));
  assert.equal(createHash('sha256').update(file).digest('hex'), matches.buildingsSha256);
  assert.equal(matches.boxes.length + matches.polys.length, 211);
  assert.ok(matches.boxes.some(([,survey]) => survey === 26));
  assert.ok(matches.polys.some(([,survey]) => survey === 95));
});
