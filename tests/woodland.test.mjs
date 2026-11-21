import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createWoodlandMask } from '../src/scripts/hero/woodland.ts';
import { buildWoodlandTexture } from '../src/scripts/hero/woodland-texture.ts';

test('woodland multipolygon holes stay empty and disjoint outer rings stay wooded', () => {
  const hit=createWoodlandMask([{outer:[[[0,0],[100,0],[100,100],[0,100],[0,0]],[[500,0],[600,0],[600,100],[500,100],[500,0]]],holes:[[[30,30],[60,30],[60,60],[30,60],[30,30]]]}]);
  assert.equal(hit(10,10),true); assert.equal(hit(40,40),false);
  assert.equal(hit(550,50),true); assert.equal(hit(300,50),false);
});

test('tree roots and ground tint share fractions while mapped woods respect open farmland and water', t => {
  const alpha = [0,255,255,255,0,0,0,0];
  const context = {setTransform(){}, getImageData:()=>({data:Uint8Array.from({length:32},(_,i)=>i%4===3?alpha[i>>2]:0)})};
  const original = globalThis.document;
  globalThis.document = {createElement:()=>({getContext:()=>context})};
  t.after(()=>{globalThis.document=original;});
  const field = {box:[-40,0,40,40],width:4,height:2,cells:Uint8Array.of(15,0,16,5,0,4,8,12)};
  for (const limit of [2048,2]) {
    const {sample,texture} = buildWoodlandTexture([],field.box,field,limit);
    assert.equal(sample(-30,10),1);
    assert.equal(sample(-10,10),.8, 'supplementary mapped grove');
    assert.equal(sample(10,10),0, 'protected open land');
    assert.equal(sample(10,30),8/15);
    assert.equal(sample(40,30),0);
    assert.equal(texture.image.width,limit===2?2:4);
    assert.equal(texture.image.data[0],limit===2?132:255);
    texture.dispose();
  }
});
test('shipped woodland covers the Senkoji foreground and stays inside its transfer budget', () => {
  const bytes=readFileSync(new URL('../public/kyoto/woodland.json.gz',import.meta.url));
  assert.ok(bytes.length<1024*1024);
  const data=JSON.parse(gunzipSync(bytes)); const hit=createWoodlandMask(data.polygons);
  // Verified Senkoji and its eastern foreground, not the colour of a winter aerial tile.
  const x=(135.6655983-135.7595)*91284.17129262601,z=-(35.0157751-35.0036)*110940.6404266756;
  assert.equal(hit(x,z),true); assert.equal(hit(x+200,z),true); assert.equal(hit(x+600,z),true);
  assert.equal(hit(-3755,-700),false);
  // Independently tagged inner ways remain woods, rather than relation clearings.
  assert.equal(hit(-7195,-5233),true); assert.equal(hit(4155,332),true);
});
