import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameMeter } from '../src/scripts/hero/frame-meter.ts';

test('submitted frame intervals provide a rolling FPS and a time-weighted average', () => {
  const meter = createFrameMeter();
  for (let t = 0; t <= 1000; t += 20) meter.frame(t);
  assert.deepEqual(meter.read(1000), { fps: 50, averageFps: 50, p95Ms: 20, overBudgetPercent: 0 });
  for (let t = 1050; t <= 2000; t += 50) meter.frame(t);
  const result = meter.read(2000);
  assert.equal(result.fps, 20);
  assert.equal(result.averageFps, 35);
  assert.equal(result.p95Ms, 50);
  assert.equal(result.overBudgetPercent, 20 * 100 / 70);
  assert.equal(meter.read(3500).fps, 0);
});

test('hidden time does not become a long frame, while a visible stall does', () => {
  const meter = createFrameMeter();
  meter.frame(0);
  assert.equal(meter.read(0).averageFps, null);
  meter.frame(20);
  meter.pause();
  assert.equal(meter.read(5000).fps, null);
  meter.frame(5000);
  meter.frame(5020);
  assert.equal(meter.read(5020).averageFps, 50);
  meter.frame(5520);
  assert.equal(meter.read(5520).p95Ms, 500);
});
