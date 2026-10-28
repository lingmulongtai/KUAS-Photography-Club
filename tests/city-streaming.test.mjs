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

test('incremental regional city matches synchronous geometry and releases cancelled work',async()=>{
  const data={boxes:Array.from({length:4000},(_,i)=>({x:(i%100)*18,z:Math.floor(i/100)*20,w:10,d:8,h:6+i%5,angle:0,ground:0,kind:0})),
    polys:Array.from({length:20},(_,i)=>({ring:new Float32Array([i*30,1000,i*30+12,1000,i*30+12,1012,i*30,1012]),h:12,ground:0,kind:1}))};
  const hf={height:()=>10},sync=buildCity({},hf,data,()=>true,.55),slow=await buildCityAsync({},hf,data,()=>true,.55,()=>true);
  assert.ok(slow);assert.equal(slow.group.children.length,sync.group.children.length);
  for(let i=0;i<sync.group.children.length;i++){
    const a=sync.group.children[i].geometry,b=slow.group.children[i].geometry;
    assert.equal(a.instanceCount,b.instanceCount);
    for(const name of Object.keys(a.attributes))assert.deepEqual(b.getAttribute(name).array,a.getAttribute(name).array);
  }
  let current=true,disposed=0;const dispose=THREE.Material.prototype.dispose;
  THREE.Material.prototype.dispose=function(){disposed++;return dispose.call(this);};
  try {const pending=buildCityAsync({},hf,data,()=>true,.55,()=>current);current=false;
    assert.equal(await pending,null);assert.ok(disposed>0,'abandoned preparation releases materials');
  } finally {THREE.Material.prototype.dispose=dispose;}
});
