import {test} from 'node:test';
import assert from 'node:assert/strict';
import {climateOf,seasonWeights} from '../src/scripts/hero/seasons.ts';
import {philosopherCherries} from '../src/scripts/hero/philosopher-cherries.ts';
test('automatic scenery follows the Kyoto month and manual presets remain independent of the date',()=>{
  assert.equal(seasonWeights('auto',4).spring,1);assert.equal(seasonWeights('auto',8).snow,0);
  assert.ok(seasonWeights('auto',11).autumn>seasonWeights('auto',10).autumn);
  assert.ok(seasonWeights('auto',1).snow>0);assert.equal(seasonWeights('winter',8).snow,1);
  assert.equal(seasonWeights('spring',12).spring,1);assert.equal(seasonWeights('summer',1).snow,0);
});
test('the sky follows the scenery season: the Kyoto month on auto, the preset otherwise',()=>{
  assert.equal(climateOf('auto',4),'spring');assert.equal(climateOf('auto',8),'summer');
  assert.equal(climateOf('auto',11),'autumn');assert.equal(climateOf('auto',1),'winter');
  assert.equal(climateOf('auto',12),'winter');assert.equal(climateOf('winter',8),'winter');
  assert.ok(seasonWeights('auto',1).snow>seasonWeights('auto',12).snow);
});
test('bounded cherry scenery rejects building and water collisions instead of moving the existing city',()=>{
  const all=philosopherCherries(()=>50,()=>false);assert.ok(all.length>40&&all.length<90);
  const clear=philosopherCherries(()=>50,(x,z)=>x<3300||z> -1400);
  assert.ok(clear.length>0&&clear.length<all.length);assert.ok(clear.every(t=>t.x>=3303&&t.z<= -1403&&t.y===50&&t.cherry));
});
