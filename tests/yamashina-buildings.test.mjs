import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('Yamashina station, Misasagi and Daigo have houses on both sides of the survey boundary',async t=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  t.mock.method(globalThis,'fetch',async url=>new Response(await readFile(new URL(url.slice('/kyoto/'.length),root))));
  const layer=stem=>loadBuildings(stem+'.json',stem+'.bin');
  const [ward,fill]=await Promise.all([layer('buildings-yamashina'),layer('buildings-yamashina-basin')]);
  const houses=(data,x,z)=>data.boxes.filter(b=>Math.hypot(b.x-x,b.z-z)<500).length;
  assert.ok(houses(ward,5200,1220)>1000,'PLATEAU houses around Yamashina station');
  for(const [x,z] of [[3794,783],[5523,6279]]){
    assert.equal(houses(ward,x,z),0);
    assert.ok(houses(fill,x,z)>900,'GSI houses beyond the ward survey');
  }
});
