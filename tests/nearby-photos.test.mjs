import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNearbyPhotos} from '../src/scripts/hero/nearby-photos.ts';
const tiles=[0,1,2,3].map(i=>({file:String(i),box:[i*4000,0,(i+1)*4000,4000],mobile:{file:`m${i}`}}));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('close imagery reuses the view prefetch, retains the current image until ready and releases old sheets',async()=>{
  const loaded=[],shown=[],disposed=[];let resume;
  const loader=createNearbyPhotos(async()=>tiles,async s=>{loaded.push(s.file);if(s.file==='1')await new Promise(r=>resume=r);return s.file;},
    p=>shown.push(p),p=>disposed.push(p),()=>assert.fail('unexpected error'));
  await loader.prefetch({x:-500,z:-500});assert.deepEqual(loaded,['0']);assert.deepEqual(shown,[]);
  await loader.update({x:500,z:500});assert.deepEqual(loaded,['0']);assert.equal(shown.at(-1),'0');
  const pending=loader.update({x:4500,z:500});await tick();assert.equal(shown.at(-1),'0');
  await loader.prefetch({x:8500,z:500});assert.deepEqual(loaded,['0','1'],'a third sheet never displaces the in-flight foreground sheet');
  resume();await pending;assert.equal(shown.at(-1),'1');
  await loader.update({x:8500,z:500});assert.equal(shown.at(-1),'2');assert.deepEqual(disposed,['0']);
});

test('a late image cannot replace another location or restore a departed Osaka view',async()=>{
  let resume;const shown=[],disposed=[];
  const loader=createNearbyPhotos(async()=>tiles,async s=>{if(s.file==='0')await new Promise(r=>resume=r);return s.file;},
    p=>shown.push(p),p=>disposed.push(p),()=>assert.fail('unexpected error'));
  const first=loader.update({x:500,z:500});await tick();
  await loader.update(null);resume();await first;assert.deepEqual(shown,[null]);
  await loader.update({x:8500,z:500});await loader.update({x:12500,z:500});
  assert.deepEqual(shown,[null,'2','3']);assert.deepEqual(disposed,['0']);
});

test('a failed image download can be retried without losing the regional fallback',async()=>{
  let attempts=0;const shown=[],errors=[];
  const loader=createNearbyPhotos(async()=>tiles,async()=>{if(++attempts===1)throw Error('offline');return 'detail';},
    p=>shown.push(p),()=>{},e=>errors.push(e.message));
  await loader.update({x:500,z:500});assert.deepEqual(errors,['offline']);assert.deepEqual(shown,[]);
  await loader.update({x:500,z:500});assert.deepEqual(shown,['detail']);
});
