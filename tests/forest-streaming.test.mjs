import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import * as THREE from 'three';

const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {createForest} from './src/scripts/hero/trees.ts';"},
  bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
const module={exports:{}},require=createRequire(import.meta.url);
new Function('require','module','exports',compiled)(id=>id==='three'?THREE:require(id),module,module.exports);
const {createForest}=module.exports;

test('incremental forest matches synchronous trees and leaves the old forest visible until ready',async()=>{
  const original=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(32*32*4).map((_,i)=>[34,85,30,255][i%4])})};}})};
  try {
    const hf={height:(x,z)=>x*.001+z*.002,normal:(_x,_z,_s,out)=>Object.assign(out,{x:0,y:1,z:0})};
    const make=()=>createForest({},hf,{width:32,height:32},[-20000,-20000,20000,20000],.55);
    const sync=make(),asyncForest=make(),first={x:0,z:0},next={x:800,z:200};
    sync.plant(next,0);asyncForest.plant(first,0);
    const old=[...asyncForest.group.children],pending=asyncForest.plantAsync(next,0);
    assert.deepEqual(asyncForest.group.children,old,'the old forest remains displayed during preparation');
    await pending;assert.equal(asyncForest.count,sync.count);
    const attrs=forest=>forest.group.children.map(mesh=>['iPos','iSize','iTint','iShape','iSeason'].map(name=>Array.from(mesh.geometry.getAttribute(name).array)));
    assert.deepEqual(attrs(asyncForest),attrs(sync));
    const current=[...asyncForest.group.children],stale=asyncForest.plantAsync({x:1600,z:400},0);
    asyncForest.cancelPlant();await stale;
    assert.deepEqual(asyncForest.group.children,current,'cancelled work never replaces the current forest');
  } finally {globalThis.document=original;}
});
