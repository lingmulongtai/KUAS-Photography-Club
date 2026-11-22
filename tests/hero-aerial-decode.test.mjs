import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTexture,decodedTexture} from '../src/scripts/hero/data.ts';
import {NoColorSpace,SRGBColorSpace,LinearMipmapLinearFilter} from 'three';

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

test('prefecture lookup texels keep their byte values and image orientation',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(new Blob(['lookup'])));
  const original=globalThis.createImageBitmap;
  globalThis.createImageBitmap=async(_blob,options)=>{
    assert.deepEqual(options,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
    return {width:2,height:2,close(){}};
  };
  t.after(()=>{if(original)globalThis.createImageBitmap=original;else delete globalThis.createImageBitmap;});
  const texture=await decodedTexture('/kansai/borders/edges.png');
  assert.equal(texture.colorSpace,NoColorSpace);
  assert.equal(texture.flipY,false);
  texture.dispose();
});
