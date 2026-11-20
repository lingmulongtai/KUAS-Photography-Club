import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeBox, cleanWatermark, creditText, WATERMARK_DEFAULTS, WATERMARK_POSITIONS} from '../src/scripts/admin/watermark.ts';

test('nine positions keep a margin of 3% of the short side from the chosen edges',()=>{
  // a 2000×1500 photo: the margin is 45 px
  assert.deepEqual(placeBox(2000,1500,300,100,'top-left'),{x:45,y:45});
  assert.deepEqual(placeBox(2000,1500,300,100,'bottom-right'),{x:1655,y:1355});
  assert.deepEqual(placeBox(2000,1500,300,100,'middle-center'),{x:850,y:700});
  for(const position of WATERMARK_POSITIONS){
    const {x,y}=placeBox(1200,1600,200,80,position);
    assert.ok(x>=0&&y>=0&&x+200<=1200&&y+80<=1600,position);
  }
});
test('stored settings are cleaned: unknown values fall back, numbers are kept in range',()=>{
  assert.deepEqual(cleanWatermark(null),WATERMARK_DEFAULTS);
  assert.deepEqual(cleanWatermark({enabled:false,style:'ring',position:'top-center',size:99,opacity:-5,color:'teal'}),
    {enabled:false,style:'ring',position:'top-center',size:30,opacity:20,color:'teal'});
  assert.equal(cleanWatermark({style:'<b>',position:'left',color:'red'}).style,'emblem');
});
test('the credit line names the photographer when known',()=>{
  assert.equal(creditText(' 山田 花子 '),'© 山田 花子 · KUAS Photography Club');
  assert.equal(creditText(''),'© KUAS Photography Club');
});
