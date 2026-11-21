// Select mapped buildings for the southern basin and northern valleys at panorama distances.
// Run: node --experimental-strip-types tools/kyoto-data/build-south-lod.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {loadBuildings} from '../../src/scripts/hero/buildings-data.ts';

globalThis.fetch=async url=>{
  const name=String(url).replace(/^\/kyoto\//,'');
  return new Response(await readFile(new URL(`../../public/kyoto/${name}`,import.meta.url)));
};
const key=(b,step)=>`${Math.floor(b.x/step)},${Math.floor(b.z/step)}`;
async function sample(area,step,skip=()=>false){
  const {boxes}=await loadBuildings(`buildings-${area}.json`,`buildings-${area}.bin`);
  const cells=new Map();
  for(const b of boxes){
    if(b.w*b.d<20||b.h<2||skip(b))continue;
    const cell=key(b,step),list=cells.get(cell)??[];
    list.push({b,score:b.h+Math.sqrt(b.w*b.d)*.2});
    list.sort((a,b)=>b.score-a.score);
    if(list.length>2)list.pop();
    cells.set(cell,list);
  }
  return cells;
}
async function writeOverview(area,cells,residentCount){
  const buildings=cells.flatMap(list=>list.map(({b})=>[
    Math.round(b.x),Math.round(b.z),Math.round(b.w*2)/2,Math.round(b.d*2)/2,Math.round(b.h*2)/2,Math.round(b.angle*1000)/1000,b.ground,
  ]));
  const data=Buffer.from(JSON.stringify({source:'PLATEAU Kyoto 2025 and GSI building outlines; sampled rectangles for distant view',residentCount,buildings}));
  const output=gzipSync(data,{level:9,mtime:0});
  await writeFile(new URL(`../../public/kyoto/buildings-${area}-lod.json.gz`,import.meta.url),output);
  console.log(`${area}: ${buildings.length} representative buildings, ${output.length} bytes`);
}
const south=await sample('south',120);
const confluence=await sample('tennozan',240,b=>south.has(key(b,120)));
await writeOverview('south',[...south.values(),...confluence.values()],[...south.values()].reduce((n,cell)=>n+cell.length,0));
await writeOverview('north',[...(await sample('north',160)).values()]);
