const {build}=require(process.cwd()+'/node_modules/esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'); const assert=require('node:assert/strict');
(async()=>{
const result=await build({stdin:{resolveDir:process.cwd(),contents:`
import * as THREE from 'three';
import {buildCars} from './src/scripts/hero/cars.ts';
import {buildLamps} from './src/scripts/hero/lights.ts';
import {createEnv} from './src/scripts/hero/env.ts';
import {LINE} from './src/scripts/hero/lines-data.ts';
const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(128,128);document.body.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(60,1,.1,10000), scene=new THREE.Scene(), env=createEnv();env.uCity.value=1;
const roads=[{kind:LINE.road,attr:4,pts:new Float32Array([-500,0,500,0])}];
const cars=buildCars(env,{height:()=>0},roads,1);
const lights=cars.group.children[1];scene.add(lights);lights.geometry.instanceCount=1;cars.uniforms.uScale.value=128/(2*Math.tan(Math.PI/6));
const position=lights.geometry.getAttribute('aLightPosition'), direction=lights.geometry.getAttribute('aDir'), head=lights.geometry.getAttribute('aHead');
const target=new THREE.WebGLRenderTarget(128,128,{type:THREE.FloatType});const pixels=new Float32Array(128*128*4);
window.measure=()=>{
 const sums=[];head.setX(0,1);head.needsUpdate=true;direction.setXY(0,0,1);direction.needsUpdate=true;
 for(let step=0;step<=32;step++){
  position.setXYZ(0,(step/32)*500/cars.uniforms.uScale.value,0,-500);position.needsUpdate=true;
  renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,128,128,pixels);
  let sum=0;for(let i=0;i<pixels.length;i+=4){if(!Number.isFinite(pixels[i]))throw Error('non-finite light');sum+=pixels[i];}sums.push(sum);
 }
 const total=()=>{renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,128,128,pixels);return pixels.reduce((s,v,i)=>s+(i%4===0?v:0),0);};
 const carAt0=total();env.uTime.value=20;const carAt20=total();
 direction.setXY(0,0,-1);direction.needsUpdate=true;const hiddenHead=total();head.setX(0,0);head.needsUpdate=true;const visibleTail=total();
 scene.remove(lights);
 const lamps=buildLamps(env,{height:()=>0},roads,1);scene.add(lamps.points);lamps.points.geometry.instanceCount=1;
 lamps.uniforms.uScale.value=cars.uniforms.uScale.value;
 const lp=lamps.points.geometry.getAttribute('aLightPosition');lp.setXYZ(0,0,0,-6000);lp.needsUpdate=true;
 const shimmer=[];
 for(let frame=0;frame<=600;frame++){env.uTime.value=frame/60;shimmer.push(total());}
 const mean=shimmer.reduce((a,b)=>a+b)/shimmer.length;
 const shimmerRange=(Math.max(...shimmer)-Math.min(...shimmer))/mean;
 const shimmerFrameDelta=Math.max(...shimmer.slice(1).map((v,i)=>Math.abs(v-shimmer[i])))/mean;
 return {min:Math.min(...sums),max:Math.max(...sums),variation:(Math.max(...sums)-Math.min(...sums))/(sums.reduce((a,b)=>a+b)/sums.length),hiddenHead,visibleTail,carTimeDelta:Math.abs(carAt20-carAt0),shimmerRange,shimmerFrameDelta,instances:cars.count};
};
`},bundle:true,write:false,format:'iife'});
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?result.outputFiles[0].text:'<!doctype html><body><script src=/bundle.js></script>')}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined,headless:true});try{const page=await browser.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto('http://127.0.0.1:'+server.address().port);const stats=await page.evaluate(()=>window.measure());console.log(JSON.stringify({stats,errors}));assert.ok(!errors.length);assert.ok(stats.min>0&&stats.variation<.08);assert.ok(stats.hiddenHead<1e-5&&stats.visibleTail>0);assert.ok(stats.carTimeDelta<1e-6);assert.ok(stats.shimmerRange>.02&&stats.shimmerRange<.25);assert.ok(stats.shimmerFrameDelta<.004);}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
