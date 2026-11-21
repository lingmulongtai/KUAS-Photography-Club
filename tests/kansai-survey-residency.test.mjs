import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';

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
  const layer={kind:'bldg',pref:'26',lod:2,url:'kyoto.json',bounds:[135.74,34.99,135.78,35.01]};
  const tiles={tileVisible:event(),tileUnload:event(),tileFailed:event()};
  const postRender=event(),scene={postRender,primitives:{add(){}},requestRender(){}};
  const requests=new WeakSet();
  const engine={Cesium3DTileset:{fromUrl:async()=>tiles},UniformType:{},Cartesian2:class {},Cartesian3:class {},
    TextureUniform:class{constructor(options){this.url=options.url;}},
    CustomShader:class{
      constructor({uniforms}){
        for(const {value} of Object.values(uniforms))if(value.url){
          assert.equal(requests.has(value),false,'each shader must own its Cesium image request');
          requests.add(value);
        }
      }
      setUniform(){} isDestroyed(){return false;} destroy(){}
    }};
  const module={exports:{}};
  runInNewContext(script,{module,exports:module.exports,window:{Cesium:engine},
    fetch:async()=>({ok:true,json:async()=>[layer]})});
  const surveys=await module.exports.attachSurveys({scene,isDestroyed:()=>false},()=>assert.fail(),[135.75,35],
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

test('Expo uses prepared detail when supported and falls back to the official archive',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../public/kansai/surveys/regions.json',import.meta.url),'utf8'));
  const prepared=catalog.filter(layer=>layer.preparedUrl);
  assert.deepEqual(prepared.map(layer=>layer.kind).sort(),['bldg','frn']);
  for(const layer of prepared) {
    assert.match(layer.url,/^https:.*\/27999_osaka-shi_city_2025_/);
    assert.equal(layer.preparedUrl,'/kansai/expo-models/'+layer.kind+'/tileset.json');
  }
  const layer=prepared.find(l=>l.kind==='frn');
  for(const [basis,missing,expected] of [
    [true,false,[layer.preparedUrl]], [false,false,[layer.url]], [true,true,[layer.preparedUrl,layer.url]],
  ]){
    const urls=[];
    const engine={
      FeatureDetection:{supportsBasis:()=>basis},
      Cesium3DTileset:{fromUrl:async url=>{
        urls.push(url);
        if(missing&&url===layer.preparedUrl)throw Error('Prepared manifest unavailable');
        return {tileFailed:event()};
      }},
      UniformType:{},Cartesian2:class {},Cartesian3:class {},TextureUniform:class {},
      CustomShader:class {setUniform(){} isDestroyed(){return false;} destroy(){}},
    };
    const module={exports:{}},scene={postRender:event(),primitives:{add(){}},requestRender(){}};
    runInNewContext(script,{module,exports:module.exports,window:{Cesium:engine},fetch:async()=>({ok:true,json:async()=>[layer]})});
    const surveys=await module.exports.attachSurveys({scene,isDestroyed:()=>false},()=>assert.fail(),[135.384,34.65],
      {revision:0,rings:()=>[],contains:()=>false,dispose(){}});
    await surveys.ready;assert.deepEqual(urls,expected);surveys.dispose();
  }
});
