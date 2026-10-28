import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trafficJunctions,chooseConnection} from '../src/scripts/hero/traffic-junctions.ts';
import {trafficSegments} from '../src/scripts/hero/traffic-access.ts';
import {loadLines,LINE} from '../src/scripts/hero/lines-data.ts';
import {readFile} from 'node:fs/promises';

test('traffic connects shared road endpoints, never distant or self links',()=>{
  const path=(...points)=>({pts:new Float32Array(points)});
  const links=trafficJunctions([path(-100,0,0,0),path(0,0,100,0),path(0,0,0,100),path(.9,0,100,100)]);
  assert.deepEqual(links[0][1].map(c=>c.path).sort(),[1,2]);
  assert.equal(links[0][0].length,0);assert.ok(links[1][0].every(c=>c.path!==1));
  assert.equal(chooseConnection(links[0][1],1,0,0)?.path,1);
  assert.equal(chooseConnection(links[0][1],-1,0,0)?.path,2,'do not reverse into the opposing road');
  assert.equal(chooseConnection([],1,0,.5),null);
});

test('real Kyoto road data provides connected routes without linking distant endpoints',async()=>{
  const original=globalThis.fetch,root=new URL('../public/kyoto/',import.meta.url);
  globalThis.fetch=async url=>new Response(await readFile(new URL(String(url).replace(/^\/kyoto\//,''),root)));
  try {
    const lines=await loadLines(),paths=[];
    for(const line of lines)if(line.kind===LINE.road&&(line.attr&15)>=2)for(const pts of trafficSegments(line.pts)){
      let length=0;for(let i=2;i<pts.length;i+=2)length+=Math.hypot(pts[i]-pts[i-2],pts[i+1]-pts[i-1]);
      if(length>=80)paths.push({pts});
    }
    const links=trafficJunctions(paths);assert.ok(links.some(pair=>pair.some(options=>options.length>0)));
    for(let i=0;i<links.length;i++)for(let end=0;end<2;end++)for(const link of links[i][end]){
      const a=paths[i].pts,b=paths[link.path].pts,ai=end?a.length-2:0,bi=link.end?b.length-2:0;
      assert.ok(Math.hypot(a[ai]-b[bi],a[ai+1]-b[bi+1])<=.6);
    }
  } finally {globalThis.fetch=original;}
});
