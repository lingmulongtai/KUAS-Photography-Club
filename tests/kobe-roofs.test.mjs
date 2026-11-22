import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {buildSync} from 'esbuild';
const data=new URL('../public/kansai/',import.meta.url);
const read=file=>JSON.parse(gunzipSync(readFileSync(new URL(file,data))));
const source=buildSync({stdin:{contents:"export * from './src/scripts/kansai/surveyed-roofs';export * from './src/scripts/kansai/mesh';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const out={exports:{}};new Function('module','exports',source)(out,out.exports);
const {roofFootprints,matchRoof,drawSurveyedRoof,Mesh}=out.exports;

test('Kobe survey keeps measured masses at the corresponding Sannomiya street and skyline footprints',()=>{
  const rows=read('kobe-roofs/3586-1626.json.gz'),find=roofFootprints(rows);
  const tag=read('building-attributes/3586-1626.json.gz').find(t=>t.id==='w182670552');
  const ring=tag.polygons[0][0],profile=matchRoof(find,ring,3586,1626);
  assert.ok(profile);
  assert.equal(profile[4]*.5,23);
  assert.ok(profile[6].some(([h,polys])=>h*.5>=28 && polys.length));
  assert.equal(find(0,0,138,131),undefined);
  const local=([x,y])=>[(x-ring[0][0])*91500,(y-ring[0][1])*111000];
  const mesh=new Mesh();
  assert.ok(drawSurveyedRoof(mesh,[ring.map(local)],profile,8,7.5,.45,3586,1626,local,'flat',24));
  const tops=new Set(mesh.positions.filter((_,i)=>i%3===2));
  assert.ok(tops.has(8+23) && tops.has(8+28.5));
  assert.ok(!drawSurveyedRoof(mesh,[ring.map(local)],profile,8,7.5,.45,3586,1626,local,'flat',110));
});

test('all shipped Kobe roof blocks contain complete measured profiles with bounded, rising terraces',()=>{
  const index=JSON.parse(readFileSync(new URL('kobe-roofs/index.json',data)));
  let profiles=0,stepped=0;
  for(const [key,count] of Object.entries(index)){
    const rows=read('kobe-roofs/'+key+'.json.gz');assert.equal(rows.length,count);profiles+=count;
    for(const [x,y,w,h,base,upper,terraces] of rows){
      assert.ok(x>=0 && x<=16384 && y>=0 && y<=16384 && w>0 && h>0 && base>=5 && upper>=base);
      if(terraces.length)stepped++;
      let floor=base;
      for(const [height,polys] of terraces){
        assert.ok(height>floor && polys.length);floor=height;
        for(const rings of polys)for(const ring of rings)assert.ok(ring.length>=6 && ring.length%2===0);
      }
    }
  }
  assert.ok(profiles>300000 && stepped>4500);
});
