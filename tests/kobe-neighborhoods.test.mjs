import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const root=new URL('../public/kansai/',import.meta.url);
const read=file=>readFileSync(new URL(file,root));
test('every Kobe survey district retains classes and local ridge profiles in its distant houses',()=>{
  const districts=Object.keys(JSON.parse(read('kobe-roofs/index.json'))).map(k=>k.replace('-','/')).sort();
  const {tiles,profiled}=JSON.parse(read('neighborhoods/index.json'));
  assert.deepEqual(profiled,districts);
  let measured=0,wooden=0,sturdy=0;
  for(const key of districts){
    const data=gunzipSync(read('neighborhoods/'+key.replace('/','-')+'.bin.gz'));
    assert.equal(data.length,tiles[key]*10);
    for(let i=0;i<data.length;i+=10){
      const kind=data[i+8],ridge=data[i+9];
      if(kind===4)wooden++;
      if(kind===1)sturdy++;
      if(ridge!==255){
        assert.ok([1,2].includes(ridge>>6) && (ridge&63)>0);
        measured++;
      }
    }
  }
  assert.ok(wooden>0 && sturdy>0 && measured>0);
});
