import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as geometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {buildSync} from 'esbuild';

const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {kameokaArchitecture,isKameokaBuilding,KAMEOKA_CENTER} from './src/scripts/hero/kameoka-campus.ts';"},
  bundle:true,platform:'node',format:'cjs',external:['three','three/addons/*'],write:false}).outputFiles[0].text;
const result={exports:{}};
new Function('require','module','exports',compiled)(id=>{
  if(id==='three')return THREE;if(id==='three/addons/utils/BufferGeometryUtils.js')return geometryUtils;throw Error(id);
},result,result.exports);
const {kameokaArchitecture,isKameokaBuilding,KAMEOKA_CENTER:C}=result.exports;
const hf={height:(x,z)=>100+(x-C.x)*.02-(z-C.z)*.04};

test('Kameoka facilities have individual hillside datums, recessed glazing and bounded static geometry',()=>{
  const g=kameokaArchitecture(hf),p=g.getAttribute('position'),n=g.getAttribute('normal'),m=g.getAttribute('aMat');
  const sites=g.userData.facilities;
  assert.equal(sites.length,15);assert.ok(p.count<900000,`vertices: ${p.count}`);
  assert.ok([...p.array].every(Number.isFinite));
  for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
  assert.ok([...m.array].includes(1)&&[...m.array].includes(15),'recessed glass and red brick');
  assert.ok(Math.max(...sites.map(s=>s.ground))-Math.min(...sites.map(s=>s.ground))>10,'the site remains terraced');
  const bio=sites.find(s=>s.id==='bio');let top=-Infinity;
  for(let i=bio.start;i<bio.start+bio.count;i++)top=Math.max(top,p.getY(i));
  assert.ok(top-bio.ground>39&&top-bio.ground<40,'eleven-storey environmental sciences slab');
  assert.equal(isKameokaBuilding(C.x-155,C.z-65),true);
  assert.equal(isKameokaBuilding(C.x-300,C.z+250),false,'do not clear surrounding homes or fields');g.dispose();
});

test('pilotis and residential courts remain open; the gym has a curved upper silhouette',()=>{
  const g=kameokaArchitecture(hf),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(g,material);
  const floor=hf.height(C.x+40,C.z-140)+.18;
  const under=new THREE.Raycaster(new THREE.Vector3(C.x+20,floor+1.5,C.z-140),new THREE.Vector3(1,0,0),0,20).intersectObject(mesh);
  assert.equal(under.length,0,'do not fill the academic hall pilotis with a footing');
  const wall=new THREE.Raycaster(new THREE.Vector3(C.x+20,floor+6,C.z-140),new THREE.Vector3(1,0,0),0,20).intersectObject(mesh);
  assert.ok(wall.length>0);
  const court=new THREE.Raycaster(new THREE.Vector3(C.x+35,180,C.z-100),new THREE.Vector3(0,-1,0)).intersectObject(mesh);
  assert.equal(court.length,0,'dormitory roof stays open over its courtyard');
  const gym=new THREE.Raycaster(new THREE.Vector3(C.x-93,180,C.z+30),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];
  assert.ok(gym.point.y>hf.height(C.x-93,C.z+57)+14.5);
  g.dispose();material.dispose();
});
