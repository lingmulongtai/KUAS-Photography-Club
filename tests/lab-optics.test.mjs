import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAperture, autoShutter, cameraEV, depthOfField, distanceFor, vfov } from '../src/scripts/lab/optics.ts';

test('sunny 16: f/16, ISO 100 and 1/125 s expose a sunny day', () => {
  assert.ok(Math.abs(cameraEV(16, 1 / 125, 100) - 15) < 0.1);
  assert.equal(autoShutter(15, 16, 100), 1 / 125);
  assert.equal(autoAperture(15, 1 / 125, 100), 16);
});

test('dolly framing keeps the subject size: longer lenses stand further back', () => {
  const near = distanceFor(24, 0.5);
  const far = distanceFor(200, 0.5);
  assert.ok(far / near > 8 && far / near < 8.5);
  // the frame really is 0.5 m tall at that distance
  assert.ok(Math.abs(2 * Math.tan(vfov(85) / 2) * distanceFor(85, 0.5) - 0.5) < 1e-9);
});

test('depth of field gets thinner wide open and on a smaller crop it gets deeper', () => {
  const open = depthOfField(85, 1.4, 2);
  const shut = depthOfField(85, 11, 2);
  assert.ok(open.far - open.near < shut.far - shut.near);
  assert.ok(open.near < 2 && open.far > 2);
  const ff = depthOfField(50, 2, 2);
  const phone = depthOfField(50 / 4.6, 2, 2, 4.6);
  assert.ok(phone.far - phone.near > ff.far - ff.near);
});
