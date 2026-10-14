import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SPOTS} from '../src/data/spots.ts';
import {completeSpotPreviews,SPOT_SAMPLES} from '../src/data/spot-samples.ts';
test('every spot has a clearly marked preview and stable detail URL',()=>{
  const previews=completeSpotPreviews([]);
  assert.deepEqual(previews.map(t=>t.spot),SPOTS.map(s=>s.id));
  assert.ok(previews.every(t=>t.sample&&t.href===`/trips/spots/${t.spot}/`&&t.credit.includes('サンプル')));
});
test('published records replace design samples for their spot',()=>{
  const real={...SPOT_SAMPLES[0],sample:false,href:'/trips/real/'};
  const previews=completeSpotPreviews([SPOT_SAMPLES[0],real]);
  assert.deepEqual(previews.filter(t=>t.spot===real.spot),[real]);
  assert.equal(new Set(previews.map(t=>t.spot)).size,17);
});
