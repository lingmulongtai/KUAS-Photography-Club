/** Export the same architectural models used by the Kyoto panorama in georeferenced glTF. */
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {portTower} from './port-tower.mjs';
import {districtModel} from './nankinmachi.mjs';
import {kasugaBuildings} from './kasuga.mjs';
import {flightAviary} from './aviary.mjs';
import {greatBuddhaHall,hikoneKeep,harborHotel,roseGarden} from './outing-landmarks.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
const output=new URL('../../public/kansai/landmarks/',import.meta.url);
const kyoto=new URL('../../public/kyoto/',import.meta.url);
const vite=await createServer({root:project,configFile:false,server:{middlewareMode:true,hmr:false,watch:null},logLevel:'error'});
const load=file=>vite.ssrLoadModule('/src/scripts/hero/'+file+'.ts');
const manifest=[];
const oldFetch=globalThis.fetch;
globalThis.fetch=async url=>typeof url==='string'&&url.startsWith('/kyoto/')?
  new Response(await fs.readFile(new URL(url.slice(7),kyoto))):oldFetch(url);
function glb(parts){
  const p=[],normal=[],color=[],indices=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const {geo,color:rgb} of parts){
    const pos=geo.getAttribute('position'),norm=geo.getAttribute('normal'),start=p.length/3;
    for(let i=0;i<pos.count;i++){
      const v=[pos.getX(i),pos.getY(i),pos.getZ(i)];p.push(...v);
      for(let j=0;j<3;j++){min[j]=Math.min(min[j],v[j]);max[j]=Math.max(max[j],v[j]);}
      normal.push(norm.getX(i),norm.getY(i),norm.getZ(i));color.push(...rgb.map(c=>Math.round(Math.min(1,c)*255)),255);
    }
    if(geo.index)for(const i of geo.index.array)indices.push(start+i);
    else for(let i=0;i<pos.count;i++)indices.push(start+i);
  }
  const arrays=[new Float32Array(p),new Float32Array(normal),new Uint8Array(color),new Uint32Array(indices)];
  let offset=0;
  const views=arrays.map(a=>{const v={buffer:0,byteOffset:offset,byteLength:a.byteLength};offset+=a.byteLength;return v;});
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},indices:3,material:0}]}],
    materials:[{doubleSided:true,pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.88}}],buffers:[{byteLength:offset}],bufferViews:views,
    accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min,max},
      {bufferView:1,componentType:5126,count:p.length/3,type:'VEC3'},{bufferView:2,componentType:5121,normalized:true,count:p.length/3,type:'VEC4'},
      {bufferView:3,componentType:5125,count:indices.length,type:'SCALAR'}]};
  const text=Buffer.from(JSON.stringify(doc)),n=(text.length+3)&~3,header=Buffer.alloc(20),chunk=Buffer.alloc(8);
  header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+n+offset,8);header.writeUInt32LE(n,12);header.write('JSON',16);
  chunk.writeUInt32LE(offset);chunk.writeUInt32LE(0x004e4942,4);
  return {data:Buffer.concat([header,text,Buffer.alloc(n-text.length,32),chunk,...arrays.map(a=>Buffer.from(a.buffer))]),min,max};
}
try{
  const {LANDMARKS}=await load('landmarks'),{imperialPalace}=await load('imperial-palace'),{nijoCastle}=await load('nijo-castle');
  const {BYODOIN_CENTER,byodoinParts}=await load('byodoin'),{fushimiInari,INARI_BUILDINGS}=await load('fushimi-inari');
  const {ORIGIN,M_PER_DEG_LON,M_PER_DEG_LAT}=await load('geo');
  const geo=(x,z)=>[ORIGIN.lon+x/M_PER_DEG_LON,ORIGIN.lat-z/M_PER_DEG_LAT];
  const rect=(w,s,e,n)=>[[w,s],[e,s],[e,n],[w,n]];
  const {loadHeightfield}=await load('heightfield'),{loadBuildings}=await load('buildings-data');
  const meta=JSON.parse(await fs.readFile(new URL('terrain.json',kyoto)));
  const hf=await loadHeightfield(meta),ground=(x,z)=>hf.height(x,z);
  await fs.mkdir(output,{recursive:true});
  async function save(id,parts,lon,lat,masks,pref='26'){
    const {data,min,max}=glb(parts),dx=M_PER_DEG_LON,dy=M_PER_DEG_LAT;
    await fs.writeFile(new URL(id+'.glb',output),data);
    const rings=masks??[rect(lon+min[0]/dx,lat-max[2]/dy,lon+max[0]/dx,lat-min[2]/dy)];
    manifest.push({id,pref,lon,lat,file:'/kansai/landmarks/'+id+'.glb',rings});
  }
  for(const [name,l] of Object.entries(LANDMARKS)){
    if(name==='kyotoStation')continue;
    const [lon,lat]=l.lat===undefined?geo(l.x,l.z):[l.lon,l.lat];
    await save(name,l.parts,lon,lat);
  }
  for(const [name,sites] of [['imperial-palace',imperialPalace()],['nijo-castle',nijoCastle()]]){
    const items=Object.values(sites),origin=items[0],parts=[],masks=[];
    for(const l of items){
      let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
      for(const part of l.parts){
        const g=part.geo;g.rotateY(l.rotY??0);g.computeBoundingBox();
        x0=Math.min(x0,g.boundingBox.min.x);x1=Math.max(x1,g.boundingBox.max.x);
        z0=Math.min(z0,g.boundingBox.min.z);z1=Math.max(z1,g.boundingBox.max.z);
        g.translate(l.x-origin.x,ground(l.x,l.z)-ground(origin.x,origin.z),l.z-origin.z);parts.push(part);
      }
      masks.push(rect(l.x+x0,l.z+z0,l.x+x1,l.z+z1).map(([x,z])=>geo(x,z)));
    }
    await save(name,parts,...geo(origin.x,origin.z),masks);
  }
  const byodoin=byodoinParts(()=>0);
  for(const {geo:g} of byodoin)g.translate(-BYODOIN_CENTER.x,0,-BYODOIN_CENTER.z);
  await save('byodoin',byodoin,...geo(BYODOIN_CENTER.x,BYODOIN_CENTER.z));
  const anchor=INARI_BUILDINGS[0],inari=fushimiInari(ground);
  for(const {geo:g} of inari)g.translate(-anchor.x,-ground(anchor.x,anchor.z),-anchor.z);
  const inariMasks=INARI_BUILDINGS.map(b=>rect(-b.w/2,-b.d/2,b.w/2,b.d/2).map(([x,z])=>{
    const a=b.angle*Math.PI/180;return geo(b.x+x*Math.cos(a)-z*Math.sin(a),b.z+x*Math.sin(a)+z*Math.cos(a));
  }));
  await save('inari',inari,...geo(anchor.x,anchor.z),inariMasks);
  await save('kobe-port-tower',portTower(),135.1867241,34.6826279,undefined,'28');
  const hotel=JSON.parse(await fs.readFile(new URL('harbor-hotel.json',import.meta.url)));
  const hotelMask=hotel.floorOutlines[0].map(([x,z])=>[hotel.lon+x/91644,hotel.lat-z/110940]);
  await save('kobe-harbor-hotel',harborHotel(hotel),hotel.lon,hotel.lat,[hotelMask],'28');
  const {templeHall,block}=await load('compound-models'),{roof}=await load('temple-models');
  for(const site of JSON.parse(await fs.readFile(new URL('nankinmachi.json',output)))){
    const {id,parts}=districtModel(site,block);
    await save(id,parts,...site.center,[site.ring],'28');
  }
  await save('todaiji',greatBuddhaHall(templeHall),135.83987322,34.68899310,undefined,'29');
  const kasuga=JSON.parse(await fs.readFile(new URL('kasuga-footprints.geojson',output)));
  for(const {id,parts,lon,lat,ring} of kasugaBuildings(kasuga.features,block)){
    await save(id,parts,lon,lat,[ring],'29');
  }
  await save('hikone-keep',hikoneKeep(block,roof),136.25184170,35.27645385,undefined,'25');
  // build_osaka_keep.py retains the source ellipsoid height of the surveyed keep.
  manifest.push({id:'osaka-keep',pref:'27',lon:135.525856,lat:34.687373,ellipsoidHeight:68.477,
    file:'/kansai/landmarks/osaka-keep.glb',rings:[rect(135.525608,34.687154,135.526093,34.687592)]});
  const biwa=JSON.parse(await fs.readFile(new URL('biwa-museum.geojson',output)));
  manifest.push({id:'biwa-museum',pref:'25',lon:135.9351978,lat:35.074304,file:'/kansai/landmarks/biwa-museum.glb',
    rings:biwa.features.map(feature=>feature.geometry.coordinates[0])});
  const botanical=JSON.parse(await fs.readFile(new URL('kitayama-conservatory.geojson',output)));
  manifest.push({id:'kitayama-conservatory',pref:'26',lon:135.7609759,lat:35.0482789,file:'/kansai/landmarks/kitayama-conservatory.glb',
    rings:botanical.features.map(feature=>feature.geometry.coordinates[0])});
  const lotus=JSON.parse(await fs.readFile(new URL('lotus-pavilion.geojson',output)));
  manifest.push({id:'lotus-pavilion',pref:'25',lon:135.9404719,lat:35.0736969,file:'/kansai/landmarks/lotus-pavilion.glb',
    rings:lotus.features.map(feature=>feature.geometry.coordinates[0])});
  const aviary=flightAviary(),outline=JSON.parse(await fs.readFile(new URL('tennoji-aviary.geojson',output)));
  await save('tennoji-aviary',aviary.parts,aviary.lon,aviary.lat,outline.geometry.coordinates,'27');
  const garden=JSON.parse(await fs.readFile(new URL('nakanoshima-beds.json',output)));
  const roseLon=135.50788,roseLat=34.69240;
  await save('nakanoshima-roses',roseGarden(garden.beds,roseLon,roseLat),roseLon,roseLat,[],'27');
  const station=LANDMARKS.kyotoStation;
  const matches=JSON.parse(await fs.readFile(new URL('../../src/data/kyoto-station-replacements.json',import.meta.url)));
  const buildings=await loadBuildings(),rings=[rect(-335.2,1911.35,142.74,2004.04).map(([x,z])=>geo(x,z))];
  for(const [i] of matches.boxes){
    const b=buildings.boxes[i],c=Math.cos(b.angle),s=Math.sin(b.angle);
    rings.push(rect(-b.w/2,-b.d/2,b.w/2,b.d/2).map(([x,z])=>geo(b.x+c*x-s*z,b.z+s*x+c*z)));
  }
  for(const [i] of matches.polys){
    const r=buildings.polys[i].ring,poly=[];
    for(let j=0;j<r.length;j+=2)poly.push(geo(r[j],r[j+1]));
    rings.push(poly);
  }
  const [lon,lat]=geo(station.x,station.z);
  manifest.push({id:'station-district',pref:'26',lon,lat,file:'/kyoto/kyoto-station-district.glb',rings});
  for(const catalogue of ['surveyed-sites.json','temple-roofs.json']){
    manifest.push(...JSON.parse(await fs.readFile(new URL(catalogue,output))));
  }
  await fs.writeFile(new URL('index.json',output),JSON.stringify(manifest)+'\n');
  console.log(manifest.length+' georeferenced architectural models');
}finally{globalThis.fetch=oldFetch;await vite.close();}
