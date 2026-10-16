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
test('South academic wings leave the central stair slot open and only the residence has eight storeys',()=>{
  assert.equal(ray([4,2,24],[4,2,70]).length,0,'ground-floor passage beside the stairs stays open');
  assert.equal(ray([30,26,45],[30,26,70]).length,0,'academic wing roof is below the residence');
  assert.ok(ray([-25,30,68],[-25,20,68]).length,'south-west residence rises above the academic roof');
  assert.ok(ray([30,4.3,21],[30,4.3,29]).length,'first stepped terrace is present');
});
test('South grand staircase rises through four flights with flat, traversable cross-landings',()=>{
  const heights=[];
  for(let f=0;f<4;f++) {
    let previous=f*4.4;
    for(let i=0;i<27;i++) {
      const v=22+f*11.7+(i+.5)*9.5/27;
      const hit=ray([0,30,v],[0,-1,v])[0];
      assert.ok(hit,'every tread is modeled');
      const height=hit.point.y-32.5;
      assert.ok(Math.abs(height-(f*4.4+(i+1)*4.4/27))<.001);
      assert.ok(height>previous);previous=height;
    }
    const v=22+f*11.7+10.5;
    const level=ray([0,30,v],[0,-1,v])[0].point.y-32.5;
    heights.push(level);
    assert.equal(ray([-4,level+.6,v],[2,level+.6,v]).length,0,'no handrail or slab blocks the landing');
  }
  assert.deepEqual(heights.map(y=>Math.round(y*10)/10),[4.4,8.8,13.2,17.6]);
});
test('campus planting stays clear of the academic facades and stair flights',()=>{
  for(const [u,v] of CAMPUS_TREES)assert.equal(ray([u,2,v],[u,7,v]).length,0,`tree at ${u},${v} intersects the architecture`);
});
test('courtyard walls and stair risers face the viewer with normal back-face culling',()=>{
  const saved=mesh.material.side;mesh.material.side=THREE.FrontSide;
  assert.ok(ray([0,11,-35],[-25,11,-35]).length,'West glass faces the courtyard');
  assert.ok(ray([0,.08,21],[0,.08,22.3]).length,'first stair riser faces north');
  assert.ok(ray([4,1.4,25],[2,1.4,25]).length,'stair flight side faces east');
  mesh.material.side=saved;
});
