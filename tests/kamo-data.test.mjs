import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {loadLines} from '../src/scripts/hero/lines-data.ts';
import {applyWaterDetails,waterChecksum} from '../src/scripts/hero/water-detail.ts';

test('Kamo and Arashiyama shoreline patches combine without touching roads or railways',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const base=await loadLines();
  const details=await Promise.all(['water-arashiyama.json.gz','water-kamo.json.gz'].map(async name=>
    JSON.parse(gunzipSync(await readFile(new URL(name,root))))));
  const checksum=waterChecksum(gunzipSync(await readFile(new URL('lines.bin',root))));
  const combined=applyWaterDetails(base,details,checksum);
  assert.deepEqual(combined.filter(f=>f.kind<2),base.filter(f=>f.kind<2));
  assert.ok(combined.filter(f=>f.kind===2&&f.attr===2).length>10);
  assert.ok(combined.filter(f=>f.kind===2&&f.attr===1).length>0);
  assert.throws(()=>applyWaterDetails(base,[details[0],details[0]],checksum),/Overlapping/);
  const runtime=await loadLines(['water-arashiyama.json.gz','water-kamo.json.gz']);
  assert.equal(runtime.length,combined.length);
  assert.equal(details[1].source,'GSI experimental_bvmap z16 waterarea');
});
