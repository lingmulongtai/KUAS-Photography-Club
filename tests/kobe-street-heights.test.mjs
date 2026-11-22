import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {buildSync} from 'esbuild';

test('adjacent Kobe street tiles share one local survey and retain the source height in centimetres',async t=>{
  const code=buildSync({entryPoints:['src/scripts/kansai/lidar.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const mod={exports:{}};
  new Function('module','exports',code)(mod,mod.exports);
  const root=new URL('../public/',import.meta.url),requests=[];
  t.mock.method(globalThis,'fetch',async url=>{
    assert.ok(url.startsWith('/kansai/'),String(url));
    requests.push(url);
    return new Response(readFileSync(new URL(url.slice(1),root)));
  });
  const tags=JSON.parse(gunzipSync(readFileSync(new URL('kansai/building-attributes/3586-1626.json.gz',root))));
  const rings=tags.find(row=>row.id==='w182670552').polygons[0];
  const height=await mod.exports.hyogoHeights(57379,26026);
  assert.equal(Math.round(height(rings)*100),2883);
  await mod.exports.hyogoHeights(57378,26026);
  assert.deepEqual(requests.sort(),['/kansai/kobe-street-heights/28689-13013.bin','/kansai/kobe-street-heights/index.json','/kansai/lidar-coverage.json']);
});
