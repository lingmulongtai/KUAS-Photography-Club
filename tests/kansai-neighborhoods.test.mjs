import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {tileXY} from '../src/scripts/kansai/coordinates.ts';

const root=new URL('../public/kansai/neighborhoods/',import.meta.url);
test('distant roofs include the Uji corridor, both Biwa shores, Kobe and Nara',()=>{
  const {tiles}=JSON.parse(readFileSync(new URL('index.json',root)));
  for(const [lon,lat] of [[135.81,34.88],[135.86,35.01],[135.93,35.02],[135.19,34.69],[135.82,34.68]]){
    const [x,y]=tileXY(lon,lat,12).map(Math.floor);
    const n=tiles[x+'/'+y];
    assert.ok(n>100,'inhabited district '+[lon,lat]);
    const bytes=gunzipSync(readFileSync(new URL(x+'-'+y+'.bin.gz',root)));
    assert.equal(bytes.length,n*8);
    for(let i=0;i<bytes.length;i+=8)assert.ok(bytes[i+4]>=3&&bytes[i+5]>=2&&bytes[i+6]>=3);
  }
});
