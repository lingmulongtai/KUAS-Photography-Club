import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingMask } from '../src/scripts/hero/vegetation-mask.ts';

test('tree exclusions follow rotated footprints, polygon edges and spatial cell boundaries', () => {
  const hit = createBuildingMask([{x:128,z:0,w:30,d:10,angle:Math.PI/2,h:12,ground:0,kind:0}], [{ring:new Float32Array([300,0,330,0,330,30,300,30]),h:10,ground:0,kind:1}]);
  assert.equal(hit(128,14),true);
  assert.equal(hit(142,0),false);
  assert.equal(hit(315,15),true);
  assert.equal(hit(297,15),true);
  assert.equal(hit(290,15),false);
  assert.equal(hit(10000,10000),false);
});
