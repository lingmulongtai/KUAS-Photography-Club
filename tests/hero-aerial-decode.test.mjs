import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTexture} from '../src/scripts/hero/data.ts';
import {SRGBColorSpace,LinearMipmapLinearFilter} from 'three';

test('a streamed aerial keeps its geographic orientation and releases its decoded bitmap',async t=>{
  const original=globalThis.createImageBitmap;
  let closed=false;
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'/kyoto/fixture.webp');
    return new Response(new Blob(['tile']));
  });
  globalThis.createImageBitmap=async(blob,options)=>{
    assert.equal(await blob.text(),'tile');
    assert.equal(options.imageOrientation,'flipY');
    return {width:128,height:128,close(){closed=true;}};
  };
  t.after(()=>{if(original)globalThis.createImageBitmap=original;else delete globalThis.createImageBitmap;});
  const texture=await loadTexture('fixture.webp',4);
  assert.equal(texture.colorSpace,SRGBColorSpace);
  assert.equal(texture.flipY,false);
  assert.equal(texture.minFilter,LinearMipmapLinearFilter);
  assert.equal(texture.anisotropy,4);
  assert.equal(closed,false);
  texture.dispose();
  assert.equal(closed,true);
});
