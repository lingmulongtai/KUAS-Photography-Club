import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';

test('Katsura uses the four surveyed transport outlines and restores three open platform roofs',async t=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async url=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const city=await loadBuildings(),code=buildSync({entryPoints:['src/scripts/hero/katsura-station.ts'],bundle:true,format:'cjs',platform:'node',packages:'external',write:false}).outputFiles[0].text;
  const mod={exports:{}};new Function('require','module','exports',code)(createRequire(import.meta.url),mod,mod.exports);
  const sample=mod.exports.katsuraStation(city.polys,()=>20);
  assert.ok(sample.complete);assert.equal(sample.replaced.size,4);
  const roofs=sample.parts.filter(p=>p.geo.type==='ExtrudeGeometry'&&p.geo.parameters.options.depth===.26);
  assert.equal(roofs.length,3);
  const expected=[6.7,10.4,10.7];
  const heights=roofs.map(p=>{
    p.geo.computeBoundingBox();const box=p.geo.boundingBox;
    const footprint=[...sample.replaced].find(b=>Math.abs(Math.min(...b.ring.filter((_,i)=>i%2===0))-box.min.x)<.5);
    assert.ok(footprint);assert.ok(Math.abs(box.max.y-box.min.y-.26)<.005);
    return box.max.y-20-footprint.ground;
  }).sort((a,b)=>a-b);
  heights.forEach((h,i)=>assert.ok(Math.abs(h-expected[i])<.01));
  assert.ok(sample.parts.length<350);
});
