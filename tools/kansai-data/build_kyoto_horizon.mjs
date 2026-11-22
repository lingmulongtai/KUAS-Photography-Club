/** Bake the same distant Kyoto buildings and ground offsets used when flying to Kobe. */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createServer} from 'vite';

const base=new URL('../../public/kyoto/',import.meta.url);
const vite=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),configFile:false,logLevel:'error',
  server:{middlewareMode:true,hmr:false,watch:null}});
const oldFetch=globalThis.fetch;
globalThis.fetch=async url=>typeof url==='string' && url.startsWith('/kyoto/')
  ? new Response(await readFile(new URL(url.slice(7),base))) : oldFetch(url);
try{
  const {loadBuildings}=await vite.ssrLoadModule('/src/scripts/hero/buildings-data.ts');
  const {loadHeightfield}=await vite.ssrLoadModule('/src/scripts/hero/heightfield.ts');
  const {buildSouthOverview}=await vite.ssrLoadModule('/src/scripts/hero/south-overview.ts');
  const {horizonBlockSteps}=await vite.ssrLoadModule('/src/scripts/hero/distant-basin.ts');
  const {finishSteps}=await vite.ssrLoadModule('/src/scripts/hero/task-yield.ts');
  const terrain=await loadHeightfield(JSON.parse(await readFile(new URL('terrain.json',base),'utf8')));
  const chunks=[],names=['buildings','buildings-south','buildings-yamashina','buildings-yamashina-basin','buildings-otokuni','buildings-otokuni-tennozan'];
  const header=Buffer.alloc(4);header.writeUInt32LE(names.length);chunks.push(header);
  for(const name of names){
    const data=await loadBuildings(name+'.json',name+'.bin');
    const blocks=finishSteps(horizonBlockSteps(data));
    const {mesh}=await buildSouthOverview({},blocks,(x,z)=>terrain.height(x,z));
    const h=Buffer.alloc(20),{center,radius}=mesh.boundingSphere;h.writeUInt32LE(mesh.count);
    [center.x,center.y,center.z,radius+.01].forEach((v,i)=>h.writeFloatLE(v,4*(i+1)));
    chunks.push(h,Buffer.from(mesh.instanceMatrix.array.buffer));
    mesh.dispose();mesh.material.dispose();mesh.geometry.dispose();
    console.log(name,blocks.length);
  }
  await writeFile(new URL('kansai/kyoto-horizon.bin.gz',base),gzipSync(Buffer.concat(chunks),{level:9}));
}finally{globalThis.fetch=oldFetch;await vite.close();}
