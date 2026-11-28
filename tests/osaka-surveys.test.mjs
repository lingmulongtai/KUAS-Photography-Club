import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = async name => JSON.parse(await readFile(new URL('../public/kansai/landmarks/' + name, import.meta.url), 'utf8'));
const inside = ([lon, lat], ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

test('surveyed Umeda districts replace the generic buildings they cover', async () => {
  const surveys = await read('osaka-surveys.json');
  const index = await read('index.json');
  for (const record of surveys) assert.ok(index.some(r => r.id === record.id && r.file === record.file), record.id);
  const covered = (lon, lat) => surveys.some(r => r.rings.some(ring => inside([lon, lat], ring)));
  assert.ok(covered(135.49018, 34.70532), 'Umeda Sky Building');
  // The station hall itself is an LOD1 extrusion in the survey and stays in the regional layer.
  assert.ok(covered(135.49525, 34.70296), 'Osaka Station City North Gate Building');
  assert.ok(covered(135.50028, 34.70232), 'HEP FIVE');
});

test('district GLBs carry surveyed geometry with a per-building facade seed', async () => {
  for (const {file} of await read('osaka-surveys.json')) {
    const bytes = await readFile(new URL('../public' + file, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.match(doc.asset.copyright, /PLATEAU/);
    assert.ok(doc.meshes[0].primitives.every(p => p.attributes._FEATURE !== undefined && p.attributes.NORMAL !== undefined));
    assert.ok(doc.images.length && doc.images.every(i => i.mimeType === 'image/webp'));
    assert.ok(bytes.length < 6e6, file + ' stays a modest download');
  }
});
