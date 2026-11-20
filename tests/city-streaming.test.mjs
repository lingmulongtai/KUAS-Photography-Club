import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import * as THREE from 'three';

const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {buildCity,buildCityAsync} from './src/scripts/hero/buildings.ts';"},
  bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
const module={exports:{}},require=createRequire(import.meta.url);
new Function('require','module','exports',compiled)(id=>id==='three'?THREE:require(id),module,module.exports);
const {buildCity,buildCityAsync}=module.exports;

test('the Shogunzuka overview only replaces distant camera surfaces and retains the shadow casters', async () => {
  const eye = {x: 2429, y: 230, z: 160};
  const data = {boxes: [
    {x: -3400, z: 100, w: 12, d: 8, h: 9, angle: .3, ground: 0, kind: 0},
    {x: -3380, z: 100, w: 14, d: 8, h: 18, angle: .2, ground: 0, kind: 1},
    {x: 2500, z: 50, w: 12, d: 7, h: 6, angle: 0, ground: 0, kind: 0},
  ], polys: []};
  const hf = {height: () => 50};
  const city = await buildCityAsync({}, hf, data, () => true, 1, () => true, () => false, eye);
  const [block] = city.overview.children;
  assert.equal(city.overview.children.length, 1);
  assert.equal(block.visible, false);
  assert.deepEqual(block.children.map(mesh => mesh.geometry.getAttribute('position').count / 3), [6, 10]);
  for (const mesh of city.group.children) mesh.layers.enable(1);
  city.updateLod(eye, 800);
  assert.ok(block.visible);
  const distant = city.group.children.filter(mesh => mesh.geometry.boundingSphere.center.x < 0);
  assert.ok(distant.every(mesh => !mesh.layers.isEnabled(0) && mesh.layers.isEnabled(1)));
  assert.ok(block.children.every(mesh => mesh.layers.isEnabled(0) && !mesh.layers.isEnabled(1)));
  assert.ok(city.group.children.filter(mesh => !distant.includes(mesh)).every(mesh => mesh.layers.isEnabled(0)));
  for (const scale of [9000, 0]) {
    city.updateLod(eye, scale);
    assert.equal(block.visible, false);
    assert.ok(distant.every(mesh => mesh.layers.isEnabled(0)));
    city.updateLod(eye, 800);
  }
  assert.equal(buildCity({}, hf, data).overview, null);
});

// Compare raw bytes: deepEqual walks large typed arrays element by element and exhausts memory on small runners.
const same=(a,b)=>assert.ok(a.length===b.length&&Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength)),'geometry attributes match');

test('incremental regional city matches synchronous geometry and releases cancelled work',async()=>{
  const data={boxes:Array.from({length:4000},(_,i)=>({x:(i%100)*18,z:Math.floor(i/100)*20,w:10,d:8,h:6+i%5,angle:0,ground:0,kind:0})),
    polys:Array.from({length:20},(_,i)=>({ring:new Float32Array([i*30,1000,i*30+12,1000,i*30+12,1012,i*30,1012]),h:12,ground:0,kind:1}))};
  const hf={height:()=>10},sync=buildCity({},hf,data,()=>true,.55),slow=await buildCityAsync({},hf,data,()=>true,.55,()=>true);
  assert.ok(slow);assert.equal(slow.group.children.length,sync.group.children.length);
  for(let i=0;i<sync.group.children.length;i++){
    const a=sync.group.children[i].geometry,b=slow.group.children[i].geometry;
    assert.equal(a.instanceCount,b.instanceCount);
    for(const name of Object.keys(a.attributes))same(b.getAttribute(name).array,a.getAttribute(name).array);
  }
  // Startup retains the custom facades already supplied by the landmark models.
  const dressed=b=>b.x<180;
  const dressedSync=buildCity({},hf,data,()=>true,1,dressed);
  const dressedAsync=await buildCityAsync({},hf,data,()=>true,1,()=>true,dressed);
  assert.ok(dressedAsync);
  for(let frame=0;frame<12;frame++){
    dressedSync.updateLod({x:50,y:30,z:50});
    dressedAsync.updateLod({x:50,y:30,z:50});
  }
  assert.equal(dressedAsync.group.children.length,dressedSync.group.children.length);
  for(let i=0;i<dressedSync.group.children.length;i++){
    const a=dressedSync.group.children[i].geometry,b=dressedAsync.group.children[i].geometry;
    assert.equal(a.instanceCount,b.instanceCount);
    for(const name of Object.keys(a.attributes))same(b.getAttribute(name).array,a.getAttribute(name).array);
  }
  let calls=0,disposed=0;const dispose=THREE.Material.prototype.dispose;
  THREE.Material.prototype.dispose=function(){disposed++;return dispose.call(this);};
  try {const pending=buildCityAsync({},hf,data,()=>true,.55,()=>calls++<1);
    assert.ok((await pending)===null,'a cancelled build returns nothing');assert.ok(disposed>0,'abandoned preparation releases materials');
  } finally {THREE.Material.prototype.dispose=dispose;}
});
