import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {refineWaterSurface} from '../src/scripts/hero/water-surface.ts';
import {applyWaterDetail,waterChecksum} from '../src/scripts/hero/water-detail.ts';

test('edge deduplication preserves the original vertices, face order and focus-dependent refinement',()=>{
  // Digests of the complete pre-optimization result, including every coordinate
  // and triangle index. Geometry, winding and boundary checks follow below.
  const cases=[
    {points:[{x:0,y:0},{x:93,y:0},{x:93,y:71},{x:0,y:71}],faces:[[0,1,2],[0,2,3]],edge:12,
      sha256:'e7bbf810f82070dc74c0718c51bd46957019e5cd080b118e09eb373e96d9dc50'},
    {points:[{x:-500,y:-300},{x:2100,y:-300},{x:2100,y:1800},{x:-500,y:1800}],faces:[[0,1,2],[0,2,3]],edge:160,focus:{x:50,y:25},
      sha256:'eca98aeb4b7a33deb6d6689f955d3a320707a926dfe54c74b4d2e3ecfc85bcca'},
    {points:[{x:5,y:7},{x:-7,y:-20},{x:88,y:60},{x:999,y:999},{x:88,y:-20},{x:-7,y:60}],faces:[[5,1,4],[5,4,2]],edge:15,
      sha256:'68974cbc1e5f383cc42d48feaa8d138f6bdcbc24ca0416029d73f1e94abc1f0b'},
  ];
  for(const c of cases) {
    const result=refineWaterSurface(c.points,c.faces,c.edge,40000,c.focus);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'),c.sha256);
  }
});

test('refinement keeps banks and an island hole while bounding every triangle edge',()=>{
  const outer=[[0,0],[80,0],[80,60],[0,60]].map(p=>new THREE.Vector2(...p));
  const hole=[[20,20],[20,40],[50,40],[50,20]].map(p=>new THREE.Vector2(...p));
  const faces=THREE.ShapeUtils.triangulateShape(outer,[hole]);
  const {points,triangles}=refineWaterSurface([...outer,...hole],faces,12);
  let area=0;
  const edges=new Map();
  for(const triangle of triangles) {
    const [a,b,c]=triangle.map(i=>points[i]);
    const signed=((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;
    assert.ok(signed>0,'winding is preserved');area+=signed;
    const x=(a.x+b.x+c.x)/3,y=(a.y+b.y+c.y)/3;
    assert.ok(!(x>20&&x<50&&y>20&&y<40),'no triangle fills the island');
    for(let k=0;k<3;k++) {
      const i=triangle[k],j=triangle[(k+1)%3],p=points[i],q=points[j];
      assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<=12+1e-8);
      const key=i<j?`${i},${j}`:`${j},${i}`;edges.set(key,(edges.get(key)??0)+1);
    }
  }
  assert.ok(Math.abs(area-4200)<1e-7);
  // Every singly used edge must belong to the original bank or island boundary.
  for(const [key,count] of edges) {
    assert.ok(count<=2);
    if(count===2) continue;
    const [p,q]=key.split(',').map(i=>points[Number(i)]);
    const on=(a,b)=>Math.abs((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))<1e-7&&
      Math.abs((b.x-a.x)*(q.y-a.y)-(b.y-a.y)*(q.x-a.x))<1e-7;
    assert.ok([outer,hole].some(r=>r.some((a,i)=>on(a,r[(i+1)%r.length]))),'no internal cracks or T junctions');
  }
  assert.throws(()=>refineWaterSurface(outer,[[0,1,2]],1,2),/budget/);
});

test('regional water replaces only matching water and retains road and rail references',()=>{
  const feature=kind=>({kind,attr:0,pts:new Float32Array([0,0,1,0,0,1])});
  const base=[feature(0),feature(1),feature(2),feature(3),feature(2)];
  const detail={baseChecksum:waterChecksum(new Uint8Array([1,2,3])),replace:[2,3],
    polygons:[{outer:[0,0,4,0,4,4,0,4],holes:[[1,1,1,2,2,2]]}]};
  const result=applyWaterDetail(base,detail,detail.baseChecksum);
  assert.deepEqual(result.slice(0,3),[base[0],base[1],base[4]]);
  assert.equal(result[0],base[0]);assert.equal(result[1],base[1]);
  assert.deepEqual(result.slice(3).map(p=>p.kind),[2,3]);
  assert.throws(()=>applyWaterDetail(base,detail,0),/match/);
  assert.throws(()=>applyWaterDetail(base,{...detail,replace:[0]},detail.baseChecksum),/non-water/);
});
