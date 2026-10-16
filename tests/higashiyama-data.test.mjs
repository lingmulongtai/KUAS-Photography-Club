import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PLACES,toLocal} from '../src/scripts/hero/geo.ts';

const root=new URL('../public/kyoto/',import.meta.url);
const RAD=Math.PI/180;
const ahead=(p,bearing,m)=>({x:p.x+Math.sin(bearing*RAD)*m,z:p.z-Math.cos(bearing*RAD)*m});
/** Width and height from the frame header of a lossy WebP. */
const webpSize=data=>{
  assert.equal(data.toString('ascii',0,4),'RIFF');
  assert.equal(data.toString('ascii',8,16),'WEBPVP8 ');
  return [data.readUInt16LE(26)&0x3fff,data.readUInt16LE(28)&0x3fff];
};

test('Higashiyama photo stays within the Arashiyama-sized transfer budget',async()=>{
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const h=meta.higashiyama;
  assert.equal(h.zoom,17);
  assert.deepEqual(h.size,[1576,2048]); assert.deepEqual(h.mobile.size,[788,1024]);
  // square pixels, sharper than the 4.9 m city sheet by more than three times
  const mx=(h.box[2]-h.box[0])/h.size[0],mz=(h.box[3]-h.box[1])/h.size[1];
  assert.ok(Math.abs(mx-mz)<.01&&mx<1.3);
  for(const [info,budget] of [[h,760000],[h.mobile,260000]]) {
    const data=await readFile(new URL(info.file,root));
    assert.equal(data.length,info.bytes);assert.ok(data.length<=budget);
    assert.deepEqual(webpSize(data),info.size);
  }
});

test('Higashiyama photo covers the near ground of Shogunzuka and Kiyomizu without overlapping Arashiyama',async()=>{
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const b=meta.higashiyama.box;
  const inside=p=>p.x>b[0]&&p.x<b[2]&&p.z>b[1]&&p.z<b[3];
  // the default view looks west at bearing 265 across about 68 degrees
  const eye=ahead(PLACES.shogunzuka,265,120);
  for(let bearing=235;bearing<=295;bearing+=10) for(let m=300;m<=1200;m+=150) assert.ok(inside(ahead(eye,bearing,m)),`${bearing} ${m}`);
  // the stage of Kiyomizu-dera is an orbit view, so all round it
  const kiyomizu=toLocal(34.9946668,135.7849382);
  for(let bearing=0;bearing<360;bearing+=30) assert.ok(inside(ahead(kiyomizu,bearing,500)),`${bearing}`);
  const a=meta.arashiyama.box;
  assert.ok(b[0]>=a[2]||b[2]<=a[0]||b[1]>=a[3]||b[3]<=a[1],'regional photos do not overlap');
});
