import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';

const code=buildSync({entryPoints:['src/scripts/kansai/city-footprint.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const mod={exports:{}};
new Function('module','exports',code)(mod,mod.exports);
const {cityFootprint,facadeKind}=mod.exports;
const at=([x,z])=>[135.2+x/91284.17129262601,34.69-z/110940.6404266756];
test('a Kobe house retains the measured ridge, eaves and orientation on the Kyoto box model',()=>{
  const ring=[[-10,-5],[10,-5],[10,5],[-10,5]].map(at);
  const kind=facadeKind(false,200,7),roof={type:1,rh:3};
  const b=cityFootprint(ring,5.5,30,kind,roof,-Math.PI/2);
  assert.equal(kind,4);
  assert.ok(Math.abs(b.angle+Math.PI/2)<1e-6);
  assert.ok(Math.abs(b.w-10)<.01 && Math.abs(b.d-20)<.01);
  assert.equal(b.ground+b.h+b.roof.rh*.5,37);
  assert.equal(b.ground+b.h-b.roof.rh*.5,34);
});
test('concave Kobe office footprints stay polygons on the Kyoto renderer',()=>{
  const ring=[[0,0],[28,0],[28,8],[9,8],[9,24],[0,24]].map(at);
  const b=cityFootprint(ring,24,8,facadeKind(true,368,24));
  assert.equal(b.ring.length,12);
  assert.equal(b.h,24);assert.equal(b.kind,1);
});
