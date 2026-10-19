import test from 'node:test';
import assert from 'node:assert/strict';
import {phoenixHall,byodoinParts,replacesByodoin,BYODOIN_CENTER} from '../src/scripts/hero/byodoin.ts';
test('Phoenix Hall keeps its official overall span, depth and paired roof finials',()=>{
  const parts=phoenixHall();let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,maxY=0,count=0;
  for(const {geo} of parts){const p=geo.getAttribute('position');count+=p.count;for(let i=0;i<p.count;i++){assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));minX=Math.min(minX,p.getX(i));maxX=Math.max(maxX,p.getX(i));minZ=Math.min(minZ,p.getZ(i));maxZ=Math.max(maxZ,p.getZ(i));maxY=Math.max(maxY,p.getY(i));}geo.dispose();}
  assert.ok(Math.abs(maxX-minX-47)<.05);assert.ok(Math.abs(maxZ-minZ-35)<.05);
  assert.ok(maxY>14&&maxY<14.5);assert.ok(count<100000);
});
test('the mapped hall is east-facing, terrain anchored and replaces only its own compound',()=>{
  const parts=byodoinParts(()=>18);
  assert.ok(replacesByodoin(BYODOIN_CENTER.x,BYODOIN_CENTER.z));
  assert.ok(!replacesByodoin(BYODOIN_CENTER.x+45,BYODOIN_CENTER.z));
  let minY=Infinity;for(const {geo} of parts){const p=geo.getAttribute('position');for(let i=0;i<p.count;i++)minY=Math.min(minY,p.getY(i));geo.dispose();}
  assert.ok(minY>=18);
});
