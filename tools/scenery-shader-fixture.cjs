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
const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(320,240);document.body.append(renderer.domElement);
renderer.debug.onShaderError=(gl,program,vs,fs)=>{throw Error(gl.getProgramInfoLog(program)+' '+gl.getShaderInfoLog(vs)+' '+gl.getShaderInfoLog(fs));};
const env=createEnv();env.uSnow.value=1;env.uSpring.value=1;env.uAutumn.value=1;env.uSunDir.value.set(.3,.8,.3).normalize();env.uSunLight.value.setRGB(1,1,1);
const depth=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);depth.compareFunction=THREE.LessEqualCompare;depth.needsUpdate=true;env.uShadowMap.value=depth;
const built=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);built.needsUpdate=true;env.uBuilt.value=built;
const image=document.createElement('canvas');image.width=image.height=32;const ctx=image.getContext('2d');ctx.fillStyle='#22551e';ctx.fillRect(0,0,32,32);
const hf={height:()=>0,normal:(_x,_z,_step,out)=>Object.assign(out,{x:0,y:1,z:0})};
const forest=createForest(env,hf,image,[-11000,-11000,11000,11000],.55,[{x:0,y:0,z:0,cherry:true}]);forest.plant({x:0,z:0},0);
const snow=buildSnow(env,.55),rail=buildRailways(env,()=>0,${JSON.stringify(rails.routes)}),beam=buildKiyomizuBeam(env,()=>0);
const camera=new THREE.PerspectiveCamera(60,4/3,1,60000);camera.position.set(0,80,130);camera.lookAt(0,0,0);
window.runSceneryChecks=()=>{
 const stats=[];
 for(const [name,object] of [['forest',forest.group],['snow',snow.points],['railways',rail.group],['beam',beam]]){
  const scene=new THREE.Scene();scene.add(object);renderer.info.reset();renderer.render(scene,camera);
  const error=renderer.getContext().getError();if(error)throw Error(name+' GPU error '+error);
  const info={name,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,points:renderer.info.render.points};
  if(info.calls<1)throw Error(name+' was not drawn');stats.push(info);scene.remove(object);
 }
 for(const seed of [0,9817,19634,29451,39268,49085]){
  const clouds=buildClouds(env,seed),scene=new THREE.Scene();scene.add(clouds.mesh);
  camera.lookAt(0,1800,0);renderer.info.reset();renderer.render(scene,camera);
  const error=renderer.getContext().getError();if(error)throw Error('Cloud GPU error '+error);
  if(renderer.info.render.calls<1)throw Error('Cloud layer was not drawn');
  stats.push({name:'cloud-'+clouds.weather.style,calls:renderer.info.render.calls});
  clouds.mesh.geometry.dispose();clouds.mesh.material.dispose();
 }
 const result={passed:true,stats};document.querySelector('pre').textContent=JSON.stringify(result,null,2);return result;
};
`},bundle:true,format:'iife',write:false});
  http.createServer((req,res)=>{
    res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');
    res.end(req.url==='/bundle.js'?result.outputFiles[0].text:'<!doctype html><title>Scenery shader verification</title><pre>Ready: runSceneryChecks()</pre><script src="/bundle.js"></script>');
  }).listen(4331,'127.0.0.1',()=>console.log('http://127.0.0.1:4331'));
})().catch(error=>{console.error(error);process.exitCode=1;});
