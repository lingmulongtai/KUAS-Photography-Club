import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Heightfield,loadHeightfield} from '../src/scripts/hero/heightfield.ts';
import {normalMaps} from '../src/scripts/hero/normal-map.ts';
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

test('only the terrain layers contributing at the sampled point are read',()=>{
  let samples=0;
  const far=grid([-1000,-1000,1000,1000],40),sample=far.sample;
  far.sample=(x,z)=>{samples++;return sample(x,z);};
  const near=grid([-400,-400,400,400],80),outer=grid([-3000,-3000,3000,3000],260);
  const extended=new Heightfield(far,near,undefined,outer),basin=new Heightfield(far,near);
  assert.equal(extended.height(0,0),80);assert.equal(samples,0);
  samples=0;
  assert.equal(extended.height(-850,0),150);assert.equal(samples,1);
  samples=0;
  assert.equal(extended.height(-2000,0),260);assert.equal(samples,0,'outside the far grid, blending needs no sample');
  samples=0;
  assert.equal(basin.height(0,0),80);assert.equal(samples,0);
  samples=0;
  assert.equal(basin.height(-2000,0),0);assert.equal(samples,1);
});

test('overlapping feathered edges and gaps retain the lower terrain',()=>{
  const far=grid([-2000,-2000,2000,2000],20),near=grid([-400,-400,400,400],80);
  const regional=grid([-310,-310,310,310],140),campus=grid([-280,-280,280,280],200);
  const hf=new Heightfield(far,near,regional,undefined,campus);
  const mix=(a,b,t)=>a+(b-a)*(t*t*(3-2*t));
  assert.equal(hf.height(250,0),mix(mix(mix(20,80,.5),140,.5),200,30/80));
  assert.equal(hf.height(0,0),200);
  campus.sample=()=>NaN;
  assert.equal(hf.height(0,0),140);
  regional.sample=()=>NaN;
  assert.equal(hf.height(0,0),80);
});

test('shipped outer data decodes through the runtime and stays within mobile download budgets',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const hf=await loadHeightfield(meta);
  const restored = Heightfield.fromSnapshot(structuredClone(hf.snapshot()));
  const grids = [meta.far, meta.near, meta.arashiyama.elevation, meta.outer];
  const pixels = await normalMaps(hf, grids, async () => {});
  const copied = await normalMaps(restored, grids, async () => {});
  for (const {file} of grids) assert.ok(Buffer.from(pixels[file]).equals(Buffer.from(copied[file])), file);
  assert.ok(meta.outer.box[3]>=36000, 'central Osaka remains inside the terrain');
  for(const [x,z] of [[-18825,1105],[-28000,-11000],[8000,0],[0,18000],[-10000,25000],[-24058,33406]]) {
    assert.ok(Number.isFinite(hf.height(x,z))&&hf.height(x,z)>0,'new regions have actual elevation');
  }
  for(const [file,budget] of [[meta.outer.file,350000],[meta.aerialOuter.file,600000],[meta.aerialOuter.mobile.file,220000]])
    assert.ok((await stat(new URL(file,root))).size<=budget,file);
});
