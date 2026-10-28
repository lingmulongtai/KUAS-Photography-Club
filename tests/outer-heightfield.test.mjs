import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Heightfield,loadHeightfield} from '../src/scripts/hero/heightfield.ts';
import {readFile,stat} from 'node:fs/promises';

const grid=(box,h)=>({meta:{box},sample:(x,z)=>x>=box[0]&&x<=box[2]&&z>=box[1]&&z<=box[3]?h:NaN});

test('outer terrain extends the bounds while preserving the original basin and local grids',()=>{
  const far=grid([-1000,-1000,1000,1000],40),near=grid([-400,-400,400,400],80);
  const regional=grid([-200,-200,200,200],120),outer=grid([-3000,-3000,3000,3000],260);
  const old=new Heightfield(far,near,regional),extended=new Heightfield(far,near,regional,outer);
  assert.deepEqual(extended.bounds,outer.meta.box);
  for(const x of [-600,-350,0,350,600])assert.equal(extended.height(x,0),old.height(x,0));
  assert.equal(extended.height(-2000,0),260);
  const edge=extended.height(-850,0);
  assert.ok(edge>40&&edge<260,'blend the outer mountains without a vertical seam');
  assert.equal(extended.height(-3001,0),0);
  assert.deepEqual(old.bounds,far.meta.box);
});

test('shipped outer data decodes through the runtime and stays within mobile download budgets',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const hf=await loadHeightfield(meta);
  assert.ok(meta.outer.box[3]>=36000, 'central Osaka remains inside the terrain');
  for(const [x,z] of [[-18825,1105],[-28000,-11000],[8000,0],[0,18000],[-10000,25000],[-24058,33406]]) {
    assert.ok(Number.isFinite(hf.height(x,z))&&hf.height(x,z)>0,'new regions have actual elevation');
  }
  for(const [file,budget] of [[meta.outer.file,350000],[meta.aerialOuter.file,600000],[meta.aerialOuter.mobile.file,220000]])
    assert.ok((await stat(new URL(file,root))).size<=budget,file);
});
