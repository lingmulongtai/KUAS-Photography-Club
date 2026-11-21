import test from 'node:test';
import assert from 'node:assert/strict';
import {createFieldInteriors} from '../src/scripts/hero/field-interiors.ts';

test('a parcel clears procedural forest across cell edges while preserving holes and adjacent woods',()=>{
  const mask=createFieldInteriors();
  const outer=new Float32Array([-530,-50,-485,-50,-485,20,-530,20]);
  const hole=new Float32Array([-515,-15,-515,-5,-505,-5,-505,-15]);
  assert.equal(mask.addCell('-1,-1',[[outer,hole]]),true);
  assert.equal(mask.addCell('-1,-1',[[outer,hole]]),false);
  assert.equal(mask.contains(-520,-20),true);
  assert.equal(mask.contains(-495,5),true);
  assert.equal(mask.contains(-509,-12),false);
  assert.equal(mask.contains(-485+0.01,-12),false);
});
