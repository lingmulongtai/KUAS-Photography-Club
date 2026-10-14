import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookRotation } from '../src/scripts/hero/look-controls.ts';

test('city look remains bounded through large drags and inertia', () => {
  const look = createLookRotation();
  look.move(-10000, 10000, 800, 600, .016);
  look.step(1, false);
  assert.equal(look.state.yaw, 75);
  assert.equal(look.state.pitch, 12);
  look.move(10000, -10000, 800, 600, .016);
  look.step(1, false);
  assert.equal(look.state.yaw, -75);
  assert.equal(look.state.pitch, -25);
});

test('inertia is independent of frame rate and disabled for reduced motion', () => {
  const a = createLookRotation(), b = createLookRotation();
  a.move(12, 4, 800, 600, .1);
  b.move(12, 4, 800, 600, .1);
  a.step(.1, false);
  for (let i = 0; i < 10; i++) b.step(.01, false);
  assert.ok(Math.abs(a.state.yaw - b.state.yaw) < 1e-10);
  const yaw = a.state.yaw;
  a.step(.5, true);
  assert.equal(a.state.yaw, yaw);
  assert.equal(a.state.vx, 0);
  a.reset();
  assert.deepEqual(a.state, {yaw:0, pitch:0, vx:0, vy:0, dragging:false});
});
