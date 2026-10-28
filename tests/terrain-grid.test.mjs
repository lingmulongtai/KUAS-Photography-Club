import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terrainPositions} from '../src/scripts/hero/terrain-grid.ts';

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
