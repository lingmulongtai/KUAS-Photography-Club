import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookRotation } from '../src/scripts/hero/look-controls.ts';

test('look can complete multiple turns while pitch avoids the poles', () => {
  const look = createLookRotation();
  look.move(-10000, 10000, 800, 600, .016);
  look.step(1, false);
  assert.ok(look.state.yaw > 720);
  assert.equal(look.state.pitch, 89);
  look.move(10000, -10000, 800, 600, .016);
  look.step(1, false);
  assert.equal(look.state.pitch, -75);
  const before = look.state.yaw;
  look.move(3200, 0, 800, 600, .016);
  assert.ok(look.state.yaw < before - 700);
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
