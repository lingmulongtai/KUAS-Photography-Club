import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, PANORAMA_VIEWS, spotDestination } from '../src/scripts/hero/views.ts';
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
  for (const id of PANORAMA_VIEWS) {
    assert.equal(VIEWS[id].orbit,undefined);
    assert.ok(VIEWS[id].above>0);
  }
  const atago=SPOTS.find(s=>s.id==='atago');
  assert.deepEqual(VIEWS.atago.ref,toLocal(atago.lat,atago.lon));
  assert.equal('funaoka' in VIEWS,false);
});

test('Tennozan keeps the confluence view and has a separate view aimed at Osaka', () => {
  const view=VIEWS.tennozan;
  assert.deepEqual(view.ref,toLocal(34.897931,135.679798));
  assert.deepEqual(view.eye,view.ref);
  assert.ok(view.above>=45,'clear the mountain canopy');
  assert.ok(view.pitch<=-10,'look down over the plain');
  assert.ok(view.bearing>=145&&view.bearing<=180,'face the confluence and Osaka');
  assert.ok(PANORAMA_VIEWS.includes('tennozan'));
  const osaka=VIEWS.osakaSkyline;
  assert.deepEqual(osaka.eye,view.eye);
  const station=toLocal(34.702911,135.495896);
  const bearing=(Math.atan2(station.x-osaka.eye.x,osaka.eye.z-station.z)*180/Math.PI+360)%360;
  assert.ok(Math.abs(osaka.bearing-bearing)<3,'the Osaka skyline is centred even on narrow screens');
  assert.ok(PANORAMA_VIEWS.includes('osakaSkyline'));
  assert.equal('sewaritei' in VIEWS,false);
});

test('every map spot has a camera destination and landmarks stay centred', () => {
  for (const spot of SPOTS) {
    const id=spotDestination(spot.id);
    if (spot.id==='kuas') { assert.equal(id,'campus'); continue; }
    const view=VIEWS[id];
    assert.ok(view,`Missing camera for ${spot.id}`);
    if (spot.id==='atago') { assert.equal(id,'atago'); continue; }
    assert.ok(view.orbit,`Map destination must orbit ${spot.id}`);
    // Kiyomizu's pin is its pagoda, while its existing camera frames the main stage.
    if (spot.id!=='kiyomizu') assert.deepEqual(view.orbit.center,toLocal(spot.lat,spot.lon));
    const eye={...view.eye,y:40+view.above};
    for (const yaw of [0,90,180,270,360]) {
      const pose=landmarkOrbit(view.orbit,eye,yaw,0,()=>40);
      assert.deepEqual(pose.target,{...view.orbit.center,y:40+view.orbit.targetHeight});
      assert.ok(pose.pos.y>pose.target.y);
    }
  }
  assert.equal(spotDestination('arashiyama'),'togetsukyo');
  assert.equal(VIEWS.arashiyama.orbit,undefined);
});

test('Daimonji panorama looks out over Kyoto and its map spot looks back at the firebed',()=>{
  const panorama=VIEWS.daimonji, spot=VIEWS[spotDestination('daimonji')];
  assert.equal(panorama.orbit,undefined);
  assert.ok(panorama.bearing>210&&panorama.bearing<280,'face west/southwest toward Kyoto');
  assert.ok(Math.hypot(panorama.eye.x-panorama.ref.x,panorama.eye.z-panorama.ref.z)<30,'stand at the firebed viewpoint');
  assert.deepEqual(spot.orbit.center,toLocal(35.0230738,135.804312));
  assert.ok(spot.eye.x<spot.orbit.center.x-300,'view the west-facing 大 from downslope');
});
