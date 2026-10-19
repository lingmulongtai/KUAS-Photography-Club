import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudWeather,createCloudClock} from '../src/scripts/hero/cloud-weather.ts';
test('visits can have three cloud characters with stable per-visit weather',()=>{
  assert.deepEqual(cloudWeather(41),cloudWeather(41));
  const styles=new Set(Array.from({length:100},(_,i)=>cloudWeather(i*9817).style));
  assert.equal(styles.size,3);assert.notDeepEqual(cloudWeather(41),cloudWeather(42));
});
test('time travel moves clouds forward and backward without a midnight jump',()=>{
  const c=createCloudClock();assert.equal(c.step(1439,0),0);
  assert.equal(c.step(1,0),120);assert.equal(c.step(0,0),60);
  assert.equal(c.step(60,0),3660);
});
test('reduced motion stops ambient drifting but permits an explicit time selection',()=>{
  const c=createCloudClock();c.step(300,0,true);
  assert.equal(c.step(300.001,.1,true),0);
  assert.ok(c.step(600,0,true)>17000);
});
