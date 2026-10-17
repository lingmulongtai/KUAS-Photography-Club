import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {kawaramachiFacades} from '../src/scripts/hero/kawaramachi-facades.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('all four Kawaramachi corners and their immediate neighbours retain their actual footprints',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});const data=await loadBuildings();
  const before=JSON.stringify(data.polys.filter(p=>p.ring[0]>600&&p.ring[0]<980&&p.ring[1]>-140&&p.ring[1]<150));
  const {parts,sites}=kawaramachiFacades(data,{height:()=>30});
  for(const name of ['takashimaya','garden','northeast','northwest','opa'])assert.ok(sites.includes(name),name);
  assert.equal(sites.length,9);assert.equal(new Set(sites).size,sites.length);
  assert.equal(JSON.stringify(data.polys.filter(p=>p.ring[0]>600&&p.ring[0]<980&&p.ring[1]>-140&&p.ring[1]<150)),before);
  let triangles=0;for(const {geo} of parts){assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));
    triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;geo.dispose();}
  assert.ok(triangles<18000);
});
