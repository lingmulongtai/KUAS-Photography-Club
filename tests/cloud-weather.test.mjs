import test from 'node:test';
import assert from 'node:assert/strict';
import {CLOUD_STYLES,cloudWeather,createCloudClock} from '../src/scripts/hero/cloud-weather.ts';
const style=name=>CLOUD_STYLES.indexOf(name);
const visits=(climate,n=300)=>Array.from({length:n},(_,i)=>cloudWeather(i*7919+1,climate));
test('weather is stable per visit and each season has its own mix of cloud characters',()=>{
  assert.deepEqual(cloudWeather(41,'summer'),cloudWeather(41,'summer'));
  assert.notDeepEqual(cloudWeather(41),cloudWeather(42));
  const styles=climate=>new Set(visits(climate).map(w=>CLOUD_STYLES[w.style]));
  assert.ok(styles('summer').has('cumulonimbus'),'summer brings thunderheads');
  assert.ok(!styles('winter').has('cumulonimbus')&&!styles('spring').has('cumulonimbus'));
  assert.ok(styles('winter').has('snow')&&!styles('summer').has('snow'),'snow decks only in winter');
  for(const climate of ['spring','summer','autumn','winter'])assert.ok(styles(climate).size>=3,`${climate} varies`);
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
test('each visit gets a sparse cloud slab with volume and its own mix of high cloud',()=>{
  const all=['spring','summer','autumn','winter'].flatMap(climate=>visits(climate,200));
  for(const w of all){
    assert.ok(w.base>=850&&w.base<=1800);
    assert.ok(w.top-w.base>=450,'the low clouds have thickness');
    assert.ok(w.top<=8500);
    assert.ok(w.cover>0&&w.cover<.65);
    assert.ok(w.clear>=.1&&w.clear<=.9);
    assert.ok(w.cirrus>=0&&w.cirrus<=1&&w.alto>=0&&w.alto<=1);
  }
  assert.ok(all.some(w=>w.cirrus>0)&&all.some(w=>w.cirrus===0));
  assert.ok(all.some(w=>w.alto>0)&&all.some(w=>w.alto===0));
  const depth=w=>w.top-w.base,of=name=>all.filter(w=>w.style===style(name));
  assert.ok(Math.min(...of('congestus').map(depth))>Math.max(...of('stratocumulus').map(depth)),'towering heads are taller than a deck');
  assert.ok(Math.min(...of('cumulonimbus').map(depth))>Math.max(...of('congestus').map(depth)),'thunderheads tower highest');
  assert.ok(Math.max(...of('snow').map(w=>w.base))<Math.min(...of('cumulus').map(w=>w.base)),'snow clouds hang low');
  // most of the sky stays open: scattered characters leave wide gaps between groups of cloud
  for(const name of ['cumulus','fair','congestus','cumulonimbus'])assert.ok(of(name).every(w=>w.clear>=.5));
});
