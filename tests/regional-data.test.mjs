import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';
import {loadLines} from '../src/scripts/hero/lines-data.ts';

test('regional decoders keep their own origins without changing the core data',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  const meta=JSON.parse(await readFile(new URL('buildings.json',root),'utf8'));
  globalThis.fetch=async(url)=>{
    const name=String(url).split('/').pop();
    if(name==='regional.json')return Response.json({...meta,box:meta.box.map((v,i)=>v+(i%2?-8000:-20000))});
    return new Response(await readFile(new URL(name==='regional.bin'?'buildings.bin':name==='regional-lines.bin'?'lines.bin':name,root)));
  };
  t.after(()=>{globalThis.fetch=original;});
  const base=await loadBuildings(),regional=await loadBuildings('regional.json','regional.bin');
  assert.equal(regional.boxes.length,base.boxes.length);
  assert.equal(regional.polys.length,base.polys.length);
  assert.equal(regional.boxes[0].x,base.boxes[0].x-20000);
  assert.equal(regional.boxes[0].z,base.boxes[0].z-8000);
  const lines=await loadLines(),more=await loadLines(undefined,'regional-lines.bin',[-29000,-15000,-15400,-1800]);
  assert.equal(more.length,lines.length);
  assert.equal(more[0].pts[0],lines[0].pts[0]-20000);
  assert.equal(more[0].pts[1],lines[0].pts[1]-8000);
});
