import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {toLocal} from '../src/scripts/hero/geo.ts';

test('Osaka overview reaches the city with bounded transfer and measured skyline heights',async()=>{
  const bytes=await readFile(new URL('../public/kyoto/buildings-osaka-lod.json.gz',import.meta.url));
  const data=JSON.parse(gunzipSync(bytes));
  assert.ok(bytes.length<150000);
  assert.ok(data.buildings.length>1000&&data.buildings.length<10000);
  assert.ok(data.towers.length>=5&&data.towers.length<100);
  assert.ok(data.towers.some(b=>b[4]>200),'measured high-rise heights are not clamped');
  const [x0,z0,x1,z1]=data.box;
  for(const [x,z,w,d,h,angle,ground] of [...data.buildings,...data.towers]){
    assert.ok(x>=x0&&x<=x1&&z>=z0&&z<=z1&&w>0&&d>0&&h>0);
    assert.ok(Number.isFinite(angle)&&Number.isFinite(ground));
  }
  const near=(p,b,r)=>Math.hypot(p.x-b[0],p.z-b[1])<r;
  const osaka=toLocal(34.702911,135.495896),ibaraki=toLocal(34.816,135.567);
  assert.ok(data.towers.some(b=>near(osaka,b,2500)),'measured towers reach central Osaka');
  assert.ok(data.buildings.some(b=>near(ibaraki,b,2500)),'the suburbs have real building samples');
  assert.ok(data.buildings.every(b=>data.towers.every(t=>Math.hypot(b[0]-t[0],b[1]-t[1])>35)),
    'a measured tower does not also appear as a low placeholder');
});
