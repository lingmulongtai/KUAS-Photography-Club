import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCloudBlur } from '../src/scripts/hero/cloud-blur.ts';

function setup(quality=1) {
  const camera=new THREE.PerspectiveCamera();
  const original=new THREE.ShaderMaterial({uniforms:{uVolumeOnly:{value:false}}});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),original);
  let target=null,clearAlpha=.75,cleared=0,offscreen=0,framebufferComplete=true;
  const color=new THREE.Color(.2,.3,.4), gl={FRAMEBUFFER:1,FRAMEBUFFER_COMPLETE:2,checkFramebufferStatus:()=>framebufferComplete?2:0};
  const renderer={debug:{onShaderError:null},getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},
    getClearColor:c=>c.copy(color),getClearAlpha:()=>clearAlpha,setClearColor:(c,a)=>{color.set(c);clearAlpha=a;},
    clear(){cleared++;},render(){offscreen++;}};
  const blur=createCloudBlur(renderer,camera,mesh,quality);
  return {blur,mesh,original,renderer,camera,color,counts:()=>({cleared,offscreen,target,clearAlpha}),failFramebuffer:()=>{framebufferComplete=false;}};
}

test('time-lapse blurs both cloud layers in one bounded pass',()=>{
  const h=setup();let draws=0;
  h.blur.render([.03,0],1000,500,2,()=>{
    draws++;assert.notEqual(h.mesh.material,h.original);
    const texture=h.mesh.material.uniforms.uCloud.value;
    assert.equal(h.mesh.material.uniforms.uFullResHigh.value,false);
    assert.ok(texture.image.width*texture.image.height<=1_001_000);
  });
  assert.equal(draws,1);assert.equal(h.counts().offscreen,1);
  assert.equal(h.mesh.material,h.original);assert.equal(h.counts().target,null);assert.equal(h.counts().clearAlpha,.75);
  h.blur.dispose();
});

test('still skies sample only the low volume offscreen and compose high clouds at output resolution',()=>{
  for (const [quality,scale] of [[1,.625],[.6,.5]]) {
    const h=setup(quality);
    h.renderer.render=()=>assert.equal(h.original.uniforms.uVolumeOnly.value,true);
    h.blur.render([0,0],1200,800,1,()=>{
      const {uFullResHigh,uResolution,uStep,uCloud}=h.mesh.material.uniforms;
      assert.equal(uFullResHigh.value,true);
      assert.deepEqual(uResolution.value.toArray(),[1200,800]);
      assert.equal(uCloud.value.image.width,1200*scale);
      assert.equal(uCloud.value.image.height,800*scale);
      assert.deepEqual(uStep.value.toArray(),[0,0]);
    });
    assert.equal(h.original.uniforms.uVolumeOnly.value,false);
    assert.equal(h.mesh.material,h.original);
    h.blur.dispose();
  }
});

test('view-aligned wind stays sharp and an incomplete framebuffer restores direct rendering',()=>{
  const h=setup();let draws=0;
  h.blur.render([0,-.03],100,100,1,()=>{draws++;assert.equal(h.mesh.material.uniforms.uFullResHigh.value,true);});
  h.failFramebuffer();const oldWarn=console.warn;console.warn=()=>{};
  try { h.blur.render([.03,0],100,100,1,()=>{draws++;assert.equal(h.mesh.material,h.original);}); }
  finally { console.warn=oldWarn; }
  assert.equal(draws,2);assert.equal(h.counts().offscreen,1);assert.equal(h.counts().target,null);assert.equal(h.counts().clearAlpha,.75);
  h.blur.dispose();
});

test('shader failure redraws sharp clouds and restores the previous error handler',()=>{
  const h=setup();let draws=0,reported=0;
  const oldHandler=()=>{reported++;};h.renderer.debug.onShaderError=oldHandler;
  h.blur.render([.03,0],100,100,1,()=>{
    draws++;
    if(draws===1)h.renderer.debug.onShaderError({},null,null,null);
    else assert.equal(h.mesh.material,h.original);
  });
  assert.equal(draws,2);assert.equal(reported,1);assert.equal(h.renderer.debug.onShaderError,oldHandler);
  assert.equal(h.mesh.material,h.original);
  h.blur.render([.03,0],100,100,1,()=>{draws++;assert.equal(h.mesh.material,h.original);});
  assert.equal(h.counts().offscreen,1);
  h.blur.restored();
  h.blur.render([0,0],100,100,1,()=>assert.notEqual(h.mesh.material,h.original));
  assert.equal(h.counts().offscreen,2);
  h.blur.dispose();
});
