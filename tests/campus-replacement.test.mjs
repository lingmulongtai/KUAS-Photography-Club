import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import * as THREE from 'three';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {isDetailed} from './src/scripts/hero/campus.ts';"},
  bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
const result={exports:{}};
const require=createRequire(import.meta.url);
new Function('require','module','exports',compiled)(id=>id==='three'?THREE:require(id),result,result.exports);
const {isDetailed}=result.exports;

test('the real low-rise wooden-class Future Center is replaced without hiding neighbouring houses',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const data=await loadBuildings();
  const centres=[...data.boxes,...data.polys.map(p=>{
    let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}
    return {...p,x:x/(p.ring.length/2),z:z/(p.ring.length/2)};
  })];
  const future=centres.find(b=>b.x>-3865&&b.x<-3838&&b.z>-790&&b.z<-759&&(b.kind&3)===0&&b.h<9);
  assert.ok(future,'retain the actual PLATEAU classification in this regression');
  assert.equal(isDetailed(future.kind,future.h,future.x,future.z),true);
  assert.equal(isDetailed(0,8.5,-3900,-780),false,'ordinary houses outside the campus remain');
  assert.equal(isDetailed(1,20,-3668,-709),false,'the neighbouring eastern block remains');
});
