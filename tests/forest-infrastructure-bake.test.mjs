import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {infrastructureMask} from '../src/scripts/hero/forest-infrastructure.ts';

test('baked forest exclusions use the same grid at road edges and outside the district',()=>{
  const bytes=new Uint8Array(4+2048*2048/8);
  new DataView(bytes.buffer).setUint32(0,1,true);
  bytes[4+256+1]=1<<3;
  const hit=infrastructureMask([{}],[10,20,2058,2068],bytes);
  assert.equal(hit(21.5,21.5),true);
  for(const [x,z] of [[20,21],[22,21],[9,21],[2058,21],[21,2068]])assert.equal(hit(x,z),false);
});
test('each road survey has a complete forest mask, including both Yamashina shorelines',async()=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  const {regions}=JSON.parse(await readFile(new URL('regions.json',root)));
  for(const file of ['lines.bin',...regions.map(r=>r.lines.file),'lines-yamashina-lake.bin']){
    const data=gunzipSync(await readFile(new URL('forest-masks/'+file,root)));
    assert.equal(data.length,4+2048*2048/8);
    assert.ok(data.readUInt32LE()>0);
    if(file==='lines-yamashina.bin')assert.equal(data.readUInt32LE(),14589);
    if(file==='lines-yamashina-lake.bin')assert.equal(data.readUInt32LE(),14646);
  }
});
