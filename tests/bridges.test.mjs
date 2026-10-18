import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildBridges,bridgeFrame} from '../src/scripts/hero/bridges.ts';
import {createEnv} from '../src/scripts/hero/env.ts';
import {createKamoChannel} from '../src/scripts/hero/kamo-channel.ts';
import {readFile} from 'node:fs/promises';
import {loadLines} from '../src/scripts/hero/lines-data.ts';
import {loadHeightfield} from '../src/scripts/hero/heightfield.ts';

test('Sanjo and Gojo have physical decks, open water below and traffic matched to their ramps',()=>{
  const hf={height:()=>38},river=createKamoChannel([],()=>34);
  const {mesh,bridges,heightAt}=buildBridges(createEnv(),hf,[],river);
  for(const [id,length,width] of [['sanjo',73.3,16.7],['gojo',67.2,35]]) {
    const b=bridges.find(b=>b.id===id);
    assert.equal(b.length,length);assert.equal(b.width,width);
    const a=b.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const at=(along,across=2)=>new THREE.Vector3(b.x+c*along-s*across,0,b.z+s*along+c*across);
    assert.ok(Math.abs(bridgeFrame(b,...[at(10).x,at(10).z]).along-10)<1e-9);
    const off=at(.37,2.13).setY(50);
    const layers=new THREE.Raycaster(off,new THREE.Vector3(0,-1,0),0,20).intersectObject(mesh);
    assert.ok(layers[1].distance-layers[0].distance>.02,'asphalt and slab must not share a plane');
    for(const along of [0,length/2+4]) {
      const p=at(along),y=heightAt(p.x,p.z);
      const hit=new THREE.Raycaster(p.clone().setY(50),new THREE.Vector3(0,-1,0),0,20).intersectObject(mesh)[0];
      assert.ok(hit&&Math.abs(hit.point.y-y)<.03,'car tyres and visible deck meet');
    }
    const under=at(0,0).setY(36);
    assert.equal(new THREE.Raycaster(under,new THREE.Vector3(0,-1,0),0,1).intersectObject(mesh).length,0,'river can flow underneath');
  }
  const p=mesh.geometry.getAttribute('position');
  assert.ok(p.count<250000);
  for(const v of p.array)assert.ok(Number.isFinite(v));
});

test('mapped side crossings stay within the static geometry budget',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),original=globalThis.fetch;
  globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const [hf,lines]=await Promise.all([loadHeightfield(meta),loadLines(['water-arashiyama.json.gz','water-kamo.json.gz'])]);
  const river=createKamoChannel(lines,(x,z)=>hf.height(x,z));
  const {mesh,bridges,heightAt}=buildBridges(createEnv(),hf,lines,river);
  assert.ok(bridges.length>=14&&bridges.length<=180);
  assert.ok(mesh.geometry.getAttribute('position').count<450000);
  for(const b of bridges)assert.ok(Number.isFinite(b.deck)&&b.deck>=river.level(b.z)+1.29);
  for(const b of bridges.filter(b=>b.id==='sanjo'||b.id==='gojo'))for(const end of [-1,1]) {
    const a=b.angle*Math.PI/180,along=end*(b.length/2+4),across=-4;
    const x=b.x+Math.cos(a)*along-Math.sin(a)*across,z=b.z+Math.sin(a)*along+Math.cos(a)*across;
    const hit=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0),0,100).intersectObject(mesh)[0];
    assert.ok(hit&&Math.abs(hit.point.y-heightAt(x,z))<.03,'actual bank slopes must not swallow car wheels');
  }
  mesh.geometry.dispose();mesh.material.dispose();
});
