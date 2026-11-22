import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {setImmediate as idle} from 'node:timers/promises';
import {inRing,prefectureLookup} from '../src/scripts/kansai/coordinates.ts';
import {MAP_PLACES} from '../src/data/kansai-outings.ts';

const base=new URL('../public/kansai/',import.meta.url);
const original=prefectureLookup(JSON.parse(readFileSync(new URL('prefectures.json',base))).features);
test('standalone landmark anchors and footprint edges belong to their display prefecture',()=>{
  for(const landmark of JSON.parse(readFileSync(new URL('landmarks/index.json',base)))){
    const belongs=p=>assert.equal(original(p),landmark.pref,landmark.id);
    belongs([landmark.lon,landmark.lat]);
    for(const ring of landmark.rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      belongs(a);belongs([(a[0]+b[0])/2,(a[1]+b[1])/2]);
    }
  }
});

test('switching prefectures hides resident glass, restores footprints and discards a late landmark',async()=>{
  const script=buildSync({entryPoints:['src/scripts/kansai/architecture.ts'],platform:'node',format:'cjs',bundle:true,write:false}).outputFiles[0].text;
  let selection='25',draw,resolveLoad,requests=0,discarded=0;
  const engine={Cartesian3:{fromDegrees:()=>({}),distance:()=>50},Cartographic:{fromDegrees:()=>({})},
    Transforms:{eastNorthUpToFixedFrame:()=>({})},Axis:{},Model:{fromGltfAsync(){
      requests++;return new Promise(resolve=>{resolveLoad=()=>resolve({show:true,ready:true,destroy(){discarded++;}});});
    }}};
  const ring=[[135,35],[135.001,35],[135,35.001],[135,35]],point=[135.0001,35.0001];
  const module={exports:{}},catalogue=[{id:'glass',pref:'26',lon:135,lat:35,file:'glass.glb',rings:[ring]}];
  runInNewContext(script,{module,window:{Cesium:engine},fetch:async()=>({ok:true,json:async()=>catalogue})});
  const residents=[];
  const widget={camera:{},terrainProvider:{},isDestroyed:()=>false,scene:{requestRender(){},
    preRender:{addEventListener(fn){draw=fn;return ()=>{};}},primitives:{add:model=>residents.push(model)}}};
  const buildings=await module.exports.architecturalModels(widget,()=>selection);
  draw();assert.equal(requests,0);
  selection='26';draw();selection='25';resolveLoad();await idle();draw();
  assert.equal(discarded,1);assert.equal(residents.length,0);assert.equal(buildings.contains(point),false);
  selection='26';draw();resolveLoad();await idle();draw();
  assert.equal(residents.length,1);assert.equal(buildings.contains(point),true);
  const revision=buildings.revision;
  selection='25';draw();
  assert.equal(residents[0].show,false);assert.equal(buildings.contains(point),false);assert.ok(buildings.revision>revision);
  selection='26';draw();
  assert.equal(residents[0].show,true);assert.equal(buildings.contains(point),true);assert.equal(requests,2);
  buildings.dispose();
});

async function readImage(name){
  const {data,info}=await sharp(readFileSync(new URL('borders/'+name+'.png',base))).raw().toBuffer({resolveWithObject:true});
  const pixel=(x,y)=>{const at=(y*info.width+x)*info.channels;return data.subarray(at,at+3);};
  return Object.assign(pixel,{height:info.height});
}

test('both sides of a prefectural line, the lake and offshore islands survive atlas packing',async()=>{
  const [coarse,middle,edge,islets]=await Promise.all(['prefectures','districts','edges','islets'].map(readImage));
  function island(block,x,y){
    const [count,lo,hi]=islets(block%16*16+Math.floor(x*16),islets.height-(Math.floor(block/16)+1)*16+Math.floor(y*16));
    if(!count)return lo;
    const table=i=>islets(i%256,Math.floor(i/256));
    const coord=i=>{const [a,b,c]=table(i);return (a+(b<<8)+(c<<16)-8388608)*2048/4e9;};
    for(let j=0;j<count;j++){
      const [a,b]=table(lo+256*hi+j),header=a+256*b,[owner,n]=table(header);
      const points=Array.from({length:n},(_,i)=>[coord(header+1+2*i),coord(header+2+2*i)]);
      if(inRing([x,y],points))return owner;
    }
    return 0;
  }
  const ptr=([r,g,b])=>(r-250)*65536+b*256+g;
  function lookup([lon,lat]){
    const x=(lon-134)*64,y=(lat-33.75)*64;
    let c=coarse(Math.floor(x),Math.floor(y));
    if(c[0]<250)return c[0];
    const mid=ptr(c),u=x%1*32,v=y%1*32;
    c=middle((mid%128)*32+Math.floor(u),Math.floor(mid/128)*32+Math.floor(v));
    if(c[0]===249)return island(c[1]+256*c[2],u%1,v%1);
    if(c[0]<250)return c[0];
    const ix=Math.floor(u%1*16),iy=Math.floor(v%1*16),fine=ptr(c);
    const [r,g,b]=edge((fine%256)*8+(ix>>1),Math.floor(fine/256)*4+(iy>>2));
    const value=((r+(g<<8)+(b<<16))>>(3*((iy%4)*2+ix%2)))&7;
    return value?24+value:0;
  }
  const sites=[[135.8332,35.005,26],[135.8348,35.005,25],
    [135.81,34.716,29],[135.81,34.718,26],[135.678,34.678,27],[135.679,34.678,29],
    // The remaining three shared prefectural borders: Yamazaki, Osaka airport and northern Tamba.
    [135.678999,34.8920189,26],[135.678199,34.8920189,27],
    [135.4427175,34.7846847,27],[135.4419175,34.7844847,28],
    [135.0896053,35.2540672,28],[135.0894053,35.2548672,26],
    [134.96,34.5761,0],[134.96,34.5749,28],
    // Opposite sides of a sub-metre Hyogo rock fall within the same old raster texel.
    [134.7469631452888,35.66152332,28],[134.746956,35.66152332,0],
    [135.04437424914636,35.702144712,26],[134.88460869036186,35.65213518,26],
    // Centres of fine cells lost when Kyoto and Osaka were simplified independently.
    [135.5414276123047,34.91520690917969,26],[135.6495819091797,34.92472839355469,27],
    [135.2742156982422,35.73771667480469,26],[135.6248321533203,33.99998474121094,29],
    ...MAP_PLACES.map(p=>[p.lon,p.lat,Number(p.pref)])];
  for(const [lon,lat,wanted] of sites){
    assert.equal(Number(original([lon,lat])??0),wanted);
    assert.equal(lookup([lon,lat]),wanted,lon+', '+lat);
  }
});
