import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBuildings } from '../src/scripts/hero/buildings-data.ts';

test('shipped PLATEAU data retains Sagano houses within a bounded city payload',async()=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  const fetch=mock.method(globalThis,'fetch',async path=>new Response(await readFile(new URL(path.slice('/kyoto/'.length),root))));
  try {
    const {boxes,polys}=await loadBuildings();
    const meta=JSON.parse(await readFile(new URL('buildings.json',root),'utf8'));
    assert.equal(boxes.length,meta.boxes);assert.equal(polys.length,meta.polys);
    assert.ok((await readFile(new URL('buildings.bin',root))).length<2.2*1024*1024);
    const centres=[...boxes,...polys.map(p=>{
      let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}
      return {x:x/(p.ring.length/2),z:z/(p.ring.length/2)};
    })];
    for(const [x,z] of [[-6500,-1000],[-7000,-1500],[-7500,-1500]]) {
      const count=centres.filter(b=>b.x>=x&&b.x<x+500&&b.z>=z&&b.z<z+500).length;
      assert.ok(count>500,`Sagano cell ${x},${z} retains ${count} buildings`);
    }
    for(const b of boxes) assert.ok([b.x,b.z,b.w,b.d,b.h,b.ground].every(Number.isFinite));
    assert.ok(boxes.length+polys.length<300000);
  } finally {fetch.mock.restore();}
});
