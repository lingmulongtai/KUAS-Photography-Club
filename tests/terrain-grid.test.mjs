import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terrainPositions,terrainPositionsAsync} from '../src/scripts/hero/terrain-grid.ts';

test('the warped grid ends at the surveyed elevation on all four edges',()=>{
  const hf={bounds:[-500,-800,900,1200],height:(x,z)=>x*.03+z*.07};
  const channel={bed:(x,z,y)=>y-Math.max(0,20-Math.abs(x-z)*.01)};
  for(const segments of [2,17,64]) for(const river of [undefined,channel]) {
    const center={x:123,z:-222}, grid=terrainPositions(hf,center,segments,river), n=segments+1;
    const warp=(u,c,lo,hi)=>u<0?c-(c-lo)*Math.abs(u)**2.1:c+(hi-c)*Math.abs(u)**2.1;
    for(let j=0;j<n;j++) for(let i=0;i<n;i++) {
      const x=warp(i/segments*2-1,center.x,hf.bounds[0],hf.bounds[2]);
      const z=warp(j/segments*2-1,center.z,hf.bounds[1],hf.bounds[3]);
      const ground=hf.height(x,z),y=river?river.bed(x,z,ground):ground,k=(j*n+i)*3;
      assert.equal(grid[k],Math.fround(x));assert.equal(grid[k+1],Math.fround(y));assert.equal(grid[k+2],Math.fround(z));
    }
  }
});

test('batched terrain matches the synchronous grid and cancels stale work',async()=>{
  const hf={bounds:[-500,-800,900,1200],height:(x,z)=>x*.03+z*.07};
  const center={x:123,z:-222},channel={bed:(x,z,y)=>y-Math.max(0,20-Math.abs(x-z)*.01)};
  let yields=0;
  const result=await terrainPositionsAsync(hf,center,64,channel,()=>true,async()=>{yields++;});
  assert.deepEqual(result,terrainPositions(hf,center,64,channel));assert.ok(yields>=5);
  let current=true,cancelYields=0;
  const cancelled=await terrainPositionsAsync(hf,center,64,channel,()=>current,async()=>{cancelYields++;current=false;});
  assert.equal(cancelled,null);assert.equal(cancelYields,1);
});


test('nearby terrain triangles stay fixed in world space when streaming recentres',()=>{
  const hf={bounds:[-35000,-20000,14000,36000],height:(x,z)=>100+40*Math.sin(x/30)*Math.cos(z/60)};
  for(const segments of [400,640]) {
    const n=segments+1,a=terrainPositions(hf,{x:-7300,z:11700},segments,undefined,true);
    const b=terrainPositions(hf,{x:-7300,z:12350},segments,undefined,true);
    const vertices=grid=>{const map=new Map();for(let k=0;k<grid.length;k+=3){
      const x=grid[k],z=grid[k+2];
      if(Math.abs(x+7300)<120&&Math.abs(z-12350)<120)map.set(`${x},${z}`,grid[k+1]);
    }return map;};
    const before=vertices(a),after=vertices(b);
    assert.ok(before.size>400);
    assert.deepEqual(after,before,'the surface under and ahead of the moving camera does not shift');
    assert.equal(b.length,n*n*3,'fixed detail keeps the same vertex budget');
  }
});


test('ongoing travel cannot change an in-flight terrain grid',async()=>{
  const hf={bounds:[-35000,-20000,14000,36000],height:(x,z)=>x*.03+z*.07};
  const center={x:-7300,z:11700},expected=terrainPositions(hf,center,400,undefined,true);
  const actual=await terrainPositionsAsync(hf,center,400,undefined,()=>true,async()=>{center.z+=25;});
  assert.deepEqual(actual,expected);
});


test('anchored grids remain ordered when the bounds cannot fit a lattice anchor',()=>{
  const hf={bounds:[-.5,-.5,1599.6,1599.6],height:()=>10};
  const segments=400,n=segments+1,grid=terrainPositions(hf,{x:800,z:800},segments,undefined,true);
  for(let i=1;i<n;i++)assert.ok(grid[i*3]>grid[(i-1)*3]);
});

test('viewpoints beyond the fallback DEM keep the terrain inside its surveyed bounds',()=>{
  const hf={bounds:[-500,-800,900,1200],height:()=>20};
  for(const anchored of [false,true]){
    const grid=terrainPositions(hf,{x:1300,z:-1100},32,undefined,anchored);
    for(let i=0;i<grid.length;i+=3){
      assert.ok(grid[i]>=-500 && grid[i]<=900);
      assert.ok(grid[i+2]>=-800 && grid[i+2]<=1200);
    }
  }
});
