// Sample the existing measured southern building data for a small distant overview.
// Run: node --experimental-strip-types tools/kyoto-data/build-south-lod.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {loadBuildings} from '../../src/scripts/hero/buildings-data.ts';

globalThis.fetch=async url=>{
  const name=String(url).replace(/^\/kyoto\//,'');
  return new Response(await readFile(new URL(`../../public/kyoto/${name}`,import.meta.url)));
};
const {boxes}=await loadBuildings('buildings-south.json','buildings-south.bin');
const cells=new Map();
for(const b of boxes){
  if(b.w*b.d<20||b.h<2)continue;
  const key=`${Math.floor(b.x/120)},${Math.floor(b.z/120)}`,score=b.h+Math.sqrt(b.w*b.d)*.2;
  const list=cells.get(key)??[];list.push({b,score});list.sort((a,b)=>b.score-a.score);if(list.length>2)list.pop();cells.set(key,list);
}
const buildings=[...cells.values()].flatMap(list=>list.map(({b})=>[
  Math.round(b.x),Math.round(b.z),Math.round(b.w*2)/2,Math.round(b.d*2)/2,Math.round(b.h*2)/2,Math.round(b.angle*1000)/1000,b.ground,
]));
const data=Buffer.from(JSON.stringify({source:'PLATEAU Kyoto 2025; sampled rectangles for distant view',buildings}));
const output=gzipSync(data,{level:9,mtime:0});
await writeFile(new URL('../../public/kyoto/buildings-south-lod.json.gz',import.meta.url),output);
console.log(`${buildings.length} representative buildings, ${output.length} bytes`);
