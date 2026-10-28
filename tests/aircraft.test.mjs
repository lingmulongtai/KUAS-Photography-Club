import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AIRCRAFT_PATHS,aircraftPose} from '../src/scripts/hero/aircraft-path.ts';

test('illustrative aircraft travel smoothly at bounded altitude and wrap out of sight',()=>{
  assert.ok(AIRCRAFT_PATHS.length<=3);
  for(const path of AIRCRAFT_PATHS){
    let previous=aircraftPose(path,0);
    for(let t=.1;t<600;t+=.1){
      const p=aircraftPose(path,t);
      assert.ok([p.x,p.y,p.z,p.yaw].every(Number.isFinite));assert.ok(p.y>=2500&&p.y<=7000);
      if(p.visible&&previous.visible)assert.ok(Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z)<path.speed*.11);
      previous=p;
    }
  }
});
