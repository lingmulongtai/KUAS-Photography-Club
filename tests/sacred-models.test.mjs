import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {tileXY} from '../src/scripts/kansai/coordinates.ts';
import {SACRED,buildSacredGeometry} from '../src/scripts/kansai/sacred-models.ts';
import {decodeSacredTile,insideSacredFootprint,sacredMatcher} from '../src/scripts/kansai/sacred-sites.ts';

const sacredRoot = new URL('../public/kansai/sacred/', import.meta.url);

test('procedural sacred models build valid geometry with slope skirts for all seven kinds', () => {
  const ground = () => 42;
  for (const [name, kind] of Object.entries(SACRED)) {
    const isTorii = kind === SACRED.torii || kind === SACRED.toriiStone;
    const isPagoda = kind === SACRED.pagoda;
    const h = isPagoda ? 28 : isTorii ? 7.5 : 11;
    const geo = buildSacredGeometry([{
      x: 100, z: -200,
      w: isPagoda ? 9 : isTorii ? 8 : 18,
      d: isPagoda ? 9 : isTorii ? 1.4 : 13,
      angle: 0.45,
      h,
      kind,
      seed: 0.37,
    }], ground);
    assert.ok(geo, `expected geometry for ${name}`);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const col = geo.getAttribute('aColor');
    const glow = geo.getAttribute('aGlow');
    assert.ok(pos.count >= 36, `${name} should have enough triangles`);
    assert.equal(nrm.count, pos.count);
    assert.equal(col.count, pos.count);
    assert.equal(glow.count, pos.count);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(y) && Number.isFinite(pos.getZ(i)));
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      assert.ok(Math.abs(len - 1) < 1e-3, `${name} normal length ${len}`);
    }
    assert.ok(minY < 41, `${name} should carry a below-ground slope skirt (minY=${minY})`);
    assert.ok(maxY > 42 + h * 0.85, `${name} should reach target height (maxY=${maxY})`);
    geo.dispose();
  }
});

test('sacred footprint matcher replaces hall footprints and leaves buildings under torii intact', () => {
  const hall = { x: 500, z: -300, w: 20, d: 12, angle: Math.PI / 6, h: 12, kind: SACRED.temple };
  const gate = { x: 500, z: -260, w: 8, d: 1.5, angle: 0, h: 7, kind: SACRED.torii };
  assert.equal(insideSacredFootprint(500, -300, hall), true);
  assert.equal(insideSacredFootprint(506, -296, hall), true);
  assert.equal(insideSacredFootprint(525, -300, hall), false);
  assert.equal(insideSacredFootprint(500, -260, gate), false);

  const match = sacredMatcher([hall, gate]);
  assert.equal(match(500, -300), true);
  assert.equal(match(500, -260), false);
  assert.equal(match(0, 0), false);
});

test('shipped sacred site catalog covers all five Kansai prefectures and decodes famous landmarks', () => {
  const index = JSON.parse(readFileSync(new URL('index.json', sacredRoot), 'utf8'));
  for (const code of ['25', '26', '27', '28', '29']) {
    assert.ok((index.byPrefecture[code] ?? 0) > 200, `prefecture ${code} should have broad shrine/temple coverage`);
  }
  assert.ok((index.byKind['0'] ?? 0) > 1000, 'temples present');
  assert.ok(((index.byKind['1'] ?? 0) + (index.byKind['2'] ?? 0)) > 1000, 'shrines present');
  assert.ok((index.byKind['3'] ?? 0) > 15, 'pagodas present');
  assert.ok((index.byKind['4'] ?? 0) > 50, 'sacred gates present');
  assert.ok(((index.byKind['5'] ?? 0) + (index.byKind['6'] ?? 0)) > 40, 'torii present');

  let checkedRows = 0;
  for (const [key, expected] of Object.entries(index.tiles)) {
    const [tx, ty] = key.split('/').map(Number);
    const rows = JSON.parse(gunzipSync(readFileSync(new URL(`${tx}-${ty}.json.gz`, sacredRoot))));
    assert.equal(rows.length, expected, `row count for ${key}`);
    checkedRows += rows.length;
    for (const r of rows) {
      assert.equal(r.length, 7);
      assert.ok(r[2] >= 15 && r[3] >= 8 && r[5] >= 25 && r[6] >= 0 && r[6] <= 6);
    }
  }
  assert.equal(checkedRows, index.total);

  // Verify real famous shrines & temples across all 5 prefectures exist near their coordinates.
  const famous = [
    { name: 'Shitenno-ji (Osaka)', lon: 135.5165, lat: 34.6537, kinds: [SACRED.temple, SACRED.pagoda, SACRED.gate] },
    { name: 'Sumiyoshi Taisha (Osaka)', lon: 135.4930, lat: 34.6126, kinds: [SACRED.shrine, SACRED.shrineVermilion, SACRED.torii] },
    { name: 'Ikuta Shrine (Hyogo)', lon: 135.1906, lat: 34.6948, kinds: [SACRED.shrine, SACRED.shrineVermilion] },
    { name: 'Kofuku-ji (Nara)', lon: 135.8313, lat: 34.6833, kinds: [SACRED.temple, SACRED.pagoda] },
    { name: 'Hiyoshi Taisha (Shiga)', lon: 135.8620, lat: 35.0715, kinds: [SACRED.shrine, SACRED.shrineVermilion] },
    { name: 'Higashi Hongan-ji (Kyoto)', lon: 135.7587, lat: 34.9912, kinds: [SACRED.temple, SACRED.gate] },
  ];
  for (const spot of famous) {
    const [tx, ty] = tileXY(spot.lon, spot.lat, 12).map(Math.floor);
    const key = `${tx}/${ty}`;
    assert.ok(index.tiles[key] > 0, `tile ${key} missing for ${spot.name}`);
    const rows = JSON.parse(gunzipSync(readFileSync(new URL(`${tx}-${ty}.json.gz`, sacredRoot))));
    const sites = decodeSacredTile(tx, ty, rows);
    const nearby = sites.filter(s =>
      Math.hypot((s.lon - spot.lon) * 91284, (s.lat - spot.lat) * 110941) < 180 && spot.kinds.includes(s.kind),
    );
    assert.ok(nearby.length > 0, `expected sacred structures near ${spot.name}`);
  }
});
