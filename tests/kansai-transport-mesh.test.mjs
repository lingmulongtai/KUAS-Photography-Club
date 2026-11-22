import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';

const bundle = buildSync({
  stdin: {
    contents: `export * from './src/scripts/kansai/transport-mesh';
export {Mesh} from './src/scripts/kansai/mesh';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const mod = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, { module: mod });
const { bridgeClearance, clipSegment, drawBridgePolyline, drawRailPolyline, Mesh } = mod.exports;

const bounds = [135.5, 34.65, 135.51, 34.66];
const xyz = ([lon, lat], h) => [(lon - 135.505) * 91500, (lat - 34.655) * 111000, h];

test('bridge clearance distinguishes river crossings from elevated expressways and upper decks', () => {
  assert.ok(bridgeClearance(0, false, '都道府県道') < 2);
  assert.ok(bridgeClearance(1, false, '国道') >= 6);
  assert.ok(bridgeClearance(0, true, '高速自動車国道等') >= 6);
  assert.ok(bridgeClearance(2, true, '高速自動車国道等') >= 10);
});

test('level-0 river bridges ramp cleanly down to surface road elevation and add concrete parapets', () => {
  const mesh = new Mesh();
  const pts = [[135.502, 34.655], [135.505, 34.655], [135.508, 34.655]];
  drawBridgePolyline(mesh, pts, bounds, () => 10, xyz, { width: 10, clearance: 1.35 });
  assert.ok(mesh.positions.length > 0);
  const zs = [];
  for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]);
  // Approach meets surface road (~10.32m), parapets rise above the 11.35m deck without jumping to 16.8m.
  assert.ok(Math.min(...zs) < 10.4, 'approach or footing reaches surface elevation');
  assert.ok(Math.max(...zs) > 11.8 && Math.max(...zs) < 12.5, 'parapet stays near river-bridge clearance');
});

test('elevated bridges clip to tile bounds and build oriented piers along north-south spans', () => {
  const mesh = new Mesh();
  const pts = [[135.505, 34.648], [135.505, 34.662]];
  const clipped = clipSegment(pts[0], pts[1], bounds);
  assert.ok(clipped && Math.abs(clipped[0][1] - 34.65) < 1e-9 && Math.abs(clipped[1][1] - 34.66) < 1e-9);
  drawBridgePolyline(mesh, pts, bounds, () => 5, xyz, { width: 16, clearance: 6.2 });
  let pierFaces = 0;
  for (let i = 0; i < mesh.colors.length; i += 12) {
    if (mesh.colors[i] === 124 && mesh.colors[i + 1] === 121 && mesh.colors[i + 2] === 112) pierFaces++;
  }
  assert.ok(pierFaces >= 12, 'oriented twin-column piers generated along elevated span');
});

test('surface and elevated railways emit ballast, steel rails, and Shinkansen sound walls', () => {
  const surface = new Mesh();
  drawRailPolyline(surface, [[135.502, 34.655], [135.506, 34.655]], bounds, () => 12, xyz, {
    raised: false, doubleTrack: true, shinkansen: false, monorail: false, tram: false, lvorder: 0,
  });
  let steelTris = 0;
  for (let i = 0; i < surface.colors.length; i += 12) {
    if (surface.colors[i] === 172 && surface.colors[i + 1] === 174) steelTris++;
  }
  assert.ok(steelTris >= 8, 'double track emits four steel rails');

  const shinkansen = new Mesh();
  drawRailPolyline(shinkansen, [[135.502, 34.655], [135.506, 34.655]], bounds, () => 12, xyz, {
    raised: true, doubleTrack: false, shinkansen: true, monorail: false, tram: false, lvorder: 1,
  });
  let maxZ = -Infinity;
  for (let i = 2; i < shinkansen.positions.length; i += 3) maxZ = Math.max(maxZ, shinkansen.positions[i]);
  assert.ok(maxZ > 19.1, 'elevated Shinkansen viaduct includes raised concrete sound walls');
});
