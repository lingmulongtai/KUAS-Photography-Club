import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {cutTunnels} from '../src/scripts/hero/tunnels.ts';
const require=createRequire(import.meta.url);
const {build}=require('esbuild'),Module=require('node:module');

const road=(...pts)=>({kind:0,attr:2,pts:new Float32Array(pts)});
const length=lines=>lines.filter(f=>f.kind===0).reduce((sum,f)=>{
  for(let i=0;i+3<f.pts.length;i+=2)sum+=Math.hypot(f.pts[i+2]-f.pts[i],f.pts[i+3]-f.pts[i+1]);return sum;},0);

test('a road through a tunnel keeps its approaches and loses the stretch under the hill',()=>{
  const out=cutTunnels([road(0,0,1000,0)],[[300,1,700,-1]]);
  assert.equal(out.length,2);
  assert.ok(Math.abs(out[0].pts.at(-2)-300)<5&&Math.abs(out[1].pts[0]-700)<5,'cut at the portals');
  assert.ok(Math.abs(length(out)-600)<10);
});

test('roads crossing above a tunnel, rails and water are untouched',()=>{
  const cross=road(500,-200,500,200),rail={kind:1,attr:0,pts:new Float32Array([0,0,1000,0])};
  const out=cutTunnels([cross,rail],[[300,0,700,0]]);
  assert.deepEqual(out,[cross,rail]);
});

test('no GSI road tunnel is drawn over the terrain, in the core or any region',async(t)=>{
  const result=await build({stdin:{resolveDir:process.cwd(),contents:`export {loadLines} from './src/scripts/hero/lines-data.ts';export {withoutTunnels} from './src/scripts/hero/tunnels.ts';`},
    bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
  const mod=new Module(import.meta.url);mod.filename=import.meta.filename;mod.paths=Module._nodeModulePaths(process.cwd());
  mod._compile(result.outputFiles[0].text,import.meta.filename);
  const original=globalThis.fetch;globalThis.fetch=async path=>new Response(await readFile(new URL('../public'+path,import.meta.url)));
  t.after(()=>{globalThis.fetch=original;});
  const tunnels=JSON.parse(gunzipSync(await readFile(new URL('../public/kyoto/tunnels.json.gz',import.meta.url)))).lines;
  assert.ok(tunnels.length>100);
  const regions=JSON.parse(await readFile(new URL('../public/kyoto/regions.json',import.meta.url))).regions;
  const {loadLines,withoutTunnels}=mod.exports;
  const sets=[await withoutTunnels(loadLines(['water-arashiyama.json.gz','water-kamo.json.gz']))];
  for(const r of regions)sets.push(await withoutTunnels(loadLines(undefined,r.lines.file,r.lines.box,r.lines.q)));
  // the middle of every tunnel longer than 60 m: no road may run along it any more
  let checked=0;
  for(const tl of tunnels){
    let len=0;for(let i=0;i+3<tl.length;i+=2)len+=Math.hypot(tl[i+2]-tl[i],tl[i+3]-tl[i+1]);
    if(len<60)continue;
    const mid=Math.floor((tl.length/2-1)/2)*2,tx=tl[mid+2]-tl[mid],tz=tl[mid+3]-tl[mid+1];
    const x=tl[mid]+tx/2,z=tl[mid+1]+tz/2;
    for(const lines of sets)for(const f of lines){
      if(f.kind!==0)continue;
      for(let i=0;i+3<f.pts.length;i+=2){
        const ax=f.pts[i],az=f.pts[i+1],dx=f.pts[i+2]-ax,dz=f.pts[i+3]-az,d2=dx*dx+dz*dz;if(!d2)continue;
        const u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/d2));
        if(Math.hypot(x-ax-dx*u,z-az-dz*u)>1.5)continue;
        assert.ok(Math.abs(dx*tx+dz*tz)/Math.sqrt(d2)/Math.hypot(tx,tz)<.85,`road along tunnel at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
    checked++;
  }
  assert.ok(checked>100,`checked ${checked} tunnels`);
});
