// node tools/scenery-shader-fixture.cjs; open the URL in a WebGL2 browser.
// Real production forest, snow, beam and railway shaders, including their instance layouts.
const {build}=require('esbuild');
const http=require('node:http');
const {readFileSync}=require('node:fs');
const {gunzipSync}=require('node:zlib');
(async()=>{
  const rails=JSON.parse(gunzipSync(readFileSync('public/kyoto/railways.json.gz')));
  const result=await build({stdin:{resolveDir:process.cwd(),contents:`
import * as THREE from 'three';
import {createEnv} from './src/scripts/hero/env.ts';
import {createForest} from './src/scripts/hero/trees.ts';
import {buildSnow} from './src/scripts/hero/season-effects.ts';
import {buildKiyomizuBeam} from './src/scripts/hero/kiyomizu-beam.ts';
import {buildRailways} from './src/scripts/hero/railways.ts';
import {buildClouds} from './src/scripts/hero/clouds.ts';
import {buildTerrain} from './src/scripts/hero/terrain.ts';
const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(320,240);document.body.append(renderer.domElement);
renderer.debug.onShaderError=(gl,program,vs,fs)=>{throw Error(gl.getProgramInfoLog(program)+' '+gl.getShaderInfoLog(vs)+' '+gl.getShaderInfoLog(fs));};
const env=createEnv();env.uSnow.value=1;env.uSpring.value=1;env.uAutumn.value=1;env.uSunDir.value.set(.3,.8,.3).normalize();env.uSunLight.value.setRGB(1,1,1);
const depth=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);depth.compareFunction=THREE.LessEqualCompare;depth.needsUpdate=true;env.uShadowMap.value=depth;
const built=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);built.needsUpdate=true;env.uBuilt.value=built;
const image=document.createElement('canvas');image.width=image.height=32;const ctx=image.getContext('2d');ctx.fillStyle='#22551e';ctx.fillRect(0,0,32,32);
const hf={height:()=>0,normal:(_x,_z,_step,out)=>Object.assign(out,{x:0,y:1,z:0})};
const box=[-11000,-11000,11000,11000],photo=new THREE.CanvasTexture(image);
const normal=new THREE.DataTexture(new Uint8Array([128,255,128,255]),1,1);normal.needsUpdate=true;
const terrain=buildTerrain(env,{...hf,bounds:box},{x:0,z:0},{aerialWide:photo,aerialWideBox:box,aerialCity:photo,aerialCityBox:box,normalFar:normal,normalFarBox:box,normalNear:normal,normalNearBox:box,photos:[box]},16);terrain.setPhoto(0,photo);
const forest=createForest(env,hf,image,[-11000,-11000,11000,11000],.55,[{x:0,y:0,z:0,cherry:true}]);forest.plant({x:0,z:0},0);
const snow=buildSnow(env,.55),rail=buildRailways(env,()=>0,${JSON.stringify(rails.routes)}),beam=buildKiyomizuBeam(env,()=>0);
const camera=new THREE.PerspectiveCamera(60,4/3,1,60000);camera.position.set(0,80,130);camera.lookAt(0,0,0);
window.runSceneryChecks=()=>{
 const stats=[];
 for(const quality of [.55,1]){
  const canopy=createForest(env,hf,image,[-11000,-11000,11000,11000],quality);canopy.plant({x:0,z:0},0);
  let farInstances=0,triangles=0;
  for(const mesh of canopy.group.children){
   const geo=mesh.geometry,pos=geo.getAttribute('iPos'),vox=geo.getAttribute('aVox'),faces=geo.getAttribute('position').count/3;
   if(!Array.from(vox.array).every(v=>v>0))throw Error('Round canopy returned in a forest LOD');
   triangles+=faces*geo.instanceCount;
   for(let i=0;i<pos.count;i++)if(Math.hypot(pos.getX(i),pos.getZ(i))>=1200){if(faces>12)throw Error('Far canopy exceeded its box budget');farInstances++;}
   geo.dispose();
  }
  if(farInstances<100)throw Error('Distant forest was not covered');
  stats.push({name:'block-forest-budget',quality,instances:canopy.count,farInstances,triangles});
 }
 for(const [name,object] of [['terrain',terrain.mesh],['forest',forest.group],['snow',snow.points],['railways',rail.group],['beam',beam]]){
  const scene=new THREE.Scene();scene.add(object);renderer.info.reset();renderer.render(scene,camera);
  const error=renderer.getContext().getError();if(error)throw Error(name+' GPU error '+error);
  const info={name,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,points:renderer.info.render.points};
  if(info.calls<1)throw Error(name+' was not drawn');stats.push(info);scene.remove(object);
 }
 for(const quality of [.55,1]) for(const [climate,seed] of [['winter',7919],['winter',31676],['winter',39595],['summer',7919],['summer',31676],['summer',79190]]){
  const clouds=buildClouds(env,seed,quality,climate),scene=new THREE.Scene();scene.add(clouds.mesh);
  camera.lookAt(0,1800,0);renderer.info.reset();renderer.render(scene,camera);
  const error=renderer.getContext().getError();if(error)throw Error('Cloud GPU error '+error);
  if(renderer.info.render.calls<1)throw Error('Cloud layer was not drawn');
  stats.push({name:'cloud-'+climate+'-'+clouds.weather.style,quality,calls:renderer.info.render.calls});
  if(climate==='winter'&&seed===7919){
   // Run the shipped density function on fixed world positions, varying only its LOD distance.
   // The old 6/14 km cut-offs produced large density jumps even for an infinitesimal move.
   const fragment=clouds.mesh.material.fragmentShader.split('      void main(){')[0];
   const probe=new THREE.ShaderMaterial({defines:clouds.mesh.material.defines,uniforms:{...clouds.uniforms,uCover:{value:.9},uClear:{value:0},uProbeDistance:{value:0}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:fragment+'uniform float uProbeDistance; void main(){vec3 pos=vec3((gl_FragCoord.x/64.-.5)*32000.,uBase+(uTop-uBase)*.35,(gl_FragCoord.y/32.-.5)*32000.);gl_FragColor=vec4(density(pos,uProbeDistance),0.,0.,1.);}'});
   const geo=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geo,probe),probes=new THREE.Scene();quad.frustumCulled=false;probes.add(quad);
   const target=new THREE.WebGLRenderTarget(64,32,{type:THREE.FloatType,depthBuffer:false});
   const a=new Float32Array(64*32*4),b=new Float32Array(a.length);let maxJump=0,maxDensity=0;
   renderer.setRenderTarget(target);
   for(const boundary of [4000,6000,8000,10000,14000,16000]){
    for(const [offset,pixels] of [[-.1,a],[.1,b]]){
     probe.uniforms.uProbeDistance.value=boundary+offset;renderer.render(probes,camera);renderer.readRenderTargetPixels(target,0,0,64,32,pixels);
    }
    for(let i=0;i<a.length;i+=4){if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('Non-finite cloud density');maxJump=Math.max(maxJump,Math.abs(a[i]-b[i]));maxDensity=Math.max(maxDensity,a[i],b[i]);}
   }
   renderer.setRenderTarget(null);target.dispose();geo.dispose();probe.dispose();
   if(maxDensity<.1)throw Error('Cloud continuity probe did not sample a cloud');
   if(maxJump>.002)throw Error('Cloud detail distance discontinuity: '+maxJump);
   stats.push({name:'winter-cloud-continuity',quality,maxJump,maxDensity});
  }
  clouds.mesh.geometry.dispose();clouds.mesh.material.dispose();
 }
 const result={passed:true,stats};document.querySelector('pre').textContent=JSON.stringify(result,null,2);return result;
};
`},bundle:true,format:'iife',write:false});
  http.createServer((req,res)=>{
    res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');
    res.end(req.url==='/bundle.js'?result.outputFiles[0].text:'<!doctype html><title>Scenery shader verification</title><button onclick="runSceneryChecks()">Run scenery checks</button><pre>Ready</pre><script src="/bundle.js"></script>');
  }).listen(4331,'127.0.0.1',()=>console.log('http://127.0.0.1:4331'));
})().catch(error=>{console.error(error);process.exitCode=1;});
