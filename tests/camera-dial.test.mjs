import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestStop, stepIndex } from '../src/scripts/controls/camera-dial.ts';
import { FOCAL_STOPS, FOCUS_STOPS } from '../src/data/camera-settings.ts';
test('dial steps and end keys remain in range', () => {
  assert.equal(stepIndex(0,8,-3),0);
  assert.equal(stepIndex(7,8,3),8);
  assert.equal(stepIndex(4,8,1),5);
});
test('presets and autofocus distances map to their standard dial stops', () => {
  for (const v of [16,24,35,50,85,135,200]) assert.equal(FOCAL_STOPS[nearestStop(FOCAL_STOPS,v)],v);
  assert.equal(FOCUS_STOPS[nearestStop(FOCUS_STOPS,3)],3);
  assert.equal(nearestStop(FOCUS_STOPS,.01),0);
  assert.equal(nearestStop(FOCUS_STOPS,1000),FOCUS_STOPS.length-1);
});
