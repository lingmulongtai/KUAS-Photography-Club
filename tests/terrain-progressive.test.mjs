import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

function loadTerrainModule() {
  const compiled = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: "export { buildTerrain } from './src/scripts/hero/terrain.ts';",
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['three'],
    write: false,
  }).outputFiles[0].text;
  const mod = { exports: {} };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', compiled)(id => id === 'three' ? THREE : require(id), mod, mod.exports);
  return mod.exports;
}

function trackedTexture(label) {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.name = label;
  tex.disposed = false;
  const origDispose = tex.dispose.bind(tex);
  tex.dispose = () => { tex.disposed = true; origDispose(); };
  return tex;
}

test('progressive terrain texture upgrades retarget placeholders and dispose replaced textures safely', () => {
  const { buildTerrain } = loadTerrainModule();
  const wideLow = trackedTexture('wide-low');
  const wideHigh = trackedTexture('wide-high');
  const cityLow = trackedTexture('city-low');
  const cityHigh = trackedTexture('city-high');
  const outerLow = trackedTexture('outer-low');
  const outerHigh = trackedTexture('outer-high');
  const normal = trackedTexture('normal');
  const hf = { bounds: [-1000, -1000, 1000, 1000], height: () => 50 };
  const sheetsLow = [
    { id: 'city', box: [-500, -500, 500, 500], uv: [0, 0.5, 0.5, 1] },
    { id: 'south', box: [-500, 500, 500, 1000], uv: [0, 0, 0.5, 0.5] },
  ];
  const sheetsHigh = [
    { id: 'city', box: [-500, -500, 500, 500], uv: [0, 0.55, 1, 1] },
    { id: 'south', box: [-500, 500, 500, 1000], uv: [0, 0, 0.5, 0.55] },
  ];

  const terrain = buildTerrain({}, hf, { x: 0, z: 0 }, {
    aerialWide: wideLow,
    aerialWideBox: [-1000, -1000, 1000, 1000],
    aerialCity: cityLow,
    aerialCityBox: [-500, -500, 500, 500],
    sheets: sheetsLow,
    normalFar: normal,
    normalFarBox: [-1000, -1000, 1000, 1000],
    normalNear: normal,
    normalNearBox: [-500, -500, 500, 500],
    outer: { normal, photo: outerLow, box: [-2000, -2000, 2000, 2000] },
    photos: [[-500, -500, 500, 500], [0, 0, 500, 500]],
  }, 8);

  // Placeholder slots initially point at wideLow.
  assert.equal(terrain.uniforms.uRegionRoads.value, wideLow);
  assert.equal(terrain.uniforms.uWoodland.value, wideLow);
  assert.equal(terrain.uniforms.uKamoMask.value, wideLow);

  // Upgrading wide retargets all placeholder references and disposes wideLow.
  terrain.setAerialWide(wideHigh);
  assert.equal(wideLow.disposed, true);
  assert.equal(terrain.uniforms.uAerialWide.value, wideHigh);
  assert.equal(terrain.uniforms.uRegionRoads.value, wideHigh);
  assert.equal(terrain.uniforms.uWoodland.value, wideHigh);
  assert.equal(terrain.uniforms.uKamoMask.value, wideHigh);
  terrain.setPhoto(0, null);
  assert.equal(terrain.mesh.children[0].material.uniforms.uPhoto0.value, wideHigh);

  // Upgrading basin atlas updates UVs and disposes cityLow without touching wideHigh.
  terrain.setAerialCity(cityHigh, sheetsHigh);
  assert.equal(cityLow.disposed, true);
  assert.equal(wideHigh.disposed, false);
  assert.equal(terrain.uniforms.uAerialCity.value, cityHigh);
  assert.deepEqual(terrain.uniforms.uSheetUVs.value[0].toArray(), [0, 0.55, 1, 1]);

  // Upgrading outer photo disposes outerLow.
  terrain.setOuterPhoto(outerHigh);
  assert.equal(outerLow.disposed, true);
  assert.equal(terrain.uniforms.uOuterPhoto.value, outerHigh);
});
