import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {tileXY} from '../src/scripts/kansai/coordinates.ts';

const root=new URL('../public/kansai/',import.meta.url);
const read=file=>readFileSync(new URL(file,root));
test('every Kobe survey district retains classes and local ridge profiles in its distant houses',()=>{
  const districts=Object.keys(JSON.parse(read('kobe-roofs/index.json'))).map(k=>k.replace('-','/')).sort();
  const {tiles,profiled}=JSON.parse(read('neighborhoods/index.json'));
  const profiledSet=new Set(profiled);
  for(const key of districts)assert.ok(profiledSet.has(key),'Kobe district '+key+' must remain profiled');
  assert.deepEqual(profiled,Object.keys(tiles).sort(),'all Kansai neighborhood districts use 10-byte profiled records');
  let measured=0,wooden=0,sturdy=0;
  for(const key of districts){
    const data=gunzipSync(read('neighborhoods/'+key.replace('/','-')+'.bin.gz'));
    assert.equal(data.length,tiles[key]*10);
    for(let i=0;i<data.length;i+=10){
      const kind=data[i+8],ridge=data[i+9];
      if((kind&3)===0)wooden++;
      if((kind&3)===1)sturdy++;
      if(ridge!==255){
        assert.ok([1,2].includes(ridge>>6) && (ridge&63)>0);
        measured++;
      }
    }
  }
  assert.ok(wooden>0 && sturdy>0 && measured>0);
});

test('non-Kobe Kansai districts carry real building classes, mapped usages, roof profiles and tall structures',()=>{
  const {tiles,profiled}=JSON.parse(read('neighborhoods/index.json'));
  const profiledSet=new Set(profiled);
  // Osaka (Namba/Tennoji), Nara Park/City, Otsu (Shiga), Himeji (Hyogo outside Kobe), Uji (Kyoto outside core)
  for(const [name,lon,lat] of [
    ['Osaka',135.505,34.665],
    ['Nara',135.825,34.685],
    ['Otsu',135.865,35.008],
    ['Himeji',134.692,34.832],
    ['Uji',135.805,34.890],
  ]){
    const [x,y]=tileXY(lon,lat,12).map(Math.floor);
    const key=x+'/'+y;
    assert.ok(profiledSet.has(key),`${name} (${key}) should be profiled`);
    const data=gunzipSync(read('neighborhoods/'+x+'-'+y+'.bin.gz'));
    assert.equal(data.length,tiles[key]*10);
    let wooden=0,sturdy=0,used=0,pitched=0,tall=0;
    for(let i=0;i<data.length;i+=10){
      const h=data[i+6],kind=data[i+8],ridge=data[i+9];
      if((kind&3)===0)wooden++;
      if((kind&3)===1)sturdy++;
      if((kind>>2)>1)used++;
      if(h>=20)tall++;
      if(ridge!==255){
        assert.ok([1,2].includes(ridge>>6) && (ridge&63)>0);
        pitched++;
      }
    }
    assert.ok(wooden>50 && sturdy>50,`${name} should mix wooden and sturdy buildings (${wooden}/${sturdy})`);
    assert.ok(used>10,`${name} should preserve mapped OSM building usages (${used})`);
    assert.ok(pitched>5,`${name} should retain explicit pitched/sacred roof profiles (${pitched})`);
    assert.ok(tall>5,`${name} should preserve real multi-storey building heights (${tall})`);
  }
});
