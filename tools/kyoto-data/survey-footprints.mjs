// Give the offline gap builder the footprints actually shipped by the browser's decoder.
import {readFile} from 'node:fs/promises';
import {loadBuildings} from '../../src/scripts/hero/buildings-data.ts';

const [west,north,east,south]=process.argv.slice(2,6).map(Number);
const surveys=process.argv.slice(6);
const root=new URL('../../public/kyoto/',import.meta.url);
globalThis.fetch=async url=>new Response(await readFile(new URL(String(url).slice('/kyoto/'.length),root)));
const intersects=(ring)=>ring.some(([x])=>x>=west)&&ring.some(([x])=>x<=east)
  &&ring.some(([,z])=>z>=north)&&ring.some(([,z])=>z<=south);
const layers={};
for(const name of surveys.length?surveys:['core','south','tennozan']){
  const stem=name==='core'?'buildings':`buildings-${name}`;
  const {boxes,polys}=await loadBuildings(stem+'.json',stem+'.bin');
  const rings=[];
  for(const b of boxes){
    const radius=(b.w+b.d)/2;
    if(b.x+radius<west||b.x-radius>east||b.z+radius<north||b.z-radius>south)continue;
    const c=Math.cos(b.angle),s=Math.sin(b.angle);
    rings.push([[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[
      b.x+(u*b.w*c-v*b.d*s)/2,b.z+(u*b.w*s+v*b.d*c)/2,
    ]));
  }
  for(const p of polys){
    const ring=[];
    for(let i=0;i<p.ring.length;i+=2)ring.push([p.ring[i],p.ring[i+1]]);
    if(intersects(ring))rings.push(ring);
  }
  layers[name]=rings;
}
process.stdout.write(JSON.stringify(layers));
