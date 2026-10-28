import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {railwayPath,trainSections,serviceTrainProgress} from '../src/scripts/hero/railway-path.ts';

test('the source routes include the Shinkansen, stay continuous and retain hidden tunnel segments',async()=>{
  const data=JSON.parse(gunzipSync(await readFile(new URL('../public/kyoto/railways.json.gz',import.meta.url))));
  assert.equal(data.routes.length,8);let stations=0,tunnels=0;
  const shinkansen=data.routes.find(r=>r.id==='jr-shinkansen');
  assert.ok(shinkansen);assert.equal(shinkansen.cars,8);assert.ok(shinkansen.states.includes(2));
  assert.ok(shinkansen.stations.length>=1);
  for(const route of data.routes){
    assert.equal(route.states.length,route.points.length-1);assert.equal(route.tracks.length,route.states.length);
    const p=railwayPath(route,()=>50);assert.ok(p.length>2500&&p.length<42000,route.id);
    for(let i=0;i<route.points.length-1;i++){
      const a=route.points[i],b=route.points[i+1];assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<14,'no invented bridge across missing source tiles');
      assert.ok(route.states[i]>=0&&route.states[i]<=3);if(route.states[i]>1){assert.equal(p.at((p.distances[i]+p.distances[i+1])/2).visible,false);tunnels++;}
    }
    for(const s of route.stations){assert.ok(s.distance>=0&&s.distance<=p.length);assert.equal(p.at(s.distance).visible,true);stations++;}
  }
  assert.ok(stations>40);assert.ok(tunnels>100);
});

test('long routes have spaced consists travelling through the whole route',()=>{
  for(const length of [2600,7200,12000,34000]){
    const span=84,count=trainSections(length,span);
    assert.ok(count>=1&&count<=8);
    if(length>=6000)assert.ok(count>=2);
    for(let t=0;t<900;t+=7){
      const trains=Array.from({length:count},(_,i)=>serviceTrainProgress(t,length,span,20,i,count,1));
      for(const p of trains){assert.ok(p.distance-span/2>=1.999);assert.ok(p.distance+span/2<=length-1.999);}
      const visible=trains.filter(p=>p.visible).sort((a,b)=>a.distance-b.distance);
      for(let i=1;i<visible.length;i++)assert.ok(visible[i].distance-visible[i-1].distance>span);
    }
    const first=serviceTrainProgress(0,length,span,20,0,1,1),later=serviceTrainProgress(30,length,span,20,0,1,1);
    assert.equal(later.distance-first.distance,600,'no mid-route reversal');
    assert.equal(first.visible,false,'reset happens outside the visible portion');
  }
});

test('a visible consist advances continuously in either direction',()=>{
  for(const dir of [-1,1]){
    let previous=serviceTrainProgress(0,3000,84,20,0,1,dir);
    for(let t=.25;t<650;t+=.25){const p=serviceTrainProgress(t,3000,84,20,0,1,dir);
      if(previous.visible&&p.visible)assert.ok(Math.abs(p.distance-previous.distance)<=5.00001);
      assert.ok(p.distance-42>=0&&p.distance+42<=3000);previous=p;
    }
  }
});
