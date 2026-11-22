/** Bake the browser's 2048px road, water and shoreline exclusion raster using Chromium.
 * Requires esbuild and playwright (or NODE_PATH pointing at an installed playwright).
 */
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../../public/kyoto/',import.meta.url);
const source=`
  import {infrastructureBits} from './src/scripts/hero/forest-infrastructure.ts';
  import {loadLines} from './src/scripts/hero/lines-data.ts';
  import {withoutTunnels} from './src/scripts/hero/tunnels.ts';
  import {BUILDINGS_BOX} from './src/scripts/hero/geo.ts';
  window.bake=async (region,lake)=>{
    const meta=await (await fetch('/kyoto/terrain.json')).json();
    const box=region?.box??[meta.arashiyama,meta.higashiyama].filter(Boolean).reduce((a,{box:b})=>[
      Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])],BUILDINGS_BOX);
    const patch=region?(lake?'kansai/yamashina-lake-remainder.json.gz':undefined):
      [...(meta.arashiyama?[meta.arashiyama.water.file]:[]),'water-kamo.json.gz'];
    const lines=await withoutTunnels(loadLines(patch,region?.lines.file,region?.lines.box,region?.lines.q));
    const bits=infrastructureBits(lines,box);
    const bytes=new Uint8Array(4+bits.length);
    new DataView(bytes.buffer).setUint32(0,lines.length,true);
    bytes.set(bits,4);
    const blob=new Blob([bytes]);
    return await new Promise(resolve=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result.split(',')[1]);fr.readAsDataURL(blob);});
  };`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const {regions}=JSON.parse(await fs.readFile(new URL('regions.json',root)));
await fs.mkdir(new URL('forest-masks/',root),{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  await page.route('http://bake.local/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Bake masks</title>'});
    if(!pathname.startsWith('/kyoto/'))return route.abort();
    await route.fulfill({body:await fs.readFile(new URL(pathname.slice(7),root))});
  });
  await page.goto('http://bake.local');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  for(const region of [null,...regions]){
    for(const lake of region?.id==='yamashina'?[false,true]:[false]){
      const encoded=await page.evaluate(([r,l])=>window.bake(r,l),[region,lake]);
      const file=(region?.lines.file??'lines.bin').replace('.bin',lake?'-lake.bin':'.bin');
      await fs.writeFile(new URL('forest-masks/'+file,root),gzipSync(Buffer.from(encoded,'base64'),{level:9}));
    }
  }
}finally{await browser.close();}
