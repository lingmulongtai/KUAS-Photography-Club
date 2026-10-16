import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS } from '../src/scripts/hero/views.ts';
import { SPOTS } from '../src/data/spots.ts';
import { toLocal } from '../src/scripts/hero/geo.ts';
import { landmarkOrbit } from '../src/scripts/hero/landmark-orbit.ts';

test('landmark destinations keep their named model centred through full turns', () => {
  for (const id of ['tower', 'kinkaku']) {
    const view=VIEWS[id], spot=SPOTS.find(s=>s.id===id);
    assert.deepEqual(view.orbit.center,toLocal(spot.lat,spot.lon));
    const eye={...view.eye,y:40+view.above};
    const start=landmarkOrbit(view.orbit,eye,0,0,()=>40);
    for (const yaw of [-360,90,180,360,720]) {
      const pose=landmarkOrbit(view.orbit,eye,yaw,0,()=>40);
      assert.deepEqual(pose.target,start.target);
      assert.ok(Object.values(pose.pos).every(Number.isFinite));
    }
  }
});

test('panoramas turn at a fixed observation point', () => {
  for (const id of ['shogunzuka','daimonji','arashiyama','funaoka']) {
    assert.equal(VIEWS[id].orbit,undefined);
    assert.ok(VIEWS[id].above>0);
  }
});
