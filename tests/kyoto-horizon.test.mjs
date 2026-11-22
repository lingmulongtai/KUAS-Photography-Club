import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {test} from 'node:test';
import {buildSync} from 'esbuild';
import * as THREE from 'three';

test('prebuilt Kyoto horizon preserves all six measured surveys and their culling bounds',()=>{
  const src=buildSync({entryPoints:['src/scripts/hero/distant-basin.ts'],bundle:true,format:'cjs',platform:'node',external:['three'],write:false,logLevel:'silent'}).outputFiles[0].text;
  const out={exports:{}};new Function('require','module','exports',src)(()=>THREE,out,out.exports);
  const bytes=gunzipSync(readFileSync(new URL('../public/kyoto/kansai/kyoto-horizon.bin.gz',import.meta.url)));
  const meshes=out.exports.horizonBatches({},bytes);
  assert.deepEqual(meshes.map(m=>m.count),[39925,5359,1839,3019,2137,3736]);
  for(const mesh of meshes){
    for(let i=0;i<mesh.count;i+=31){
      const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);
      assert.ok(mesh.boundingSphere.containsPoint(new THREE.Vector3().setFromMatrixPosition(matrix)));
      assert.ok(matrix.determinant()>0);
    }
  }
  assert.throws(()=>out.exports.horizonBatches({},bytes.subarray(0,-4)),/Truncated/);
});
