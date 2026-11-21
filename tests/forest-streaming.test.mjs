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

test('off-spot planting follows local tree cover even without a photograph and keeps infrastructure open',()=>{
  const hf={height:()=>120}, eye={x:-26062,z:-7145};
  const cover=(x,z)=>Math.abs(x-eye.x)<350 && Math.abs(z-eye.z)<350 ? (x<eye.x?1:.25) : 0;
  const forest=createForest({},hf,1,[],cover,(_x,z)=>Math.abs(z-eye.z)<10);
  forest.plant(eye,0);
  const counts=[0,0];
  for(const mesh of forest.group.children) {
    const positions=mesh.geometry.getAttribute('iPos');
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i),z=positions.getZ(i);
      assert.ok(cover(x,z)>0 && Math.abs(z-eye.z)>=10);
      counts[Number(x>=eye.x)]++;
    }
  }
  assert.ok(counts[0]>1000 && counts[1]>150 && counts[1]<counts[0]*.35, `dense and open stands: ${counts}`);
});

test('incremental forest matches synchronous trees and leaves the old forest visible until ready',async()=>{
  const original=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(32*32*4).map((_,i)=>[34,85,30,255][i%4])})};}})};
  try {
    const hf={height:(x,z)=>x*.001+z*.002,normal:(_x,_z,_s,out)=>Object.assign(out,{x:0,y:1,z:0})};
    const make=()=>createForest({},hf,.55,[{photo:{width:32,height:32},box:[-20000,-20000,20000,20000]}],()=>1);
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
    let disposed=0;
    for(const mesh of current)mesh.geometry.addEventListener('dispose',()=>disposed++);
    const maskChange=asyncForest.refreshExclusions();
    assert.deepEqual(asyncForest.group.children,current);
    assert.equal(disposed,0,'visible trees survive an infrastructure mask refresh');
    const newer=asyncForest.refreshExclusions();
    await Promise.all([maskChange,newer]);
    assert.equal(disposed,current.length,'old trees are disposed only after the latest replacement');
    assert.notDeepEqual(asyncForest.group.children,current);
  } finally {globalThis.document=original;}
});
