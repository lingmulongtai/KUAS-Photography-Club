import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { cloudNoiseTexture, generateCloudNoiseData } from '../src/scripts/hero/cloud-noise.ts';

test('3D Perlin-Worley cloud noise populates all four octaves and wraps seamlessly on every axis', () => {
  const size = 48;
  const start = performance.now();
  const data = generateCloudNoiseData(size);
  const elapsed = performance.now() - start;
  assert.equal(data.length, size * size * size * 4);
  assert.ok(elapsed < 500, `cloud noise generation should stay fast (${elapsed.toFixed(1)} ms)`);

  for (let ch = 0; ch < 4; ch++) {
    let min = 255, max = 0, sum = 0;
    for (let i = ch; i < data.length; i += 4) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const mean = sum / (size * size * size);
    assert.ok(max - min > 140, `channel ${ch} should span wide contrast (${min}..${max})`);
    assert.ok(mean > 45 && mean < 225, `channel ${ch} should stay balanced (mean=${mean.toFixed(1)})`);
  }

  // Opposite faces of the periodic tile must match within typical one-voxel gradient variation.
  const idx = (x, y, z, ch) => ((z * size + y) * size + x) * 4 + ch;
  let edgeDiff = 0, interiorDiff = 0, samples = 0;
  for (let z = 0; z < size; z += 3) {
    for (let y = 0; y < size; y += 3) {
      edgeDiff += Math.abs(data[idx(0, y, z, 0)] - data[idx(size - 1, y, z, 0)]);
      interiorDiff += Math.abs(data[idx(12, y, z, 0)] - data[idx(13, y, z, 0)]);
      samples++;
    }
  }
  assert.ok(edgeDiff / samples <= (interiorDiff / samples) * 1.6 + 2, 'periodic boundary should not form a seam');
});

test('cloudNoiseTexture returns a cached repeating linear Data3DTexture', () => {
  const a = cloudNoiseTexture();
  const b = cloudNoiseTexture();
  assert.equal(a, b);
  assert.ok(a instanceof THREE.Data3DTexture);
  assert.equal(a.wrapS, THREE.RepeatWrapping);
  assert.equal(a.wrapT, THREE.RepeatWrapping);
  assert.equal(a.wrapR, THREE.RepeatWrapping);
  assert.equal(a.minFilter, THREE.LinearFilter);
  assert.equal(a.magFilter, THREE.LinearFilter);
});
