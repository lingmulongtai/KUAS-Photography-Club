import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSharedPhotoSlot} from '../src/scripts/hero/shared-photo.ts';

test('shared photo restores the previous area and ignores a late download',async()=>{
  let resolve;
  const load=new Promise(r=>{resolve=r;}),applied=[];
  const slot=createSharedPhotoSlot(()=>load,p=>applied.push(p),error=>{throw error;});
  slot.setFallback('arashiyama');
  slot.select(true);
  slot.select(false);
  resolve('tennozan');
  await load;await Promise.resolve();
  assert.deepEqual(applied,['arashiyama','arashiyama']);
  slot.select(true);
  await Promise.resolve();
  assert.equal(applied.at(-1),'tennozan');
  slot.select(false);
  assert.equal(applied.at(-1),'arashiyama');
});

test('a fallback finishing while the other area is active waits until it is selected',async()=>{
  const applied=[];
  const slot=createSharedPhotoSlot(()=>Promise.resolve('tennozan'),p=>applied.push(p),error=>{throw error;});
  slot.select(true);
  slot.setFallback('arashiyama');
  await Promise.resolve();
  assert.deepEqual(applied,['tennozan']);
  slot.select(false);
  assert.deepEqual(applied,['tennozan','arashiyama']);
});

test('a failed download can be retried while the area remains selected',async()=>{
  let attempts=0;const errors=[],applied=[];
  const slot=createSharedPhotoSlot(()=>++attempts===1?Promise.reject(new Error('offline')):Promise.resolve('tennozan'),
    p=>applied.push(p),error=>errors.push(error));
  slot.select(true);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(errors.length,1);
  slot.select(true);
  await Promise.resolve();
  assert.deepEqual(applied,['tennozan']);
});


test('a nearby Osaka sheet survives late fallback loads and releases the slot when leaving',async()=>{
  let resolve;const applied=[];
  const slot=createSharedPhotoSlot(()=>new Promise(r=>resolve=r),p=>applied.push(p),()=>assert.fail('unexpected error'));
  slot.select(true);slot.setOverride('osaka-close');slot.setFallback('arashiyama');resolve('tennozan');
  await Promise.resolve();assert.equal(applied.at(-1),'osaka-close');
  slot.select(false);assert.equal(applied.at(-1),'osaka-close');
  slot.setOverride(null);assert.equal(applied.at(-1),'arashiyama');
});
