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

test('individual track axes replace the generic surface while keeping the passenger service',()=>{
  const route={id:'hankyu-kyoto',states:[0],tracks:[2],points:[[0,0],[120,0]],stations:[],
    color:'#702c31',cars:4,carLength:19};
  const axes=[-2,2].map(z=>({kind:1,attr:8|16,pts:Float32Array.of(0,z,120,z)}));
  const render=(routes,network,box)=>mod.exports.buildRailways({},()=>0,routes,false,network,box).group;
  const surveyed=render([route],axes,[-10,-10,130,10]),onlyAxes=render([],axes);
  assert.equal(surveyed.children[0].geometry.getAttribute('position').count,onlyAxes.children[0].geometry.getAttribute('position').count);
  assert.ok(Math.abs(surveyed.children[0].geometry.getAttribute('aGauge').getX(0)-1.435)<.001);
  assert.ok(surveyed.children[2].geometry.instanceCount>0);
  assert.ok(render([{...route,states:[1]}],axes,[-10,-10,130,10]).children[0].geometry.getAttribute('position').count
    >onlyAxes.children[0].geometry.getAttribute('position').count);
});

test('framed viaducts share the train grade and honour the mapped clear sites for supports',()=>{
  const route={id:'jr-yamashina',states:[1,1,1,1],tracks:[2,2,2,2],
    points:[[0,0],[30,0],[60,0],[90,0],[120,0]],stations:[],color:'#8c9eae',cars:4,carLength:20,
    viaduct:{start:0,end:4,width:8.4,piers:[[30,-2.6,2.6],[90,-2.6]]}};
  const {group}=mod.exports.buildRailways({},()=>50,[route]);
  const [track,structure]=group.children;
  const positions=structure.geometry.getAttribute('position'),top=track.geometry.getAttribute('position').getY(0);
  const vertices=Array.from({length:positions.count},(_,i)=>[positions.getX(i),positions.getY(i),positions.getZ(i)]);
  assert.ok(vertices.some(([,y,z])=>Math.abs(z-4.2)<.01&&Math.abs(y-(top-.1))<.01),'deck spans both tracks');
  const feet=vertices.filter(([,y])=>y<50);
  for(const [x,z] of [[30,-2.6],[30,2.6],[90,-2.6]]){
    assert.ok(feet.some(([a,,b])=>Math.abs(a-x)<.6&&Math.abs(b-z)<.6));
  }
  assert.ok(!feet.some(([x,,z])=>x>80&&z>0),'leave the carriageway beneath the cantilever clear');
  assert.ok(!feet.some(([x])=>Math.abs(x-60)<2),'no generic centre pier on the framed span');
});
