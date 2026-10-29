import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRegionalLoader,regionAt} from '../src/scripts/hero/regional-loader.ts';

const region=(id,box=[0,0,10,10])=>({id,box});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('rapid travel serializes downloads and discards stale data before GPU activation',async()=>{
  const pending=[],activated=[],released=[],errors=[];
  const loader=createRegionalLoader(r=>{const d=deferred();pending.push({id:r.id,...d});return d.promise;},
    (r,data)=>{activated.push(r.id);return ()=>{released.push(`city-${r.id}`);data.dispose();};},e=>errors.push(e));
  const a=region('a'),b=region('b'),c=region('c');
  const done=loader.request(a);loader.request(b);loader.request(c);
  await Promise.resolve();
  assert.deepEqual(pending.map(p=>p.id),['a']);
  pending[0].resolve({dispose:()=>released.push('data-a')});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(pending.map(p=>p.id),['a','c']);
  pending[1].resolve({dispose:()=>released.push('data-c')});await done;
  assert.deepEqual(activated,['c']);assert.deepEqual(released,['data-a']);
  assert.equal(loader.id,'c');
  await loader.request(null);
  assert.deepEqual(released,['data-a','city-c','data-c']);assert.equal(loader.id,null);
  assert.deepEqual(errors,[]);
});

test('leaving during a download never activates it; a failed region can be retried',async()=>{
  const d=deferred();let disposed=0,activated=0,attempts=0;const errors=[];
  const loader=createRegionalLoader(async()=>{attempts++;if(attempts===1)return d.promise;
    if(attempts===2)throw Error('offline');return {dispose(){disposed++;}};},
    (_r,data)=>{activated++;return data.dispose;},e=>errors.push(e.message));
  const a=region('a');const done=loader.request(a);loader.request(null);
  d.resolve({dispose(){disposed++;}});await done;
  assert.equal(activated,0);assert.equal(disposed,1);
  await loader.request(a);assert.equal(loader.id,null);assert.deepEqual(errors,['offline']);
  await loader.request(a);assert.equal(loader.id,'a');assert.equal(activated,1);
  await loader.request(a);assert.equal(attempts,3);
  await loader.request(null);assert.equal(disposed,2);
});

test('regional boundaries do not double-select adjoining datasets',()=>{
  const a=region('a'),b=region('b',[10,0,20,10]);
  assert.equal(regionAt([a,b],{x:10,z:5}),b);
  assert.equal(regionAt([a,b],{x:20,z:5}),null);
});

test('a region superseded during asynchronous activation is disposed before the next one',async()=>{
  const started=deferred(),activation=deferred(),released=[],activated=[];
  const loader=createRegionalLoader(async r=>({dispose:()=>released.push(`data-${r.id}`)}),async(r,data)=>{
    activated.push(r.id);
    if(r.id==='a'){started.resolve();await activation.promise;}
    return ()=>{released.push(`city-${r.id}`);data.dispose();};
  },()=>assert.fail('unexpected failure'));
  const done=loader.request(region('a'));await started.promise;loader.request(region('b'));
  activation.resolve();await done;
  assert.deepEqual(activated,['a','b']);assert.deepEqual(released,['city-a','data-a']);assert.equal(loader.id,'b');
});

test('superseded preparation can stop early without reporting an error',async()=>{
  const started=deferred(),resume=deferred(),released=[],errors=[];
  const loader=createRegionalLoader(async r=>({dispose:()=>released.push(r.id)}),async(r,_data,current)=>{
    if(r.id==='a'){started.resolve();await resume.promise;if(!current())throw Error('superseded');}
    return ()=>{};
  },e=>errors.push(e));
  const done=loader.request(region('a'));await started.promise;loader.request(region('b'));resume.resolve();await done;
  assert.deepEqual(released,['a']);assert.deepEqual(errors,[]);assert.equal(loader.id,'b');
});

test('a request arriving between completion and cleanup is not lost',async()=>{
  const a=region('a'),b=region('b'),events=[];let loader;
  loader=createRegionalLoader(async()=>({dispose(){}}),(r)=>{
    events.push(r.id);
    if(r.id==='a')queueMicrotask(()=>queueMicrotask(()=>loader.request(b)));
    return ()=>{};
  },()=>assert.fail('unexpected failure'));
  await loader.request(a);await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(events,['a','b']);assert.equal(loader.id,'b');
});


test('view prefetch downloads once without activating or replacing the current region',async()=>{
  const loads=[],activated=[],released=[];
  const loader=createRegionalLoader(async r=>{loads.push(r.id);return {dispose:()=>released.push(r.id)};},
    (r,data)=>{activated.push(r.id);return data.dispose;},()=>assert.fail('unexpected failure'));
  const a=region('tennozan'),b=region('osaka');
  await loader.request(a);loader.prefetch(b);loader.prefetch(b);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(loads,['tennozan','osaka']);assert.deepEqual(activated,['tennozan']);
  await loader.request(b);
  assert.deepEqual(loads,['tennozan','osaka']);assert.deepEqual(activated,['tennozan','osaka']);
  assert.deepEqual(released,['tennozan']);
});

test('prefetch replacement releases its data once and serializes a subsequent destination',async()=>{
  const first=deferred(),loads=[],released=[];
  const loader=createRegionalLoader(async r=>{loads.push(r.id);if(r.id==='a')await first.promise;
    return {dispose:()=>released.push(r.id)};},(_r,data)=>data.dispose,()=>{});
  loader.prefetch(region('a'));loader.prefetch(region('b'));
  const done=loader.request(region('c'));await Promise.resolve();assert.deepEqual(loads,['a']);
  first.resolve();await done;assert.deepEqual(loads,['a','b','c']);
  assert.deepEqual(released,['a']);
  loader.prefetch(region('d'));await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(released,['a','b']);
});
