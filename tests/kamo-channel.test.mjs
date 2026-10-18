import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createKamoChannel} from '../src/scripts/hero/kamo-channel.ts';
import {loadLines} from '../src/scripts/hero/lines-data.ts';
import {loadHeightfield} from '../src/scripts/hero/heightfield.ts';

test('the river surface stays level across raised banks and flows south past a raised bridge DEM',()=>{
  const features=[{kind:2,attr:2,pts:new Float32Array([1000,-3600,1100,-3600,1100,1500,1000,1500])},
    {kind:3,attr:2,pts:new Float32Array([1020,-2950,1050,-2950,1050,-2900,1020,-2900])},
    {kind:2,attr:2,pts:new Float32Array([800,-3600,804,-3600,804,1500,800,1500])}];
  const ground=(x,z)=>60-(z+3600)*.005+(Math.abs(x-1050)>35?12:0)+(Math.abs(z)<30?30:0);
  const river=createKamoChannel(features,ground);
  assert.equal(river.contains(1030,-2920),false,'retain the delta/island');
  assert.equal(river.contains(1060,-2920),true);
  assert.equal(river.owns(features[2].pts),false,'independent canal keeps its own water level');
  assert.equal(river.bed(802,-1600,90),90);
  assert.equal(river.bed(1030,-2920,70),70,'never carve mapped dry land');
  assert.equal(river.bed(1005,-1600,70),river.bed(1095,-1600,70),'one cross-section has one water level');
  assert.ok(river.level(0)<=river.level(-100),'a bridge cannot dam the rendered water');
  for(let z=-3600;z<1500;z+=5)assert.ok(river.level(z+5)<=river.level(z)+1e-8);
  for(const z of [-3600,1500]) {
    assert.equal(river.stability(1050,z),0);
    assert.ok(Math.abs(river.surface(1050,z,100)-100.4)<1e-9,'meet legacy water exactly at patch ends');
  }
  assert.equal(river.stability(1050,-1653),1);
  assert.ok(Math.abs(river.surface(1050,1499,100)-river.surface(1050,1500,100))<.01,'no sudden step at the patch edge');
});

test('actual Kamo data preserves the delta and supplies a finite continuous channel',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const [hf,lines]=await Promise.all([loadHeightfield(meta),loadLines(['water-arashiyama.json.gz','water-kamo.json.gz'])]);
  const river=createKamoChannel(lines,(x,z)=>hf.height(x,z));
  assert.equal(river.contains(1241.5,-2917.7),false,'Kamo delta remains dry');
  assert.equal(river.contains(665,1000),false,'western side canal is not the main river');
  assert.equal(river.contains(1114,500),false,'eastern side water keeps its original level');
  assert.ok(Array.from({length:240},(_,i)=>450+i*5).filter(x=>river.contains(x,-1653)).length>=4);
  for(let z=-3500;z<1400;z+=25) {
    assert.ok(Number.isFinite(river.level(z))&&river.level(z)>0);
    assert.ok(river.level(z+25)<=river.level(z)+1e-8);
  }
});
