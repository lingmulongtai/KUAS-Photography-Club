import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landmarkOrbit } from '../src/scripts/hero/landmark-orbit.ts';

const site = {center:{x:12,z:-30},targetHeight:16};
const eye = {x:112,y:48,z:-30};
const flat = () => 0;
test('landmark stays centred through multiple complete camera orbits', () => {
  const start = landmarkOrbit(site,eye,0,0,flat);
  for (const yaw of [90,180,270,360,720,-360]) {
    const p = landmarkOrbit(site,eye,yaw,0,flat);
    assert.deepEqual(p.target,start.target);
    assert.ok(Math.abs(Math.hypot(p.pos.x-12,p.pos.y-16,p.pos.z+30)-Math.hypot(100,32))<1e-9);
    if (yaw%360===0) assert.ok(Math.hypot(p.pos.x-start.pos.x,p.pos.z-start.pos.z)<1e-9);
  }
  assert.ok(landmarkOrbit(site,eye,180,0,flat).pos.x<site.center.x);
});
test('overhead and low angles keep a finite target and the eye above ground', () => {
  const overhead=landmarkOrbit(site,eye,0,89,flat), low=landmarkOrbit(site,eye,0,-75,flat);
  assert.ok(Math.hypot(overhead.pos.x-12,overhead.pos.z+30)<2);
  assert.ok(overhead.pos.y>110);
  assert.ok(low.pos.y>4);
  assert.deepEqual(overhead.target,low.target);
});
test('a ridge on the orbit sightline lifts the eye without moving the landmark', () => {
  const ridge=(x) => x>45&&x<80?55:0;
  const p=landmarkOrbit(site,eye,0,-75,ridge);
  assert.ok(p.pos.y>70);
  assert.deepEqual(p.target,{x:12,y:16,z:-30});
  for(let i=0;i<8;i++) {
    const t=i/8;
    assert.ok(p.pos.y+(p.target.y-p.pos.y)*t>=ridge(p.pos.x+(12-p.pos.x)*t)+4-1e-9);
  }
});
test('canopy clearance lifts the camera but does not add tree height to the target', () => {
  const trees=(x,z)=>Math.hypot(x-12,z+30)>24?28:4;
  const p=landmarkOrbit(site,eye,0,0,flat,trees);
  assert.ok(p.pos.y>60);
  assert.deepEqual(p.target,{x:12,y:16,z:-30});
});
