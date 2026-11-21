import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';

const table=gunzipSync(readFileSync(new URL('../public/kansai/lighting/brdf-1.133.rgba.gz',import.meta.url)));
const script=buildSync({entryPoints:['src/scripts/kansai/brdf-table.ts'],bundle:true,format:'cjs',platform:'node',write:false}).outputFiles[0].text;
test('the pinned integration table is installed once in native orientation with nearest filtering',async()=>{
  let source=table,requests=0,renders=0;
  const textures=[],module={exports:{}},engine={VERSION:'1.133',Sampler:{NEAREST:{}},Texture:class{
    constructor(options){textures.push(options);}
  }};
  runInNewContext(script,{module,window:{Cesium:engine},fetch:async()=>{requests++;return new Response(source);}});
  const generator={_colorTexture:undefined,get colorTexture(){return this._colorTexture;}};
  const widget={isDestroyed:()=>false,scene:{context:{},_brdfLutGenerator:generator,requestRender(){renders++;}}};
  await module.exports.loadBrdfTable(widget);await module.exports.loadBrdfTable(widget);
  assert.equal(textures.length,1);assert.equal(requests,1);assert.equal(renders,1);
  const tex=textures[0];assert.equal(tex.sampler,engine.Sampler.NEAREST);assert.equal(tex.flipY,false);
  assert.equal(tex.source.width,256);assert.equal(tex.source.height,256);assert.deepEqual(Buffer.from(tex.source.arrayBufferView),table);
  assert.equal(table.length,256*256*4);
  assert.ok(table.some((v,i)=>i%4===1&&v>170));
  assert.ok(table.every((v,i)=>i%4===2?v===0:i%4===3?v===255:true));
  generator._colorTexture=undefined;source=Buffer.from([1,2,3]);await module.exports.loadBrdfTable(widget);
  assert.equal(generator.colorTexture,undefined);assert.equal(textures.length,1);
  engine.VERSION='other';await module.exports.loadBrdfTable(widget);assert.equal(requests,2);
});
