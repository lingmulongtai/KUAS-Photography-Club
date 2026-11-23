import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {build}=require('esbuild'),Module=require('node:module');

test('districtImagery reports covered zoom level for wide districts and close insets',async()=>{
  const result=await build({stdin:{resolveDir:process.cwd(),contents:`
    export {districtImagery,districtSampling} from './src/scripts/hero/regional-districts.ts';
  `},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
  const mod=new Module(import.meta.url);
  mod.filename=import.meta.filename;
  mod.paths=require.resolve.paths('three')??[];
  mod._compile(result.outputFiles[0].text,import.meta.filename);
  const {districtImagery,districtSampling}=mod.exports;

  const districts=[
    {id:'otsu',box:[5760,-8000,21360,4800],file:'kansai/districts/otsu.webp',zoom:15},
    {id:'nara',box:[1600,31560,11600,39560],file:'kansai/districts/nara.webp',zoom:15},
    {id:'nara-park',box:[6440,34580,8840,36780],file:'kansai/districts/nara-park.webp',zoom:17},
  ];
  const update=districtImagery(districts,1,async()=>false,()=>{});
  // Inside otsu (wide zoom 15 district): reports zoom 15 so high-altitude raw z15 live tiles are suppressed.
  assert.equal(update(14000,-1000,1),15);
  // Outside all districts: reports 0.
  assert.equal(update(30000,-20000,2),0);
  // Inside nara-park inset: reports zoom 17 so all live tiles are suppressed.
  assert.equal(update(7500,35500,3),17);
  // Inside nara outside nara-park (>150 m from inset): reports zoom 15.
  assert.equal(update(3000,33000,4),15);
  // Shader helper exposes both standard overlay and tone-matched live overlay with empty-box guard.
  assert.match(districtSampling,/vec3 overlayMatched\(/);
  assert.match(districtSampling,/box\.z<=box\.x \|\| box\.w<=box\.y/);
});
