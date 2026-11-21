import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { applySouthernNightLights } from '../src/scripts/hero/southern-night-lights.ts';

const root = new URL('../public/kyoto/', import.meta.url);
const {far, outer} = JSON.parse(await readFile(new URL('terrain.json', root), 'utf8'));
const file = await readFile(new URL('southern-night-lights.bin', root));
const light = gunzipSync(file);

test('shipped surface lights continue past Takeda on both terrain grids without touching normals', () => {
  assert.ok(file.length < 100_000);
  const maps = Object.fromEntries([far,outer].map(g => [g.file, new Uint8Array(g.nx*g.nz*4).fill(255)]));
  applySouthernNightLights(light, [far,outer], maps);
  for (const g of [far,outer]) {
    const data = maps[g.file];
    const mean = (x0,z0,x1,z1) => {
      let sum = 0, count = 0;
      for (let j = 0; j < g.nz; j++) {
        const z = g.box[1] + (j+.5)/g.nz*(g.box[3]-g.box[1]);
        if (z < z0 || z >= z1) continue;
        for (let i = 0; i < g.nx; i++) {
          const x = g.box[0] + (i+.5)/g.nx*(g.box[2]-g.box[0]);
          if (x >= x0 && x < x1) { sum += 255-data[(j*g.nx+i)*4+3]; count++; }
        }
      }
      return sum/count;
    };
    const north = mean(-1500,6030,900,6200), south = mean(-1500,6200,900,6500);
    assert.ok(north > 15 && south/north > .65 && south/north < 1.5, 'no artificial drop at the core data boundary');
    assert.ok(mean(1000,11000,3400,14000) > 10, 'the Uji area remains lit at a distance');
    assert.ok(mean(1950,-8000,2930,-7100) > 15, 'Iwakura streets remain visible from the central basin');
    assert.ok(mean(900,-12260,1480,-11730) > 1 && mean(6020,-13200,6530,-12700) > 4, 'northern valley settlements have lights');
    assert.equal(mean(-3500,-11200,-3000,-10900),0,'a wooded northern ridge stays dark');
    assert.equal(mean(-1500,1800,900,2600), 0, 'the core retains its existing lighting');
    assert.ok(data.every((value,i) => i%4 === 3 || value === 255));
  }
});

test('an incomplete sheet leaves the fallback intact; the basin can also render without the outer grid', () => {
  const maps = { [far.file]: new Uint8Array(far.nx*far.nz*4).fill(255) };
  assert.throws(() => applySouthernNightLights(light.subarray(0,-1), [far,outer], maps));
  assert.ok(maps[far.file].every(value => value === 255));
  applySouthernNightLights(light, [far,undefined], maps);
  assert.ok(maps[far.file].some(value => value < 255));
});
