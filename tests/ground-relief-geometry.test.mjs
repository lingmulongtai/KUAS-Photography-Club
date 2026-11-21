import test from 'node:test';
import assert from 'node:assert/strict';
import {BANK,FIELD, PADDY} from '../src/scripts/hero/ground-relief-data.ts';
import {addBank,addField,GroundGeometry,SURFACE} from '../src/scripts/hero/ground-relief-geometry.ts';

const outer=new Float32Array([0,0,80,0,80,36,0,36]);
const hole=new Float32Array([30,10,30,26,50,26,50,10]);
const ground = (x,z) => .07*x+.015*z;
const vertices = geometry => Array.from({length:geometry.positions.length/3},(_,i)=>({
  x:geometry.positions[i*3],y:geometry.positions[i*3+1],z:geometry.positions[i*3+2],kind:geometry.surface[i*4]
}));

test('the beds and raised paddy bund follow the local elevation', () => {
  const data=new GroundGeometry();
  addField(data,{kind:PADDY,paths:[outer,hole]},ground,false);
  const points=vertices(data);
  assert.ok(points.filter(p=>p.kind===SURFACE.bund).some(p=>Math.abs(p.y-ground(p.x,p.z)-.72)<1e-6));
  assert.ok(points.filter(p=>p.kind===SURFACE.paddy).every(p=>Math.abs(p.y-ground(p.x,p.z)-.19)<1e-6));
  let squareMetres=0;
  for (let i=0;i<data.indices.length;i+=3) {
    const [a,b,c]=data.indices.slice(i,i+3).map(j=>points[j]);
    if(a.kind===SURFACE.paddy) squareMetres+=Math.abs((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))/2;
  }
  assert.equal(squareMetres,80*36-20*16);
});

test('nearby furrows stop at the headlands and on each side of an interior hole', () => {
  const data=new GroundGeometry();
  addField(data,{kind:FIELD,paths:[outer,hole]},ground,true);
  const points=vertices(data);
  assert.ok(points.length>0);
  assert.ok(points.every(p=>p.kind===SURFACE.ridge && p.x>=1 && p.x<=79 && p.z>=0 && p.z<=36));
  for (let i=0;i<data.indices.length;i+=3) {
    const tri=data.indices.slice(i,i+3).map(j=>points[j]);
    const x=tri.reduce((s,p)=>s+p.x,0)/3, z=tri.reduce((s,p)=>s+p.z,0)/3;
    assert.ok(!(x>30 && x<50 && z>10.7 && z<25.3),'row crossed a hole');
  }
});

test('close rice plants have a raised crest and an along-row coordinate for individual clumps',()=>{
  const data=new GroundGeometry();
  addField(data,{kind:PADDY,paths:[outer,hole]},ground,true);
  const points=vertices(data);
  assert.ok(points.length>0 && points.every(p=>p.kind===SURFACE.rice));
  assert.ok(points.some(p=>Math.abs(p.y-ground(p.x,p.z)-.53)<1e-6));
  assert.ok(new Set(data.surface.filter((_,i)=>i%4===3)).size>5);
});

test('stepped shores face land and cover the same cross-section at a map subdivision', () => {
  const make=coords=>{
    const data=new GroundGeometry();
    addBank(data,{kind:BANK,paths:[new Float32Array(coords)]},ground);
    return vertices(data);
  };
  const left=make([0,0,16,0,32,0]),right=make([32,0,52,0]);
  const joint=points=>points.filter(p=>p.x===32).map(p=>[p.z,p.y]).sort();
  assert.deepEqual(joint(left),joint(right));
  assert.ok(left.filter(p=>p.kind===SURFACE.grassBank).every(p=>p.z<0));
  assert.ok(left.some(p=>p.kind===SURFACE.gravel && p.z>0 && p.y<ground(p.x,p.z)));
});

test('insets on opposite sides of a narrow river headland leave room for land between them', () => {
  const data=new GroundGeometry();
  addBank(data,{kind:BANK,paths:[new Float32Array([3,9,3,0,0,0,0,9])]},()=>0);
  const ends=vertices(data).filter(p=>p.kind===SURFACE.grassBank && p.z===9);
  assert.equal(ends.length,8);
  assert.ok(ends.slice(0,4).every(p=>p.x>1.5 && p.x<3));
  assert.ok(ends.slice(4).every(p=>p.x<1.5 && p.x>0));
});
