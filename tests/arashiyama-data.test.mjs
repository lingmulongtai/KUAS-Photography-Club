import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {waterChecksum} from '../src/scripts/hero/water-detail.ts';

const root=new URL('../public/kyoto/',import.meta.url);
test('regional detail stays within its transfer budgets and matches the original water source',async()=>{
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const a=meta.arashiyama;
  assert.deepEqual(a.box,[-10500,-3200,-6500,800]);
  assert.equal(a.elevation.step,10);
  assert.deepEqual(a.size,[2048,2048]); assert.deepEqual(a.mobile.size,[1024,1024]);
  for(const [info,budget] of [[a,1024*1024],[a.mobile,320*1024],[a.elevation,350000],[a.water,256*1024]]) {
    const data=await readFile(new URL(info.file,root));
    assert.equal(data.length,info.bytes);assert.ok(data.length<=budget);
  }
  const terrain=gunzipSync(await readFile(new URL(a.elevation.file,root)));
  assert.equal(terrain.length,a.elevation.nx*a.elevation.nz*2);
  const original=await readFile(new URL('lines.bin',root));
  const water=JSON.parse(gunzipSync(await readFile(new URL(a.water.file,root))));
  assert.equal(createHash('sha256').update(original).digest('hex'),water.baseSha256);
  assert.equal(water.baseSha256,a.water.baseSha256);
  assert.equal(waterChecksum(gunzipSync(original)),water.baseChecksum);
  assert.ok(water.replace.length>0&&water.polygons.length>0);
  assert.ok(water.polygons.some(p=>p.holes.length>0),'islands remain holes');
  assert.ok(water.polygons.some(p=>p.outer.some((v,i)=>i%2===0&&v< -9200)),'upstream water extends beyond the former city limit');
  for(const p of water.polygons) for(const ring of [p.outer,...p.holes]) {
    assert.ok(ring.length>=6&&ring.length%2===0);
    assert.ok(ring.every(Number.isFinite));
  }
});
