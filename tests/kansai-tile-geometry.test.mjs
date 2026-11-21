import test from 'node:test';
import assert from 'node:assert/strict';
import {combineTileMeshes} from '../src/scripts/kansai/tile-geometry.ts';

function triangle(id,offset){
  return {id,positions:new Float64Array([offset,.21,-5,offset+1,0,5,offset,.5,4]),
    normals:new Float32Array(9).fill(.125),colors:new Uint8Array(12).fill(128),uv:new Float32Array(6).fill(.75)};
}
test('one upload preserves tile coordinates, materials and independent survey substitutions',()=>{
  const source=[triangle('0',-325),triangle('1',43),triangle(undefined,312)];
  const mesh=combineTileMeshes(source);
  assert.ok(mesh.positions instanceof Float32Array);
  assert.deepEqual([...mesh.ids],[1,1,1,2,2,2,0,0,0]);
  for(const key of ['positions','uv','colors','normals']){
    const expected=source.flatMap(part=>[...part[key]]);
    assert.deepEqual([...mesh[key]],key==='positions'?expected.map(Math.fround):expected);
  }
  for(let i=0;i<mesh.positions.length;i+=3){
    assert.ok(Math.hypot(...mesh.center.map((c,axis)=>c-mesh.positions[i+axis]))<=mesh.radius);
  }
  assert.equal(combineTileMeshes([]),undefined);
});
test('a feature exceeding the local encoding range retains its double position',()=>{
  const original=triangle('0',-65536.12345),mesh=combineTileMeshes([original]);
  assert.ok(mesh.positions instanceof Float64Array);
  assert.deepEqual(mesh.positions,original.positions);
});
