import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';

const bundle=buildSync({entryPoints:['src/scripts/hero/railways.ts'],bundle:true,packages:'external',platform:'node',format:'cjs',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);

test('surface sidings follow the terrain in the shared track mesh without spawning any trains',()=>{
  const line=(kind,attr)=>({kind,attr,pts:Float32Array.of(0,0,24,0,24,12)});
  const {group}=mod.exports.buildRailways({},x=>x/4,[],false,[line(1,4),line(1,5),line(0,4),line(1,2)]);
  const [rails,,trains]=group.children;
  const p=rails.geometry.getAttribute('position'),gauge=rails.geometry.getAttribute('aGauge');
  assert.equal(p.count,18);
  assert.equal(trains.geometry.instanceCount,0);
  for(let i=0;i<p.count;i++)assert.ok(Math.abs(gauge.getX(i)-1.067)<.001);
  for(const x of [0,12,24])assert.ok(Array.from({length:p.count},(_,i)=>i)
    .some(i=>p.getX(i)===x&&Math.abs(p.getY(i)-(x/4+.24))<.001));
});
