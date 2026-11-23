import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {test} from 'node:test';
import {buildSync} from 'esbuild';
import * as THREE from 'three';

function loadDistantBasinModule(){
  const src=buildSync({entryPoints:['src/scripts/hero/distant-basin.ts'],bundle:true,format:'cjs',platform:'node',external:['three'],write:false,logLevel:'silent'}).outputFiles[0].text;
  const out={exports:{}};new Function('require','module','exports',src)(()=>THREE,out,out.exports);
  return out.exports;
}

test('prebuilt Kyoto horizon preserves all six measured surveys and their culling bounds',()=>{
  const mod=loadDistantBasinModule();
  const bytes=gunzipSync(readFileSync(new URL('../public/kyoto/kansai/kyoto-horizon.bin.gz',import.meta.url)));
  const meshes=mod.horizonBatches({},bytes);
  assert.deepEqual(meshes.map(m=>m.count),[39925,5359,1839,3019,2137,3736]);
  for(const mesh of meshes){
    for(let i=0;i<mesh.count;i+=31){
      const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);
      assert.ok(mesh.boundingSphere.containsPoint(new THREE.Vector3().setFromMatrixPosition(matrix)));
      assert.ok(matrix.determinant()>0);
    }
  }
  assert.throws(()=>mod.horizonBatches({},bytes.subarray(0,-4)),/Truncated/);
});

test('distantBasin defers kyoto-horizon.bin.gz inside Kyoto and loads it when approaching the cutoff',async t=>{
  const mod=loadDistantBasinModule();
  const rawBytes=gunzipSync(readFileSync(new URL('../public/kyoto/kansai/kyoto-horizon.bin.gz',import.meta.url)));
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(String(url));
    return new Response(rawBytes);
  });
  const scene=new THREE.Scene();
  const basin=mod.distantBasin({},scene,()=>0,async()=>{});
  // Inside Kyoto and nearby outer panoramas (including Kameoka Terrace at 9.4 km) must not fetch the 1.2 MB skyline.
  assert.equal(basin.update(2430,161,1000),false);
  assert.equal(basin.update(-7613,14397,1000),false);
  assert.equal(basin.update(-18392,2300,1000),false);
  assert.equal(calls.length,0);
  // Once well outside Kyoto (> 65% of cutoff = 12.35 km), fetch the baked horizon once.
  assert.equal(basin.update(17400,0,1000),false);
  assert.equal(calls.length,1);
  assert.equal(calls[0],'/kyoto/kansai/kyoto-horizon.bin.gz');
  await new Promise(resolve=>setTimeout(resolve,20));
  // Beyond cutoff the horizon swaps in cleanly.
  assert.equal(basin.update(26000,0,1000),true);
  assert.equal(basin.detail.visible,false);
  assert.equal(scene.getObjectByName('kyoto-basin-horizon').visible,true);
  assert.equal(calls.length,1);
});

test('distantBasin falls back to live registered surveys when kyoto-horizon fails',async t=>{
  const mod=loadDistantBasinModule();
  t.mock.method(globalThis,'fetch',async()=>new Response('missing',{status:404}));
  t.mock.method(console,'warn',()=>{});
  const scene=new THREE.Scene();
  const basin=mod.distantBasin({},scene,()=>10,async()=>{});
  basin.register({
    boxes:[{x:0,z:0,w:30,d:30,h:24,angle:0,ground:0,kind:0}],
    polys:[],
  });
  assert.equal(basin.update(26000,0,1000),false);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(basin.update(26000,0,1000),true);
  const horizon=scene.getObjectByName('kyoto-basin-horizon');
  assert.equal(horizon.visible,true);
  assert.equal(horizon.children.length,1);
});
