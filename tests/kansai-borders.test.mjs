import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {prefectureLookup} from '../src/scripts/kansai/coordinates.ts';
import {MAP_PLACES} from '../src/data/kansai-outings.ts';

const base=new URL('../public/kansai/',import.meta.url);
const original=prefectureLookup(JSON.parse(readFileSync(new URL('prefectures.json',base))).features);
async function readImage(name){
  const {data,info}=await sharp(readFileSync(new URL('borders/'+name+'.png',base))).raw().toBuffer({resolveWithObject:true});
  return (x,y)=>{const at=(y*info.width+x)*info.channels;return data.subarray(at,at+3);};
}

test('both sides of a prefectural line, the lake and offshore islands survive atlas packing',async()=>{
  const [coarse,middle,edge]=await Promise.all(['prefectures','districts','edges'].map(readImage));
  const ptr=([r,g,b])=>(r-250)*65536+b*256+g;
  function lookup([lon,lat]){
    const x=(lon-134)*64,y=(lat-33.75)*64;
    let c=coarse(Math.floor(x),Math.floor(y));
    if(c[0]<250)return c[0];
    const mid=ptr(c),u=x%1*32,v=y%1*32;
    c=middle((mid%128)*32+Math.floor(u),Math.floor(mid/128)*32+Math.floor(v));
    if(c[0]<250)return c[0];
    const ix=Math.floor(u%1*16),iy=Math.floor(v%1*16),fine=ptr(c);
    const [r,g,b]=edge((fine%256)*8+(ix>>1),Math.floor(fine/256)*4+(iy>>2));
    const value=((r+(g<<8)+(b<<16))>>(3*((iy%4)*2+ix%2)))&7;
    return value?24+value:0;
  }
  const sites=[[135.8332,35.005,26],[135.8348,35.005,25],
    [135.81,34.716,29],[135.81,34.718,26],[135.678,34.678,27],[135.679,34.678,29],
    [134.96,34.5761,0],[134.96,34.5749,28],...MAP_PLACES.map(p=>[p.lon,p.lat,Number(p.pref)])];
  for(const [lon,lat,wanted] of sites){
    assert.equal(Number(original([lon,lat])??0),wanted);
    assert.equal(lookup([lon,lat]),wanted,lon+', '+lat);
  }
});
