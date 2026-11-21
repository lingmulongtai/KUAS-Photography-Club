import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as idle} from 'node:timers/promises';
import {runInNewContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {buildSync} from 'esbuild';
import {terrainPrograms} from '../tools/kansai-data/terrain-programs.mjs';
import {readFileSync} from 'node:fs';
import {boundEnvironmentLoops} from '../tools/kansai-data/cesium-assets.mjs';
import irradiance from '@cesium/engine/Source/Shaders/ComputeIrradianceFS.js';
import specular from '@cesium/engine/Source/Shaders/ConvolveSpecularMapFS.js';

test('environment lighting preserves native sample counts and the WebGL1 shader path',()=>{
  const native=readFileSync(new URL('../node_modules/cesium/Build/Cesium/Cesium.js',import.meta.url),'utf8');
  const bounded=boundEnvironmentLoops(native);
  assert.ok(bounded.includes('const int samples = 256;'));
  assert.ok(bounded.includes('const int samples = 128;'));
  for(const [source,sampler] of [[irradiance,'u_radianceMap'],[specular,'u_radianceTexture']]){
    assert.ok(native.includes(source));
    assert.ok(!bounded.includes(source));
    assert.ok(bounded.includes(`textureSize(${sampler}, 0).x + samples`));
  }
  assert.equal(bounded.split('#else\n    const int sampleCount = samples;').length-1,2);
  assert.equal(boundEnvironmentLoops('unrecognised shader bundle'),'unrecognised shader bundle');
});

test('terrain warm-up uses the installed engine sources and covers each aerial layer count',()=>{
  const catalogue=terrainPrograms();
  const variants=new Set();
  for(const program of catalogue.programs){
    const source=program.fragment.map(i=>catalogue.chunks[i]).join('#line 0');
    const count=Number(source.match(/^#define TEXTURE_UNITS (\d+)$/m)?.[1]);
    const defined=name=>source.split('\n').includes('#define '+name);
    assert.ok(defined('LOG_DEPTH'));
    assert.equal(defined('ENABLE_VERTEX_LIGHTING'),program.night);
    assert.equal(defined('APPLY_BRIGHTNESS'),program.night);
    variants.add([count,program.night,defined('FOG'),defined('UNDERGROUND_COLOR')].join('/'));
  }
  assert.equal(variants.size,catalogue.programs.length);
  for(let n=1;n<=8;n++)for(const night of [false,true])for(const fog of [false,true]){
    assert.ok(variants.has([n,night,fog,false].join('/')));
    if(night&&!fog)assert.ok(variants.has([n,true,false,true].join('/')));
  }
  assert.ok(gzipSync(JSON.stringify(catalogue)).length<20_000);
});

const compiled=buildSync({entryPoints:['src/scripts/kansai/terrain-programs.ts'],platform:'node',format:'cjs',bundle:true,write:false}).outputFiles[0].text;

test('warm-up changes lighting, polls asynchronously and frees pending GPU objects on exit',async()=>{
  const timers=new Map(),shaders=new Set(),programs=new Set(),linked=[];
  let sequence=0,complete=false,fetches=0;
  const window={setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout(id){timers.delete(id);}};
  function tick(){
    const scheduled=[...timers.values()];timers.clear();
    for(const fn of scheduled)fn();
  }
  const catalogue={attributes:{position:0},chunks:['vertex','dayA','dayB','dayC','dayD','night'],
    programs:[1,2,3,4,5].map(i=>({night:i===5,vertex:[0],fragment:[i]}))};
  const gl={
    VERTEX_SHADER:1,FRAGMENT_SHADER:2,isContextLost:()=>false,
    getExtension:name=>name==='KHR_parallel_shader_compile'?{COMPLETION_STATUS_KHR:7}:null,
    createShader(){const shader={};shaders.add(shader);return shader;},
    shaderSource(shader,source){shader.source=source;},compileShader(){},
    createProgram(){const program=[];programs.add(program);return program;},
    attachShader(program,shader){program.push(shader.source);},bindAttribLocation(){},
    linkProgram(program){linked.push(program[1]);},
    getProgramParameter(_program,parameter){assert.equal(parameter,7);return complete;},
    deleteShader(item){assert.ok(shaders.delete(item));},deleteProgram(item){assert.ok(programs.delete(item));},
  };
  const module={exports:{}};
  const fetch=async()=>{fetches++;return new Response(JSON.stringify(catalogue));};
  runInNewContext(compiled,{module,window,fetch,Response,TextDecoder,DecompressionStream,AbortController});
  const prime=module.exports.primeTerrainPrograms;
  prime({getContext:()=>null}).dispose();
  assert.equal(fetches,0);
  const job=prime({getContext:()=>gl});await idle();
  for(let i=0;i<7;i++)tick();
  assert.deepEqual(linked,['dayA','dayB','dayC']);
  job.select(true);complete=true;tick();
  assert.deepEqual(linked,['dayA','dayB','dayC','night']);
  tick();assert.equal(programs.size,0);assert.equal(shaders.size,0);
  job.select(false);complete=false;tick();
  assert.equal(linked.at(-1),'dayD');
  job.dispose();tick();
  assert.equal(programs.size,0);assert.equal(shaders.size,0);assert.equal(timers.size,0);
});
