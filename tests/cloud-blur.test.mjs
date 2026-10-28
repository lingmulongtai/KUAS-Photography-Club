import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCloudBlur } from '../src/scripts/hero/cloud-blur.ts';

function setup() {
  const camera=new THREE.PerspectiveCamera(), original=new THREE.MeshBasicMaterial();
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),original);
  let target=null,clearAlpha=.75,cleared=0,offscreen=0,framebufferComplete=true;
  const color=new THREE.Color(.2,.3,.4), gl={FRAMEBUFFER:1,FRAMEBUFFER_COMPLETE:2,checkFramebufferStatus:()=>framebufferComplete?2:0};
  const renderer={debug:{onShaderError:null},getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},
    getClearColor:c=>c.copy(color),getClearAlpha:()=>clearAlpha,setClearColor:(c,a)=>{color.set(c);clearAlpha=a;},
    clear(){cleared++;},render(){offscreen++;}};
  const blur=createCloudBlur(renderer,camera,mesh);
  return {blur,mesh,original,renderer,camera,color,counts:()=>({cleared,offscreen,target,clearAlpha}),failFramebuffer:()=>{framebufferComplete=false;}};
}

test('still clouds keep their original material and moving clouds use one bounded pass',()=>{
  const h=setup();let draws=0;
  h.blur.render([0,0],1000,500,2,()=>{draws++;assert.equal(h.mesh.material,h.original);});
  assert.equal(h.counts().offscreen,0);
  h.blur.render([.03,0],1000,500,2,()=>{
    draws++;assert.notEqual(h.mesh.material,h.original);
    const texture=h.mesh.material.uniforms.uCloud.value;
    assert.ok(texture.image.width*texture.image.height<=1_001_000);
  });
  assert.equal(draws,2);assert.equal(h.counts().offscreen,1);
  assert.equal(h.mesh.material,h.original);assert.equal(h.counts().target,null);assert.equal(h.counts().clearAlpha,.75);
  h.blur.dispose();
});

test('view-aligned wind and an incomplete framebuffer use the sharp fallback',()=>{
  const h=setup();let draws=0;
  h.blur.render([0,-.03],100,100,1,()=>{draws++;assert.equal(h.mesh.material,h.original);});
  assert.equal(h.counts().offscreen,0);
  h.failFramebuffer();const oldWarn=console.warn;console.warn=()=>{};
  try { h.blur.render([.03,0],100,100,1,()=>{draws++;assert.equal(h.mesh.material,h.original);}); }
  finally { console.warn=oldWarn; }
  assert.equal(draws,2);assert.equal(h.counts().offscreen,0);assert.equal(h.counts().target,null);assert.equal(h.counts().clearAlpha,.75);
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
  h.blur.dispose();
});
