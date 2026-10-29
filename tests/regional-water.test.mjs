import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=require('esbuild'),Module=require('node:module');

test('regional water follows the Yamashina canal bends without a camera-dependent floating bank',async(t)=>{
  const result=await build({stdin:{resolveDir:process.cwd(),contents:`
    export {buildWater,buildWaterAsync} from './src/scripts/hero/water.ts';
    export {loadLines} from './src/scripts/hero/lines-data.ts';
    export {loadHeightfield} from './src/scripts/hero/heightfield.ts';
    export {createEnv} from './src/scripts/hero/env.ts';
  `},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
  const mod=new Module(import.meta.url);mod.filename=import.meta.filename;mod.paths=modulePaths();mod._compile(result.outputFiles[0].text,import.meta.filename);
  const {buildWater,buildWaterAsync,loadLines,loadHeightfield,createEnv}=mod.exports;
  const original=globalThis.fetch;globalThis.fetch=async path=>new Response(await readFile(new URL('../public'+path,import.meta.url)));t.after(()=>{globalThis.fetch=original;});
  const meta=JSON.parse(await readFile(new URL('../public/kyoto/terrain.json',import.meta.url))),hf=await loadHeightfield(meta);
  const regions=JSON.parse(await readFile(new URL('../public/kyoto/regions.json',import.meta.url))).regions;
  for(const region of regions.filter(r=>r.id==='yamashina')){
    const lines=await loadLines(undefined,region.lines.file,region.lines.box,region.lines.q);
    const water=buildWater(createEnv(),hf,lines,{},24,undefined,true),p=water.geometry.getAttribute('position');
    assert.ok(p.count>0&&p.count<600000,`${region.id} stays within its one-area geometry budget: ${p.count}`);
    assert.equal(water.material.uniforms.uWaterBias.value,.35);
    let measured=0;for(let i=0;i<p.count;i+=3){
      const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
      if(x<5082||x>5218||z< -95.5||z>172)continue;
      const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;assert.ok(y-hf.height(x,z)<1.6,'the documented canal no longer floats several metres above its bends');measured++;
    }
    assert.ok(measured>20,'the actual documented canal is sampled');water.geometry.dispose();water.material.dispose();
  }
  const confluence=regions.find(r=>r.id==='tennozan');assert.ok(confluence);
  const lines=await loadLines(undefined,confluence.lines.file,confluence.lines.box,confluence.lines.q);
  const water=buildWater(createEnv(),hf,lines,{},60,undefined,true);
  const p=water.geometry.getAttribute('position');
  assert.ok(p.count>0&&p.count<600000,`confluence water has bounded geometry: ${p.count}`);
  assert.equal(water.material.uniforms.uWaterBias.value,.35);
  const batched=await buildWaterAsync(createEnv(),hf,lines,{},60,undefined,true,()=>true);
  const bp=batched.geometry.getAttribute('position');assert.equal(bp.count,p.count);
  for(let i=0;i<p.count;i+=997)assert.equal(bp.getY(i),p.getY(i),'batched water matches the original');
  let current=true;setTimeout(()=>{current=false;},0);
  assert.equal(await buildWaterAsync(createEnv(),hf,lines,{},60,undefined,true,()=>current),null,'stale water preparation stops');
  batched.geometry.dispose();batched.material.dispose();
  water.geometry.dispose();water.material.dispose();
  const osaka=regions.find(r=>r.id==='osaka');assert.ok(osaka);
  const osakaLines=await loadLines(undefined,osaka.lines.file,osaka.lines.box,osaka.lines.q);
  const osakaWater=buildWater(createEnv(),hf,osakaLines,{},60,undefined,true);
  const op=osakaWater.geometry.getAttribute('position');
  assert.ok(op.count>0&&op.count<600000,`Osaka water has bounded geometry: ${op.count}`);
  assert.equal(osakaWater.material.uniforms.uWaterBias.value,.35);
  osakaWater.geometry.dispose();osakaWater.material.dispose();
});
function modulePaths(){return require.resolve.paths('three')??[];}
