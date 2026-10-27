import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkyTime, wrapDay } from '../src/scripts/hero/sky-time.ts';

test('the sky follows the current Kyoto time until a time is chosen', () => {
  const sky = createSkyTime();
  assert.equal(sky.live, true);
  assert.equal(sky.shown(420, 0), 420);
  assert.equal(sky.shown(421, 10), 421);
});

test('scrubbing changes the sky and cloud position together, including across midnight', () => {
  const sky = createSkyTime();
  sky.scrub(1439, 1380, 0);
  assert.equal(sky.shown(1380, 0), 1439);
  assert.equal(sky.clouds(0), 59);
  sky.scrub(0, 1380, 1);
  assert.equal(sky.shown(1380, 1), 0);
  assert.equal(sky.clouds(1), -1380);
  assert.equal(sky.live, false);
});

test('presets take the short way and live mode resumes after the transition', () => {
  const sky = createSkyTime();
  sky.scrub(1430, 1400, 0);
  sky.select(10, false, 1400, 100, false);
  assert.equal(wrapDay(sky.shown(1400, 1500)), 0);
  assert.equal(sky.clouds(1500), 40);
  sky.select(30, true, 30, 2900, true);
  assert.equal(sky.live, true);
  assert.equal(sky.shown(31, 2900), 31);
});

test('interrupting a preset preserves the cloud position and stops the animation', () => {
  const sky = createSkyTime();
  sky.select(720, false, 600, 0, false);
  assert.equal(sky.shown(600, 1400), 660);
  sky.scrub(690, 600, 1400);
  assert.equal(sky.shown(600, 1400), 690);
  assert.equal(sky.clouds(1400), 90);
  assert.equal(sky.transitioning, false);
});
