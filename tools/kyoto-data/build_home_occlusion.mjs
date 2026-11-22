/** Bake the existing 2x2 subpixel building masks at both homepage resolutions. */
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {buildOcclusion,occlusionFile} from '../../src/scripts/hero/building-occlusion.ts';
import {loadBuildings} from '../../src/scripts/hero/buildings-data.ts';
import {BUILDINGS_BOX} from '../../src/scripts/hero/geo.ts';

const root=new URL('../../public/kyoto/',import.meta.url);
const directory=new URL('occlusion/',root);
await fs.mkdir(directory,{recursive:true});
globalThis.fetch=async url=>new Response(await fs.readFile(new URL(url.slice('/kyoto/'.length),root)));
const {regions}=JSON.parse(await fs.readFile(new URL('regions.json',root)));
regions.unshift({box:BUILDINGS_BOX,buildings:{meta:'buildings.json',file:'buildings.bin'}});
for(const {box,buildings} of regions){
  const data=await loadBuildings(buildings.meta,buildings.file);
  for(const size of [1024,2048]){
    const texture=buildOcclusion(data,box,size);
    const file=occlusionFile(buildings.file,size);
    await fs.writeFile(new URL(file,root),gzipSync(texture.image.data,{level:9}));
    texture.dispose();
  }
}
