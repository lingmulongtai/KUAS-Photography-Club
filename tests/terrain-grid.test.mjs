import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terrainPositions,terrainPositionsAsync} from '../src/scripts/hero/terrain-grid.ts';

test('warped terrain retains the original positions, edge skirt and channel bed',()=>{
  const hf={bounds:[-500,-800,900,1200],height:(x,z)=>x*.03+z*.07};
  const channel={bed:(x,z,y)=>y-Math.max(0,20-Math.abs(x-z)*.01)};
  for(const segments of [2,17,64]) for(const river of [undefined,channel]) {
    const center={x:123,z:-222}, grid=terrainPositions(hf,center,segments,river), n=segments+1;
    const warp=(u,c,lo,hi)=>u<0?c-(c-lo)*Math.abs(u)**2.1:c+(hi-c)*Math.abs(u)**2.1;
    for(let j=0;j<n;j++) for(let i=0;i<n;i++) {
      const x=warp(i/segments*2-1,center.x,hf.bounds[0],hf.bounds[2])+(i===0?-20000:i===segments?20000:0);
      const z=warp(j/segments*2-1,center.z,hf.bounds[1],hf.bounds[3])+(j===0?-20000:j===segments?20000:0);
      const cx=Math.max(hf.bounds[0],Math.min(x,hf.bounds[2])),cz=Math.max(hf.bounds[1],Math.min(z,hf.bounds[3]));
      const ground=hf.height(cx,cz),y=(river?river.bed(cx,cz,ground):ground)-(cx!==x||cz!==z?60:0),k=(j*n+i)*3;
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
    const n=segments+1,a=terrainPositions(hf,{x:-7300,z:11700},segments);
    const b=terrainPositions(hf,{x:-7300,z:12350},segments);
    const vertices=grid=>{const map=new Map();for(let k=0;k<grid.length;k+=3){
      const x=grid[k],z=grid[k+2];
      if(Math.abs(x+7300)<600&&Math.abs(z-12350)<600)map.set(`${x},${z}`,grid[k+1]);
    }return map;};
    const before=vertices(a),after=vertices(b);
    assert.ok(before.size>400);
    assert.deepEqual(after,before,'the surface under and ahead of the moving camera does not shift');
    assert.equal(b.length,n*n*3,'fixed detail keeps the same vertex budget');
  }
});


test('ongoing travel cannot change an in-flight terrain grid',async()=>{
  const hf={bounds:[-35000,-20000,14000,36000],height:(x,z)=>x*.03+z*.07};
  const center={x:-7300,z:11700},expected=terrainPositions(hf,center,400);
  const actual=await terrainPositionsAsync(hf,center,400,undefined,()=>true,async()=>{center.z+=25;});
  assert.deepEqual(actual,expected);
});
