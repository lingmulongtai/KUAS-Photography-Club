import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntroCameraMotion } from '../src/scripts/hero/intro-camera.ts';

test('the opening look starts only when visible and returns gently to its original view', () => {
  const motion = createIntroCameraMotion();
  for (let i = 0; i < 300; i++) motion.step(1 / 60, false, false);
  assert.deepEqual(motion.offset, { yaw: 0, pitch: 0 });
  const values = [];
  for (let i = 0; i < 14 * 60; i++) {
    motion.step(1 / 60, true, false);
    values.push({ ...motion.offset });
  }
  assert.ok(values[60].yaw > 0 && values[60].yaw < .3, 'starts gently');
  assert.ok(Math.max(...values.map(v => v.yaw)) > 2.5, 'the view actually turns');
  assert.ok(values.every(v => Math.abs(v.yaw) < 3.1 && Math.abs(v.pitch) < .05));
  assert.ok(values.every((v, i) => i === 0 || Math.abs(v.yaw - values[i-1].yaw) < .03), 'no jumps');
  assert.ok(Math.abs(motion.offset.yaw) < .001 && Math.abs(motion.offset.pitch) < .001);
  motion.step(5, true, false);
  assert.deepEqual(motion.offset, { yaw: 0, pitch: 0 }, 'does not restart');
});

test('manual input takes over the current angle and reduced motion stays still', () => {
  const motion = createIntroCameraMotion();
  motion.step(3, true, false);
  const visibleAngle = { ...motion.offset };
  assert.deepEqual(motion.stop(), visibleAngle);
  motion.step(3, true, false);
  assert.deepEqual(motion.offset, { yaw: 0, pitch: 0 });
  const reduced = createIntroCameraMotion();
  reduced.step(10, true, true);
  assert.deepEqual(reduced.offset, { yaw: 0, pitch: 0 });
});
