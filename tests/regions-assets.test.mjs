import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';
import {loadLines} from '../src/scripts/hero/lines-data.ts';
import {SPOTS} from '../src/data/spots.ts';
import {toLocal} from '../src/scripts/hero/geo.ts';
import {regionAt} from '../src/scripts/hero/regional-loader.ts';

test('each shipped region decodes within its bounds and bounded download budget',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const {regions}=JSON.parse(await readFile(new URL('regions.json',root),'utf8'));
  assert.deepEqual(regions.map(r=>r.id).sort(),['kameoka','sonobe','south','uji','yamashina']);
  assert.equal(regionAt(regions,toLocal(34.88928359,135.80767787))?.id,'uji','Uji data takes priority over overlapping Kyoto ward data');
  for(const [id,expected] of [['kameoka','kameoka'],['sonobe','sonobe'],['yamashina','yamashina'],['fushimi','south']]){
    const spot=SPOTS.find(s=>s.id===id);assert.ok(spot);
    assert.equal(regionAt(regions,toLocal(spot.lat,spot.lon))?.id,expected,`${id} actually enters its additional region`);
  }
  for(const region of regions) {
    const [x0,z0,x1,z1]=region.box;
    const valid=(x,z)=>Number.isFinite(x)&&Number.isFinite(z)&&x>=x0-.5&&x<=x1+.5&&z>=z0-.5&&z<=z1+.5;
    const buildings=await loadBuildings(region.buildings.meta,region.buildings.file);
    assert.ok(buildings.boxes.length+buildings.polys.length>10000,region.id);
    assert.ok(buildings.boxes.every(b=>valid(b.x,b.z)&&b.h>0&&b.w>0&&b.d>0));
    for(const p of buildings.polys)for(let i=0;i<p.ring.length;i+=2)assert.ok(valid(p.ring[i],p.ring[i+1]),region.id);
    const lines=await loadLines(undefined,region.lines.file,region.box,region.lines.q);
    assert.ok(lines.some(f=>f.kind===1),'rail network is included');
    assert.ok(lines.filter(f=>f.kind===0).length>100);
    for(const f of lines)for(let i=0;i<f.pts.length;i+=2)assert.ok(valid(f.pts[i],f.pts[i+1]),region.id);
    const bytes=(await stat(new URL(region.buildings.file,root))).size+(await stat(new URL(region.lines.file,root))).size;
    assert.ok(bytes<=1.5*1024*1024);
    assert.ok((await stat(new URL(region.photo.file,root))).size<=600000);
    assert.ok((await stat(new URL(region.photo.mobile.file,root))).size<=220000);
    assert.match(region.heightSource,/illustrative|measured/);
  }
});
