import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';

const script=buildSync({entryPoints:['src/scripts/kansai/surveys.ts'],platform:'node',format:'cjs',bundle:true,write:false}).outputFiles[0].text;
function event(){
  const handlers=new Set();
  return {addEventListener(f){handlers.add(f);return ()=>handlers.delete(f);},
    fire(arg){for(const h of handlers)h(arg);}};
}
function content(bounds){
  let resident=true;
  const feature={show:true,hasProperty:()=>true,getProperty:name=>bounds[['_xmin','_ymin','_xmax','_ymax'].indexOf(name)]};
  return {ready:true,get featuresLength(){assert.ok(resident,'read geometry after eviction');return 1;},
    getFeature(){assert.ok(resident,'read feature after eviction');return feature;},evict(){resident=false;}};
}

test('a revisited PLATEAU tile can replace or unload its content between traversal and postRender',async()=>{
  const layer={kind:'bldg',pref:'26',lod:2,file:'kyoto.json'},tiles={tileVisible:event(),tileUnload:event(),tileFailed:event()};
  const postRender=event(),scene={postRender,primitives:{add(){}},requestRender(){}};
  const engine={Cesium3DTileset:{fromUrl:async()=>tiles},UniformType:{},Cartesian3:class {},TextureUniform:class {},
    CustomShader:class{setUniform(){} isDestroyed(){return false;} destroy(){}}};
  const module={exports:{}};
  runInNewContext(script,{module,exports:module.exports,window:{Cesium:engine},
    fetch:async()=>({ok:true,json:async()=>({layers:[layer]})})});
  const surveys=await module.exports.attachSurveys({scene,isDestroyed:()=>false},()=>assert.fail(),'26',
    {revision:0,rings:()=>[],contains:()=>false,dispose(){}});
  await surveys.ready;
  const tile={content:content([135.75,35,135.752,35.002])};
  tiles.tileVisible.fire(tile);postRender.fire();
  assert.equal(surveys.contains([135.751,35.001]),true);
  tiles.tileVisible.fire(tile);tiles.tileUnload.fire(tile);tile.content.evict();postRender.fire();
  assert.equal(surveys.contains([135.751,35.001]),false);
  tile.content=content([135.77,35,135.772,35.002]);tiles.tileVisible.fire(tile);postRender.fire();
  assert.equal(surveys.contains([135.771,35.001]),true);
  assert.equal(surveys.contains([135.751,35.001]),false);
  surveys.dispose();
});
