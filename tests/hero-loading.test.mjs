import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHeroLoading} from '../src/scripts/hero/loading.ts';

test('startup progress follows actual completed work and reserves completion for a scene frame',async()=>{
  const progress=[];let ready=0,resolveSlow;
  const loading=createHeroLoading({onProgress:p=>progress.push(p),onReady:()=>ready++},2);
  assert.equal(loading.canDraw,false,'an unfinished scene need not render behind the intro');
  const slow=loading.track(new Promise(resolve=>{resolveSlow=resolve;}));
  assert.equal(await loading.track(Promise.resolve('fast')),'fast');
  assert.deepEqual(progress,[1/3]);
  loading.frame();assert.equal(ready,0,'an empty sky frame is not ready');
  resolveSlow('slow');assert.equal(await slow,'slow');
  loading.built();assert.equal(loading.canDraw,true);assert.equal(ready,0,'building the scene alone is not ready');
  assert.deepEqual(progress,[1/3,2/3]);
  loading.frame();loading.frame();
  assert.deepEqual(progress,[1/3,2/3,1]);assert.equal(ready,1);
});

test('failed startup settles once and late downloads cannot revive loading or readiness',async()=>{
  const progress=[],errors=[];let ready=0,resolve;
  const loading=createHeroLoading({onProgress:p=>progress.push(p),onReady:()=>ready++,onError:e=>errors.push(e)},1);
  const pending=loading.track(new Promise(done=>{resolve=done;}));
  const error=Error('offline');loading.fail(error);loading.fail(Error('late failure'));
  resolve('late result');assert.equal(await pending,'late result');
  loading.built();loading.frame();
  assert.deepEqual(errors,[error]);assert.deepEqual(progress,[]);assert.equal(ready,0);
});

test('required downloads retain their rejection and readiness ignores later failures',async()=>{
  let ready=0,errors=0;
  const loading=createHeroLoading({onReady:()=>ready++,onError:()=>errors++},1);
  await assert.rejects(loading.track(Promise.reject(Error('missing terrain'))),/missing terrain/);
  await loading.track(Promise.resolve());loading.built();loading.frame();loading.fail(Error('optional photo'));
  assert.equal(ready,1);assert.equal(errors,0);
});
