import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {Heightfield,loadHeightfield} from '../src/scripts/hero/heightfield.ts';

const grid=(box,h)=>({meta:{box},sample:(x,z)=>x>=box[0]&&x<=box[2]&&z>=box[1]&&z<=box[3]?h:NaN});
test('campus terrain has local priority and a smooth join without changing Kyoto',()=>{
  const far=grid([-1000,-1000,1000,1000],40),near=grid([-400,-400,400,400],80),outer=grid([-5000,-5000,5000,5000],100);
  const campus=grid([-3500,-500,-2500,500],180);
  const old=new Heightfield(far,near,undefined,outer),next=new Heightfield(far,near,undefined,outer,campus);
  assert.equal(next.height(-3000,0),180);assert.equal(next.height(-3500,0),100);
  assert.ok(next.height(-3460,0)>100&&next.height(-3460,0)<180);
  for(const x of [-2000,-350,0,350,2000])assert.equal(next.height(x,0),old.height(x,0));
});

test('campus elevation and imagery cover the full sloping site within bounded budgets',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});const hf=await loadHeightfield(meta),detail=meta.kameokaCampus;
  assert.equal(detail.elevation.step,10);
  const values=[[-18825,850],[-18900,1150],[-18720,1030],[-18825,1460]].map(([x,z])=>hf.height(x,z));
  assert.ok(values.every(h=>Number.isFinite(h)&&h>80&&h<400));
  assert.ok(Math.max(...values)-Math.min(...values)>5,'the hillside is not flattened');
  for(const [file,budget] of [[detail.elevation.file,40000],[detail.file,700000],[detail.mobile.file,250000]])assert.ok((await stat(new URL(file,root))).size<=budget,file);
});
