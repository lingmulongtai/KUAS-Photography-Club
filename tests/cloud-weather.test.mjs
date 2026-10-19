import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudWeather,createCloudClock} from '../src/scripts/hero/cloud-weather.ts';
test('visits can have three cloud characters with stable per-visit weather',()=>{
  assert.deepEqual(cloudWeather(41),cloudWeather(41));
  const styles=new Set(Array.from({length:100},(_,i)=>cloudWeather(i*9817).style));
  assert.equal(styles.size,3);assert.notDeepEqual(cloudWeather(41),cloudWeather(42));
});
test('explicit cumulative time travel follows presets across midnight and reverses cleanly',()=>{
  const c=createCloudClock();assert.equal(c.step(0,0),0);
  assert.equal(c.step(2,0),120);assert.equal(c.step(1,0),60);
  assert.equal(c.step(61,0),3660);
});
test('reduced motion stops ambient drifting but permits an explicit time selection',()=>{
  const c=createCloudClock();c.step(0,0,true);
  assert.equal(c.step(0,.1,true),0);
  assert.ok(c.step(300,0,true)>17000);
});
test('normal live cloud drift stays smooth at second boundaries and counts elapsed time once',()=>{
  const c=createCloudClock();let previous=0;
  for(let frame=0;frame<180;frame++){const next=c.step(0,1/60);assert.ok(Math.abs(next-previous-1/60)<1e-10);previous=next;}
  assert.ok(Math.abs(previous-3)<1e-10);
});
