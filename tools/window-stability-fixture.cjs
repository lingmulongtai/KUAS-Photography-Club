// node tools/window-stability-fixture.cjs; open the printed URL in a WebGL2 browser.
// Exercise the actual instanced and polygon building shaders, not a shader mock.
const {build}=require('esbuild');
const http=require('node:http');
(async()=>{
  const result=await build({stdin:{resolveDir:process.cwd(),contents:`
import * as THREE from 'three';
import {buildCity} from './src/scripts/hero/buildings.ts';
import {createEnv} from './src/scripts/hero/env.ts';
const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(192,192);
renderer.setClearColor(0,0);
document.body.append(renderer.domElement);
renderer.debug.onShaderError=(gl,program,vs,fs)=>{throw Error(gl.getProgramInfoLog(program)+' '+gl.getShaderInfoLog(vs)+' '+gl.getShaderInfoLog(fs));};
const target=new THREE.WebGLRenderTarget(192,192,{type:THREE.FloatType});
const pixels=new Float32Array(192*192*4),camera=new THREE.PerspectiveCamera(55,1,.1,200);
const env=createEnv();env.uCity.value=1;env.uLit.value=.6;
const depth=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);depth.compareFunction=THREE.LessEqualCompare;depth.needsUpdate=true;env.uShadowMap.value=depth;
const built=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);built.needsUpdate=true;env.uBuilt.value=built;
const scene=new THREE.Scene();
const box={x:0,z:0,w:12,d:8,h:18,angle:0,ground:0,kind:17};
const poly={ring:new Float32Array([-6,-4,6,-4,6,4,-6,4]),h:18,ground:0,kind:17};
window.runWindowChecks=()=>{
 const stats=[];
 for(const shape of ['box','polygon']) {
  const city=buildCity(env,{height:()=>0},{boxes:shape==='box'?[box]:[],polys:shape==='polygon'?[poly]:[]});
  const mesh=city.group.children[0],mat=mesh.material,original=mat.fragmentShader;
  scene.add(city.group);
  for(const interpolation of ['smooth','flat']) {
   // Read one constant window-cell hash over the entire facade. Any variation
   // comes from interpolating identity, not the intended window grid or shimmer.
   const fragment=original.replace('gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);',
    'gl_FragColor=vec4(seed,hash12(vec2(1.7,3.1)+seed*31.),0.,1.);');
   mat.vertexShader=mat.vertexShader.replace(/(?:(?:flat|smooth) )?varying vec4 vInfo;/g,interpolation+' varying vec4 vInfo;');
   mat.fragmentShader=fragment.replace(/(?:(?:flat|smooth) )?varying vec4 vInfo;/g,interpolation+' varying vec4 vInfo;');
   mat.needsUpdate=true;
   let min=Infinity,max=-Infinity,seedMin=Infinity,seedMax=-Infinity,samples=0;
   for(let i=0;i<8;i++) {
    camera.position.set(Math.sin(i*.13)*4,7+i*.17,-25);camera.lookAt(0,8,0);
    renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
    const drawError=renderer.getContext().getError();
    if(drawError)throw Error('GPU draw error '+drawError);
    renderer.readRenderTargetPixels(target,0,0,192,192,pixels);
    const readError=renderer.getContext().getError();if(readError)throw Error('read error '+readError);
    for(let p=0;p<pixels.length;p+=4)if(pixels[p+3]>.5) {
     if(!Number.isFinite(pixels[p])||!Number.isFinite(pixels[p+1]))throw Error('Non-finite window identity');
     seedMin=Math.min(seedMin,pixels[p]);seedMax=Math.max(seedMax,pixels[p]);
     min=Math.min(min,pixels[p+1]);max=Math.max(max,pixels[p+1]);samples++;
    }
   }
   stats.push({shape,interpolation,samples,seedRange:seedMax-seedMin,hashRange:max-min});
   if(interpolation==='flat'&&(samples<1000||seedMax<.001||max-min>1e-6))throw Error('Window identity unstable or absent: '+JSON.stringify(stats));
  }
  // Compile/render the complete production material too, including night emission.
  mat.fragmentShader=original;mat.needsUpdate=true;renderer.render(scene,camera);
  if(renderer.getContext().getError())throw Error('Production night material failed to draw');
  scene.remove(city.group);city.group.traverse(o=>{o.geometry?.dispose();});mat.dispose();
 }
 renderer.setRenderTarget(null);renderer.clear();
 const result={passed:true,stats};document.querySelector('pre').textContent=JSON.stringify(result,null,2);return result;
};
`},bundle:true,format:'iife',write:false});
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');
    res.end(req.url==='/bundle.js'?result.outputFiles[0].text:'<!doctype html><title>Window stability verification</title><pre>Ready: runWindowChecks()</pre><script src="/bundle.js"></script>');
  });
  server.listen(4330,'127.0.0.1',()=>console.log('http://127.0.0.1:4330'));
})().catch(error=>{console.error(error);process.exitCode=1;});
