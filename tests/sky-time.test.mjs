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
  assert.equal(wrapDay(sky.shown(1400, 2200)), 0);
  assert.equal(sky.clouds(2200), 40);
  sky.select(30, true, 30, 4300, true);
  assert.equal(sky.live, true);
  assert.equal(sky.shown(31, 4300), 31);
});

test('interrupting a preset preserves the cloud position and stops the animation', () => {
  const sky = createSkyTime();
  sky.select(720, false, 600, 0, false);
  assert.equal(sky.shown(600, 2100), 660);
  sky.scrub(690, 600, 2100);
  assert.equal(sky.shown(600, 2100), 690);
  assert.equal(sky.clouds(2100), 90);
  assert.equal(sky.transitioning, false);
});

test('returning to live time starts gently, accelerates, and settles',()=>{
  const sky=createSkyTime();sky.scrub(0,0,0);sky.select(600,true,600,0,false);
  const points=[0,420,1050,2100,3150,3780,4200].map(t=>sky.shown(600,t));
  assert.ok(points[1]<10,'the first tenth starts slowly');
  assert.ok(points[3]-points[2]>points[2]-points[1],'the middle speeds up');
  assert.ok(600-points[5]<10,'the last tenth settles gently');
  assert.equal(points[6],600);assert.equal(sky.transitioning,false);
});
