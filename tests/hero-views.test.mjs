import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PerspectiveCamera, Vector3} from 'three';
import { VIEWS, PANORAMA_VIEWS, flightLift, openingPanorama, spotDestination, viewBelowClouds } from '../src/scripts/hero/views.ts';
import { SPOTS } from '../src/data/spots.ts';
import { toLocal } from '../src/scripts/hero/geo.ts';
import { landmarkOrbit } from '../src/scripts/hero/landmark-orbit.ts';
import {loadHeightfield} from '../src/scripts/hero/heightfield.ts';
import {LOWEST_CLOUD_BASE} from '../src/scripts/hero/cloud-weather.ts';

test('landmark destinations keep their named model centred through full turns', () => {
  for (const id of ['tower', 'kinkaku']) {
    const view=VIEWS[id], spot=SPOTS.find(s=>s.id===id);
    assert.deepEqual(view.orbit.center,toLocal(spot.lat,spot.lon));
    const eye={...view.eye,y:40+view.above};
    const start=landmarkOrbit(view.orbit,eye,0,0,()=>40);
    for (const yaw of [-360,90,180,360,720]) {
      const pose=landmarkOrbit(view.orbit,eye,yaw,0,()=>40);
      assert.deepEqual(pose.target,start.target);
      assert.ok(Object.values(pose.pos).every(Number.isFinite));
    }
  }
});

test('panoramas turn at a fixed observation point', () => {
  for (const id of PANORAMA_VIEWS) {
    assert.equal(VIEWS[id].orbit,undefined);
    assert.ok(VIEWS[id].above>0);
  }
  assert.equal('funaoka' in VIEWS,false);
});

test('openings draw uniformly from clear locations and skip the previous location on reload',()=>{
  const terrain=(x,z)=>x===VIEWS.atago.ref.x && z===VIEWS.atago.ref.z?920:80;
  const groups=[['shogunzuka'],['inariRidge'],['daimonji'],['arashiyama'],['atago'],['kameokaTerrace'],['tennozan']];
  for(const previous of [null,...PANORAMA_VIEWS]){
    const choices=groups.filter(group=>!group.includes(previous));
    choices.forEach((group,i)=>group.forEach((view,j)=>{
      const samples=[(i+.5)/choices.length,(j+.5)/group.length];
      assert.equal(openingPanorama(terrain,1500,previous,null,()=>samples.shift()),view);
    }));
  }
  assert.equal(openingPanorama(terrain,850,'inariRidge','inariRidge',()=>0),'inariRidge');
  for(const requested of ['atago','inari','invalid']){
    for(let i=0;i<24;i++)assert.notEqual(openingPanorama(terrain,850,null,requested,()=>i/24),'atago');
  }
});

test('flights between viewpoints below the clouds stay below the deck for their entire curve',()=>{
  for(const [from,to] of [[240,760],[760,240],[740,760],[760,840]]) {
    const lift=flightLift(from,to,20000,850), cap=Math.max(770,from,to);
    assert.ok(from*.7+to*.3+lift<=cap);
    assert.ok(from*.25+to*.75+lift*.7<=cap);
  }
  assert.equal(flightLift(120,250,1000,1350),220);
});

async function surveyedTerrain(t) {
  const root=new URL('../public/kyoto/',import.meta.url);
  const meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const original=globalThis.fetch;
  globalThis.fetch=async url=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});
  return loadHeightfield(meta);
}

test('the Yamashina-side panorama frames Inari on the left and clears the lowest cloud deck',async t=>{
  const hf=await surveyedTerrain(t);
  const view=VIEWS.inariRidge;
  assert.ok(PANORAMA_VIEWS.includes('inariRidge'));
  assert.equal(spotDestination('inari'),'inari');
  const height=hf.height(view.eye.x,view.eye.z)+view.above;
  assert.ok(height>680 && height+80<LOWEST_CLOUD_BASE);
  assert.ok(view.pitch<0 && view.pitch>-12);
  for(const [id,min,max] of [['inari',-34,-14],['kuas',-14,2],['gosho',0,29]]){
    const spot=SPOTS.find(s=>s.id===id),p=toLocal(spot.lat,spot.lon);
    const bearing=Math.atan2(p.x-view.eye.x,view.eye.z-p.z)*180/Math.PI;
    const offset=(bearing-view.bearing+540)%360-180;
    assert.ok(offset>min && offset<max,`${id} at ${offset} degrees`);
    for(let f=.04;f<1;f+=.04) {
      const target=hf.height(p.x,p.z)+spot.above;
      assert.ok(hf.height(view.eye.x+(p.x-view.eye.x)*f,view.eye.z+(p.z-view.eye.z)*f)<height+(target-height)*f,'clear view of '+id);
    }
  }
});

function panoramaCamera(view, eyeHeight) {
  const camera=new PerspectiveCamera(39.58,2000/1067,20,60000);
  camera.position.set(view.eye.x,eyeHeight,view.eye.z);
  const rad=Math.PI/180, yaw=view.bearing*rad, pitch=view.pitch*rad;
  camera.lookAt(camera.position.clone().add(new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch))));
  camera.updateMatrixWorld();
  return camera;
}

function checkPins(camera,terrain,anchors) {
  for(const [id,x,y] of anchors){
    const pin=SPOTS.find(s=>s.id===id), p=toLocal(pin.lat,pin.lon);
    const ndc=new Vector3(p.x,terrain(p.x,p.z)+pin.above,p.z).project(camera);
    assert.ok(Math.abs((ndc.x+1)/2-x)<.02 && Math.abs((1-ndc.y)/2-y)<.02,id);
  }
}

test('Tennozan and Atago frame opposite sides of Kyoto and clear winter clouds', async t => {
  const hf=await surveyedTerrain(t), terrain=(x,z)=>hf.height(x,z);
  assert.equal(PANORAMA_VIEWS.length,7);
  assert.equal(openingPanorama(()=>10,850,null,'osakaSkyline'),'tennozan');
  for(const [id,anchors] of [
    ['tennozan',[['kuas',.40,.37],['nijo',.51,.37],['tower',.62,.37],['inari',.75,.39]]],
    ['atago',[['daimonji',.18,.43],['yamashina',.33,.44],['toji',.58,.47],['arashiyama',.88,.64]]],
  ]){
    const view=VIEWS[id], ground=terrain(view.ref.x,view.ref.z);
    checkPins(panoramaCamera(view,ground+view.above),terrain,anchors);
    const winter=viewBelowClouds(id,ground,LOWEST_CLOUD_BASE);
    assert.equal(winter.eye,view.eye);
    assert.ok(winter.above>=80 && ground+winter.above<=LOWEST_CLOUD_BASE-80);
    assert.equal(openingPanorama(terrain,LOWEST_CLOUD_BASE,null,id),id);
  }
});

test('every map spot has a camera destination and landmarks stay centred', () => {
  for (const spot of SPOTS) {
    const id=spotDestination(spot.id);
    if (spot.id==='kuas') { assert.equal(id,'campus'); continue; }
    const view=VIEWS[id];
    assert.ok(view,`Missing camera for ${spot.id}`);
    if (spot.id==='atago') { assert.equal(id,'atago'); continue; }
    assert.ok(view.orbit,`Map destination must orbit ${spot.id}`);
    // Kiyomizu's pin is its pagoda, while its existing camera frames the main stage.
    if (spot.id!=='kiyomizu') assert.deepEqual(view.orbit.center,toLocal(spot.lat,spot.lon));
    const eye={...view.eye,y:40+view.above};
    for (const yaw of [0,90,180,270,360]) {
      const pose=landmarkOrbit(view.orbit,eye,yaw,0,()=>40);
      assert.deepEqual(pose.target,{...view.orbit.center,y:40+view.orbit.targetHeight});
      assert.ok(pose.pos.y>pose.target.y);
    }
  }
  assert.equal(spotDestination('arashiyama'),'togetsukyo');
  assert.equal(VIEWS.arashiyama.orbit,undefined);
});

test('Daimonji frames the firebed below the western skyline and stays clear of low snow clouds',async t=>{
  const hf=await surveyedTerrain(t);
  const panorama=VIEWS.daimonji, spot=VIEWS[spotDestination('daimonji')];
  assert.equal(panorama.orbit,undefined);
  assert.deepEqual(spot.orbit.center,toLocal(35.0230738,135.804312));
  assert.ok(spot.eye.x<spot.orbit.center.x-300,'view the west-facing 大 from downslope');
  const terrain=(x,z)=>hf.height(x,z);
  const ground=terrain(panorama.ref.x,panorama.ref.z);
  const anchors=[['daimonji',.61,.92],['kiyomizu',.17,.60],['kuas',.61,.45],['atago',.96,.31]];
  for(const base of [1500,LOWEST_CLOUD_BASE]){
    const view=viewBelowClouds('daimonji',ground,base);
    const eyeHeight=ground+view.above;
    assert.ok(eyeHeight+80<=base && eyeHeight>terrain(view.eye.x,view.eye.z)+80);
    assert.equal(openingPanorama(terrain,base,null,'daimonji'),'daimonji');
    checkPins(panoramaCamera(view,eyeHeight),terrain,base===1500?anchors:anchors.slice(0,1));
  }
});
