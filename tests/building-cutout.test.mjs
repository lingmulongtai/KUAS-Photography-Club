import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildingCutout} from '../src/scripts/hero/building-cutout.ts';

test('a hall cutout preserves the connected east wing when its centroid is outside the hall',()=>{
  const source={ring:new Float32Array([-15,-15,60,-15,60,10,-15,10]),h:11.5,ground:-2.75,kind:1};
  const parts=buildingCutout(source,[-14.5,-15.5,14.5,10.5]);
  const area=ring=>{let a=0;for(let i=0;i<ring.length;i+=2){const j=(i+2)%ring.length;a+=ring[i]*ring[j+1]-ring[j]*ring[i+1];}return Math.abs(a)/2;};
  assert.equal(parts.reduce((a,p)=>a+area(p.ring),0),area(source.ring)-29*25);
  assert.ok(parts.some(p=>p.ring.includes(60)),'keep east wing');
  for(const p of parts) {
    assert.equal(p.h,source.h);assert.equal(p.ground,source.ground);
    for(let i=0;i<p.ring.length;i+=2) assert.ok(p.ring[i]<=-14.5||p.ring[i]>=14.5);
  }
  assert.deepEqual(buildingCutout(source,[-100,-100,-90,-90]),[source]);
  assert.deepEqual(buildingCutout(source,[-20,-20,70,20]),[]);
  const slope=(x)=>x*.1;
  for(const p of buildingCutout(source,[-14.5,-15.5,14.5,10.5],slope)) {
    let x=0;for(let i=0;i<p.ring.length;i+=2)x+=p.ring[i];
    assert.ok(Math.abs(slope(x/(p.ring.length/2))+p.ground-(slope(22.5)+source.ground))<1e-5);
  }
});
