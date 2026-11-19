import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalMapBytes } from '../src/scripts/hero/normal-map.ts';

// Independent reference: the previous hf.normal + normalTexture calculation.
function reference(height, { box, step, nx, nz }) {
  const data = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = box[0] + i * step, z = box[1] + j * step;
    const normalX = -(height(x + step, z) - height(x - step, z)) / (2 * step);
    const normalZ = -(height(x, z + step) - height(x, z - step)) / (2 * step);
    const length = Math.hypot(normalX, 1, normalZ), o = (j * nx + i) * 4;
    data[o] = Math.round((normalX / length * 0.5 + 0.5) * 255);
    data[o + 1] = Math.round((1 / length * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((normalZ / length * 0.5 + 0.5) * 255);
    data[o + 3] = 255;
  }
  return data;
}

test('normal maps preserve every RGBA byte on slopes, curved terrain and boundary cliffs', async () => {
  const surfaces = [() => 0, (x, z) => x * 0.5 + z * 0.25,
    (x, z) => Math.sin(x / 71) * 133 + Math.cos(z / 32) * 47,
    (x, z) => x < -100 || z > 80 ? 0 : Math.sin(x / 13) * 200 + z];
  for (const height of surfaces) for (const step of [1, 10, 30, 100]) {
    const grid = { box: [-123, -240, 0, 0], step, nx: 37, nz: 35 };
    const actual = await normalMapBytes({ height }, grid, async () => {});
    assert.deepEqual(actual, reference(height, grid));
  }
});

test('fractional coordinates retain the previous sampling arithmetic and precision', async () => {
  const height = (x, z) => 200 * Math.sin(x * 17) + 500 * Math.cos(z * 13);
  const grid = { box: [0.3, -1.1, 0, 0], step: 0.1, nx: 31, nz: 33 };
  assert.deepEqual(await normalMapBytes({ height }, grid, async () => {}), reference(height, grid));
});

test('shared rows sample each halo height once and pause before all work has finished', async () => {
  const grid = { box: [-100, 50, 0, 0], step: 10, nx: 37, nz: 50 };
  let calls = 0, yields = 0;
  const callsAtPause = [];
  const height = (x, z) => { calls++; return x * 0.13 + z * 0.72; };
  const output = await normalMapBytes({ height }, grid, async () => { yields++; callsAtPause.push(calls); });
  assert.equal(calls, (grid.nx + 2) * (grid.nz + 2));
  assert.equal(yields, 3);
  assert.ok(callsAtPause[0] < calls / 2, 'the first task yields before half the grid is sampled');
  assert.ok(callsAtPause.every((value, i) => !i || value - callsAtPause[i - 1] <= (grid.nx + 2) * 16));
  assert.deepEqual(output, reference((x, z) => x * 0.13 + z * 0.72, grid));
});

test('metadata is snapshotted before task boundaries', async () => {
  const height = (x, z) => Math.sin(x / 7) * 30 + z;
  const grid = { box: [-120, 60, 0, 0], step: 10, nx: 21, nz: 35 };
  const expected = reference(height, grid);
  const actual = await normalMapBytes({ height }, grid, async () => {
    grid.box[0] += 1000; grid.step = 100; grid.nx = 2; grid.nz = 2;
  });
  assert.deepEqual(actual, expected);
});

test('the default scheduler lets another task run before returning a complete map', async () => {
  let otherTaskRan = false;
  const channel = new MessageChannel();
  const otherTask = new Promise(resolve => {
    channel.port1.onmessage = () => { otherTaskRan = true; channel.port1.close(); channel.port2.close(); resolve(); };
  });
  channel.port2.postMessage(null);
  const data = await normalMapBytes({ height: () => 0 }, { box: [0, 0, 0, 0], step: 10, nx: 32, nz: 64 });
  assert.equal(otherTaskRan, true);
  assert.equal(data.length, 32 * 64 * 4);
  await otherTask;
});
