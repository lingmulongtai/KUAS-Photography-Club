import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveExplorer} from '../src/scripts/hero/free-explore.ts';
test('manual travel is frame bounded, keeps terrain clearance and cannot leave the mapped area',()=>{
  const p={x:0,y:100,z:0};moveExplorer(p,0,1,0,0,.1,false,()=>40);assert.equal(p.z,-18);
  moveExplorer(p,90,1,0,0,.1,false,()=>110);assert.ok(p.x>17);assert.equal(p.y,135);
  p.x=12499;p.z=19499;p.y=2999;moveExplorer(p,180,1,-1,1,30,true,()=>200);assert.ok(p.x<=12500&&p.z<=19500&&p.y<=3000);
});
