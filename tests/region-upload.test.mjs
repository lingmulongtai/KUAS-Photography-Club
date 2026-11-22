import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareRegionBuffers} from '../src/scripts/hero/region-upload.ts';

test('a district upload shares the final buffers and restores the visible draw even on failure',async()=>{
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setDrawRange(1,2);
  geometry.instanceCount=7;
  const group=new THREE.Group().add(new THREE.Mesh(geometry));
  const camera=new THREE.PerspectiveCamera(),previousTarget={};
  const original=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=callback=>setImmediate(callback);
  let target=previousTarget,draws=0;
  const renderer={
    getRenderTarget:()=>target,
    setRenderTarget(value){target=value;},
    render(scene){
      draws++;
      assert.notEqual(target,previousTarget);
      assert.equal(scene.children[0].geometry,geometry);
      assert.deepEqual(geometry.drawRange,{start:0,count:3});
      assert.equal(geometry.instanceCount,1);
      throw new Error('upload failed');
    }
  };
  try{
    await prepareRegionBuffers(renderer,camera,group,()=>false);
    assert.equal(draws,0);
    await assert.rejects(prepareRegionBuffers(renderer,camera,group,()=>true),/upload failed/);
    assert.equal(draws,1);
    assert.deepEqual(geometry.drawRange,{start:1,count:2});
    assert.equal(geometry.instanceCount,7);
    assert.equal(target,previousTarget);
  }finally{
    if(original)globalThis.requestAnimationFrame=original;
    else delete globalThis.requestAnimationFrame;
    geometry.dispose();
    group.children[0].material.dispose();
  }
});
