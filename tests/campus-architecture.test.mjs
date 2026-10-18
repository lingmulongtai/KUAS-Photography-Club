import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CampusBuilder, campusArchitecture, CAMPUS_TREES } from '../src/scripts/hero/campus-architecture.ts';

const builder=new CampusBuilder(32.5);
const geometry=campusArchitecture(32.5);
const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
function ray(a,b) {
  const p=new THREE.Vector3(...builder.point(a)),q=new THREE.Vector3(...builder.point(b));
  return new THREE.Raycaster(p,q.clone().sub(p).normalize(),.01,p.distanceTo(q)-.01).intersectObject(mesh);
}
test('North entrance is open at ground level and its central lightwell is open to the sky',()=>{
  assert.equal(ray([8,1,-90],[8,1,-50]).length,0);
  assert.equal(ray([8,30,-70],[8,1,-70]).length,0);
  assert.ok(ray([8,3.9,-65],[8,3.9,-54]).length,'upper pedestrian bridge is present');
});
test('measured academic wings have finite unit normals and actual roof relief',()=>{
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
  for(let i=0;i<p.count;i++){
    assert.ok(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i)));
    assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
  }
  assert.ok(ray([-40,25,-68],[-40,0,-68]).length);
  assert.equal(ray([20,1,-49],[20,20,-49]).length,0,'space between the wings remains open');
  assert.ok(p.count<300000,'retain a bounded static mesh for mobile');
});
test('West courtyard has deep third-floor recesses below its upper cantilever',()=>{
  assert.equal(ray([-17,11,-35],[-14,11,-35]).length,0,'the recessed terrace is open');
  assert.ok(ray([-17,14.5,-35],[-10,14.5,-35]).length,'upper floor projects over the recess');
  assert.ok(ray([-9.6,20,-25],[-9.6,0,-25]).length,'external stair treads are physical surfaces');
  assert.ok(ray([-14,10,-20],[-14,0,-20]).length,'amphitheatre has timber seating tiers');
});
test('both third-floor links have an open undercroft and a supported glazed deck',()=>{
  for(const [u,v,y] of [[42,-47.25,8],[-28,-48,8.5]]){
    assert.equal(ray([u-6,2,v],[u+6,2,v]).length,0,'never fill beneath a bridge');
    assert.ok(ray([u,7,v],[u,14,v]).length,'deck and canopy span the real gap');
    assert.ok(ray([u-5,y+1.5,v],[u+5,y+1.5,v]).length,'glazed sides are present');
  }
});
test('South wings connect below the stairs and only the residence has eight storeys',()=>{
  assert.ok(ray([4,2,80],[4,2,30]).length,'the south elevation closes the central gap');
  assert.equal(ray([30,26,45],[30,26,70]).length,0,'academic wing roof is below the residence');
  assert.ok(ray([-25,30,68],[-25,20,68]).length,'south-west residence rises above the academic roof');
  assert.ok(ray([30,4.3,21],[30,4.3,29]).length,'first stepped terrace is present');
});
test('South stairs retain 1F-to-2F, reverse at 2F-to-3F, and end at the 4F room',()=>{
  const top=(u,v,from=32)=>ray([u,from,v],[u,-1,v])[0].point.y-32.5;
  for(let i=0;i<27;i++) {
    const v=22+(i+.5)*9.5/27;
    // The upper return flight overlaps part of this flight in plan; cast below it.
    assert.ok(Math.abs(top(0,v,6)-(i+1)*4.4/27)<.001,'preserve every accepted first-flight tread');
  }
  for(const u of [-6.5,4.5]) {
    const near=top(u,32.8,8),north=top(u,29.2,8);
    assert.ok(north>near&&north>6,'the two side flights rise northward');
  }
  assert.ok(Math.abs(top(0,27.5)-6.6)<.001,'half-floor landing joins both sides');
  assert.ok(top(0,33)>top(0,30),'central return rises southward');
  assert.ok(Math.abs(top(0,34.8)-8.8)<.001,'third-floor landing');
  assert.ok(Math.abs(top(0,46.5)-13.2)<.001,'fourth-floor landing');
  assert.ok(ray([0,14.5,46],[0,14.5,50]).length===0,'central doorway opens into the fourth-floor room');
  assert.ok(Math.abs(top(0,60)-17.65)<.001,'the room roof is a lower artificial-turf court');
  assert.equal(ray([0,19,50],[0,19,70]).length,0,'no extra flight continues to the fifth floor');
});

test('campus planting stays clear of the academic facades and stair flights',()=>{
  for(const [u,v] of CAMPUS_TREES)assert.equal(ray([u,2,v],[u,7,v]).length,0,`tree at ${u},${v} intersects the architecture`);
});

test('Future Center is a low irregular building at the west gate',()=>{
  const roof=ray([-96,15,-74],[-96,0,-74])[0];
  assert.ok(roof&&Math.abs(roof.point.y-32.5-5.45)<.001);
  assert.equal(ray([-96,8,-74],[-96,6,-74]).length,0,'no invented upper storey');
  assert.ok(geometry.userData.parts.some(p=>p.name==='future-center-west-gate'));
});
test('courtyard walls and stair risers face the viewer with normal back-face culling',()=>{
  const saved=mesh.material.side;mesh.material.side=THREE.FrontSide;
  assert.ok(ray([0,11,-35],[-25,11,-35]).length,'West glass faces the courtyard');
  assert.ok(ray([0,.08,21],[0,.08,22.3]).length,'first stair riser faces north');
  assert.ok(ray([4,1.4,25],[2,1.4,25]).length,'stair flight side faces east');
  mesh.material.side=saved;
});
test('connecting passages have actual door openings and the West exterior stair joins its deck',()=>{
  for(const [a,c] of [
    [[42,9.5,-54],[42,9.5,-58]],[[42,9.5,-40],[42,9.5,-37]],
    [[-21,9.5,-54],[-21,9.5,-58]],
    [[-33.88,10.5,-41.28],[-35.56,10.5,-39.36]],
  ])assert.equal(ray(a,c).length,0,'doorways must not contain window glass or mullions');
  for(const u of [-15,-13,-11,-9.6]) {
    const hit=ray([u,3,-37],[u,0,-37])[0];
    assert.ok(hit&&Math.abs(hit.point.y-32.5-1.5)<.001,'stair foot and timber deck form a continuous landing');
  }
});
