import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gionStreetscape,gionStreetPoint} from '../src/scripts/hero/gion-streetscape.ts';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('teahouse detail follows the actual bending street without replacing measured houses',async(t)=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL('../public'+url,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});const data=await loadBuildings();
  const count=data.boxes.length+data.polys.length,{parts,fronts}=gionStreetscape(data,{height:()=>35});
  assert.ok(fronts.length>=20&&fronts.length<120,`street facades: ${fronts.length}`);
  assert.ok(fronts.every(f=>f.distance<=22&&f.distance>=3&&f.z>=-15&&f.z<=237));
  assert.ok(fronts.some(f=>f.z<25)&&fronts.some(f=>f.z>190));
  assert.equal(data.boxes.length+data.polys.length,count);
  assert.ok(gionStreetPoint(1398.57,127.85).distance<.01);
  assert.ok(gionStreetPoint(1506.35,219.97).distance>100,'do not turn the Kaburenjo into a teahouse');
  let triangles=0;for(const p of parts){assert.ok([...p.geo.getAttribute('position').array].every(Number.isFinite));triangles+=(p.geo.index?.count??p.geo.getAttribute('position').count)/3;p.geo.dispose();}
  assert.ok(triangles<18000);
});
