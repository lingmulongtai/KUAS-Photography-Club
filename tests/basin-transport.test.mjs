import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadLines,LINE,RAIL} from '../src/scripts/hero/lines-data.ts';

test('the standing street map crosses Muko with surface lanes, minor streets and mapped yard tracks',async t=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  t.mock.method(globalThis,'fetch',async url=>new Response(await readFile(new URL(url.slice('/kyoto/'.length),root))));
  const {basinTransport:m}=JSON.parse(await readFile(new URL('terrain.json',root)));
  const lines=await loadLines(undefined,m.file,m.box,m.q);
  assert.equal(lines.length,m.features);
  assert.equal((await readFile(new URL(m.file,root))).length,m.bytes);
  assert.ok(m.bytes<300000);
  function lengths(x,z){
    const total={roads:0,alleys:0,sidings:0};
    for(const {kind,attr,pts} of lines){
      const key=kind===LINE.road?((attr&15)===0?'alleys':'roads'):(attr&4?'sidings':null);
      if(!key)continue;
      for(let i=2;i<pts.length;i+=2){
        const ax=pts[i-2],az=pts[i-1],bx=pts[i],bz=pts[i+1];
        if(Math.hypot((ax+bx)/2-x,(az+bz)/2-z)<500)total[key]+=Math.hypot(ax-bx,az-bz);
      }
    }
    return total;
  }
  for(const [x,z] of [[-4853,7612],[-6163,7660]]){
    const town=lengths(x,z);
    assert.ok(town.roads>12000&&town.alleys>4500,'the southern strip has streets without entering its region');
  }
  const north=lengths(-5779,5615);
  assert.ok(north.alleys>3000);
  assert.equal(north.roads,0,'the core already owns the larger roads north of the seam');
  assert.ok(lengths(-4530,6600).sidings>2000);
  // One east-west section through the yard. The generalised network had only four axes.
  const crossings={running:0,siding:0};
  for(const {kind,attr,pts} of lines){
    if(kind!==LINE.rail||!(attr&(RAIL.individual|RAIL.siding)))continue;
    for(let i=2;i<pts.length;i+=2){
      const ax=pts[i-2],az=pts[i-1],bx=pts[i],bz=pts[i+1];
      if((az>6600)===(bz>6600))continue;
      const x=ax+(bx-ax)*(6600-az)/(bz-az);
      if(x>-4855&&x< -4205)crossings[attr&RAIL.siding?'siding':'running']++;
    }
  }
  assert.deepEqual(crossings,{running:18,siding:11});
  assert.ok(lines.every(f=>f.kind===LINE.road||(f.kind===LINE.rail&&!(f.attr&1))));
});
