import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

const root=new URL('../public/kyoto/',import.meta.url);

test('the western basin has mapped roofs across both ward boundaries and the confluence handoff',async t=>{
  t.mock.method(globalThis,'fetch',async url=>new Response(await readFile(new URL(url.slice('/kyoto/'.length),root))));
  async function centres(stem){
    const {boxes,polys}=await loadBuildings(stem+'.json',stem+'.bin');
    return [...boxes,...polys.map(({ring})=>{
      let x=0,z=0;
      for(let i=0;i<ring.length;i+=2){x+=ring[i];z+=ring[i+1];}
      return {x:x/(ring.length/2),z:z/(ring.length/2)};
    })];
  }
  const [fixed,replaceable,detailed]=await Promise.all(
    ['buildings-otokuni','buildings-otokuni-tennozan','buildings-tennozan'].map(centres));
  const count=(data,x,z,r)=>data.filter(b=>Math.hypot(b.x-x,b.z-z)<r).length;

  // Three ground patches visible in the reported free-camera frame.
  for(const [x,z] of [[-4853,7612],[-6163,7660],[-5779,5615]]){
    assert.ok(count(fixed,x,z,250)>250,`no standing roofs around ${x},${z}`);
    assert.equal(count(replaceable,x,z,250),0);
  }
  for(const [x,z] of [[-5039,5558],[-5240,7145]]){
    assert.ok(count(fixed,x,z,500)>2000,'Muko station neighbourhoods retain their mapped density');
  }
  // Small mapped houses remain on screen when Tennozan takes over larger roofs.
  const atNagaokakyo=layer=>count(layer,-5430,8940,500);
  assert.ok(atNagaokakyo(fixed)>300);
  assert.ok(atNagaokakyo(replaceable)>1000);
  assert.ok(Math.abs(atNagaokakyo(detailed)-atNagaokakyo(replaceable))<40);

  for(const layer of [fixed,replaceable])assert.equal(count(layer,-6892,13047,95),0,'open river under the preset');
  const files=await Promise.all(['buildings-otokuni.bin','buildings-otokuni-tennozan.bin'].map(file=>readFile(new URL(file,root))));
  assert.ok(files[0].length+files[1].length<600*1024);
});
