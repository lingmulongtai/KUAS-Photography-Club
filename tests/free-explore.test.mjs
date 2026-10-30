import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveExplorer} from '../src/scripts/hero/free-explore.ts';
test('manual travel is frame bounded, keeps terrain clearance and cannot leave the mapped area',()=>{
  const p={x:0,y:100,z:0};moveExplorer(p,0,1,0,0,.1,false,()=>40);assert.equal(p.z,-18);
  moveExplorer(p,90,1,0,0,.1,false,()=>110);assert.ok(p.x>17);assert.equal(p.y,135);
  p.x=12499;p.z=19499;p.y=2999;moveExplorer(p,180,1,-1,1,30,true,()=>200);assert.ok(p.x<=12500&&p.z<=19500&&p.y<=3000);
});


test('travel can enter Osaka using the shipped outer terrain instead of the old Kyoto limit',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {toLocal}=await import('../src/scripts/hero/geo.ts');
  const meta=JSON.parse(await readFile(new URL('../public/kyoto/terrain.json',import.meta.url)));
  const p={...toLocal(34.702911,135.495896),y:180};
  const before={...p};
  moveExplorer(p,180,1,0,0,.1,false,()=>10,meta.outer.box);
  assert.equal(p.x,before.x);
  assert.equal(p.z,before.z+18,'movement at Osaka never clamps back to Kyoto');
  for(let i=0;i<500;i++)moveExplorer(p,180,1,0,0,.1,true,()=>10,meta.outer.box);
  assert.equal(p.z,meta.outer.box[3]-500,'travel still stops before the actual terrain edge');
});


test('acceleration increases movement speed while retaining the frame bound',()=>{
  const normal={x:0,y:100,z:0},fast={...normal};
  moveExplorer(normal,0,1,0,0,.1,false,()=>0);
  moveExplorer(fast,0,1,0,0,.1,true,()=>0);
  assert.equal(normal.z,-18);
  assert.equal(fast.z,-65);
});
