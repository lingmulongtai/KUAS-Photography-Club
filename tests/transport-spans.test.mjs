import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';

const code=buildSync({entryPoints:['src/scripts/hero/transport-spans.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}).outputFiles[0].text;
const mod={exports:{}};new Function('require','module','exports',code)(createRequire(import.meta.url),mod,mod.exports);
const {buildTransportSpans}=mod.exports;

test('road vehicles follow a mapped deck only along its carriageway',async()=>{
  const path={kind:'road',width:10,level:0,points:[[0,0],[120,0]]};
  const {heightAt,group}=await buildTransportSpans({},[path],()=>10,[]);
  assert.ok(heightAt(60,2,1,0)>13);
  assert.equal(heightAt(60,2,0,1),-Infinity);
  assert.equal(heightAt(60,9,1,0),-Infinity);
  assert.ok(heightAt(0,0,1,0)<10.3);
  assert.equal(group.children.length,1);
  const custom={x:60,z:0,length:125,width:12,angle:0};
  const other=await buildTransportSpans({},[path],()=>10,[custom]);
  assert.equal(other.group.children.length,0);
});

test('the distributed structure pack contains mapped transport around the named districts',()=>{
  const {paths}=JSON.parse(gunzipSync(readFileSync(new URL('../public/kyoto/transport-spans.json.gz',import.meta.url))));
  for(const [x,z] of [[-5090,2700],[680,6350],[-16300,-820],[-25000,-11500]]){
    assert.ok(paths.some(s=>s.points.some(([a,b])=>Math.hypot(a-x,b-z)<2500)));
  }
  for(const s of paths)assert.ok(['road','rail'].includes(s.kind)&&s.width>0&&s.points.length>=2);
});
