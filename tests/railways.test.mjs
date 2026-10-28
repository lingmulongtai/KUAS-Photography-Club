import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {railwayPath,trainProgress,trainSections,sectionTrainProgress} from '../src/scripts/hero/railway-path.ts';

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

test('long routes have multiple complete consists in separate non-overlapping sections',()=>{
  for(const length of [2600,7200,12000,34000]){
    const span=84,count=trainSections(length,span),section=length/count;
    assert.ok(count>=1&&count<=8);
    if(length>=6000)assert.ok(count>=2);
    for(let t=0;t<900;t+=7)for(let i=0;i<count;i++){
      const p=sectionTrainProgress(t+i*43,length,span,20,i,count);
      assert.ok(p.distance-span/2>=i*section+1.999);
      assert.ok(p.distance+span/2<=(i+1)*section-1.999);
    }
  }
});

test('a full consist stops and reverses without its centre jumping or its cars leaving the route',()=>{
  const length=3000,span=84,speed=20;let previous=trainProgress(0,length,span,speed);
  for(let t=.25;t<650;t+=.25){const p=trainProgress(t,length,span,speed);
    assert.ok(Math.abs(p.distance-previous.distance)<=speed*.25+.00001);
    assert.ok(p.distance-span/2>=0&&p.distance+span/2<=length);previous=p;
  }
  const travel=(length-span-4)/speed;assert.equal(trainProgress(travel+6,length,span,speed).distance,length-span/2-2);
});
