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
    const {buildings,residentCount}=JSON.parse(gunzipSync(bytes));
    assert.ok(residentCount>0&&residentCount<buildings.length);
    assert.ok(buildings.slice(residentCount).some(([x,z])=>x< -9000||z>19000));
    assert.ok(bytes.length<100000);assert.ok(buildings.length>2000&&buildings.length<10000);
    assert.ok(buildings.every(b=>source.has(JSON.stringify(b))),'every overview block comes from the original data');
    assert.ok(buildings.some(([x,z])=>x< -9000||z>19000),'the Osaka approach remains visible at a distance');
    assert.ok(buildings.every(([x,z,w,d,h])=>x>=-14000&&x<=4600&&z>=6200&&z<=23000&&w>0&&d>0&&h>=2));
  } finally {globalThis.fetch=original;}
});

test('the northern panorama includes houses in the Iwakura, Kurama and Ohara valleys',async()=>{
  const bytes=await readFile(new URL('../public/kyoto/buildings-north-lod.json.gz',import.meta.url));
  assert.ok(bytes.length<30000);
  const {buildings}=JSON.parse(gunzipSync(bytes));
  for(const [x,z] of [[2420,-7475],[1225,-12060],[6125,-12925]]){
    assert.ok(buildings.filter(b=>Math.hypot(b[0]-x,b[1]-z)<500).length>=8);
  }
  assert.ok(buildings.every(([x,z,w,d,h])=>x>=-8200&&x<=8100&&z>=-20000&&z<=-7000&&w>0&&d>0&&h>=2));
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

test('the southern survey renders every footprint before travel and hands overlapping tiles to a detailed region',async()=>{
  const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {buildResidentCity} from './src/scripts/hero/buildings.ts';"},
    bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
  const module={exports:{}},require=createRequire(import.meta.url);
  new Function('require','module','exports',compiled)(id=>id==='three'?THREE:require(id),module,module.exports);
  const box={w:7,d:6,h:5,angle:0,kind:0,ground:0,z:7300};
  const extent=[-9000,6200,4600,19000];
  const city=await module.exports.buildResidentCity({},{height:()=>11},{
    boxes:[{...box,x:-8000},{...box,x:200},{...box,x:222}],
    polys:[{h:10,kind:1,ground:0,ring:[203,7350,215,7350,215,7365,203,7365]}],
  },extent);
  const boxes=city.mesh.children.filter(o=>o.geometry.isInstancedBufferGeometry);
  assert.equal(boxes.reduce((n,o)=>n+o.geometry.instanceCount,0),3);
  assert.ok(city.mesh.children.some(o=>!o.geometry.isInstancedBufferGeometry));
  city.setDetailBox(extent);assert.equal(city.mesh.visible,false);
  city.setDetailBox([0,7000,1000,7800]);assert.ok(city.mesh.visible);
  assert.ok(boxes.some(o=>o.visible));assert.ok(boxes.some(o=>!o.visible));
  city.setDetailBox(null);assert.ok(city.mesh.children.every(o=>o.visible));
});
