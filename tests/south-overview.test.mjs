import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {loadBuildings} from '../src/scripts/hero/buildings-data.ts';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import * as THREE from 'three';

test('southern overview is a bounded sample of measured and confluence buildings',async()=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async url=>new Response(await readFile(new URL(String(url).replace(/^\/kyoto\//,''),root)));
  try {
    const south=await loadBuildings('buildings-south.json','buildings-south.bin');
    const tennozan=await loadBuildings('buildings-tennozan.json','buildings-tennozan.bin');
    const source=new Set([...south.boxes,...tennozan.boxes].map(b=>JSON.stringify([Math.round(b.x),Math.round(b.z),Math.round(b.w*2)/2,Math.round(b.d*2)/2,Math.round(b.h*2)/2,Math.round(b.angle*1000)/1000,b.ground])));
    const bytes=await readFile(new URL('buildings-south-lod.json.gz',root));
    const {buildings}=JSON.parse(gunzipSync(bytes));
    assert.ok(bytes.length<100000);assert.ok(buildings.length>2000&&buildings.length<10000);
    assert.ok(buildings.every(b=>source.has(JSON.stringify(b))),'every overview block comes from the original data');
    assert.ok(buildings.some(([x,z])=>x< -9000||z>19000),'the Osaka approach remains visible at a distance');
    assert.ok(buildings.every(([x,z,w,d,h])=>x>=-14000&&x<=4600&&z>=6200&&z<=23000&&w>0&&d>0&&h>=2));
  } finally {globalThis.fetch=original;}
});

test('detailed south replaces the overview while partial neighbouring coverage retains it',async()=>{
  const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {buildSouthOverview} from './src/scripts/hero/south-overview.ts';"},
    bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
  const module={exports:{}},require=createRequire(import.meta.url);
  new Function('require','module','exports',compiled)(id=>id==='three'?THREE:require(id),module,module.exports);
  const overview=await module.exports.buildSouthOverview({},[[0,7000,20,15,12,Math.PI/6,3]],()=>10);
  assert.ok(overview.mesh.boundingSphere);assert.equal(overview.mesh.frustumCulled,true);
  const matrix=new THREE.Matrix4();overview.mesh.getMatrixAt(0,matrix);assert.equal(matrix.elements[13],19);
  assert.ok(Math.abs(matrix.elements[2]-10)<1e-5,'the footprint follows its positive x/z bearing');
  overview.setDetailBox([-9000,6200,4600,19000]);assert.equal(overview.mesh.visible,true);
  overview.setDetailBox([0,10000,11000,19000]);assert.equal(overview.mesh.visible,true);
  overview.setDetailBox(null);assert.equal(overview.mesh.visible,true);
});
