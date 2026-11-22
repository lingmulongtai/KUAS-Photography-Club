/** Sample actual GSI footprints for the houses between the street model and the distant skyline. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync,gzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {lonLat,prefectureLookup,tileMetresPerDegree} from '../../src/scripts/kansai/coordinates.ts';

const root=fileURLToPath(new URL('../../public/kansai/',import.meta.url));
const output=path.join(root,'neighborhoods');
fs.mkdirSync(output,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const owner=prefectureLookup(read('prefectures.json').features);
const sources=new Map();
for(const [code,keys] of Object.entries(read('network/index.json').prefectures)){
  for(const key of keys){
    if(!sources.has(key))sources.set(key,[]);
    sources.get(key).push(path.join(root,'network',code,key.replace('/','-')+'.bin'));
  }
}
// These surveys already supply a resident house layer in the original Kyoto scene.
const kyoto=path.join(root,'../kyoto');
const existing=new Set();
const mark=(x,z)=>existing.add((Math.floor(x/20)+4096)*8192+Math.floor(z/20)+4096);
const {loadBuildings}=await import('../../src/scripts/hero/buildings-data.ts');
const {toLocal}=await import('../../src/scripts/hero/geo.ts');
globalThis.fetch=async url=>new Response(fs.readFileSync(path.join(kyoto,path.basename(url))));
for(const suffix of ['', '-south','-yamashina','-yamashina-basin','-otokuni','-otokuni-tennozan']){
  const survey=await loadBuildings('buildings'+suffix+'.json','buildings'+suffix+'.bin');
  for(const b of survey.boxes)mark(b.x,b.z);
  for(const p of survey.polys){
    let x=0,z=0;
    for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}
    mark(x*2/p.ring.length,z*2/p.ring.length);
  }
}
const tiles={};
for(const [key,files] of sources){
  const [px,py]=key.split('/').map(Number),packs=files.map(file=>fs.readFileSync(file));
  const [west,north]=lonLat(px,py,12),[east,south]=lonLat(px+1,py+1,12);
  const [mx,my]=tileMetresPerDegree((north+south)/2);
  const metresX=mx*(east-west),metresY=my*(north-south);
  const cells=new Map();
  for(let slot=0;slot<256;slot++){
    const pack=packs.find(p=>p.readUInt32LE(slot*4)<p.readUInt32LE((slot+1)*4));
    if(!pack)continue;
    const layer=new VectorTile(new Pbf(gunzipSync(pack.subarray(pack.readUInt32LE(slot*4),pack.readUInt32LE((slot+1)*4))))).layers.BldA;
    if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i);
      const ring=feature.loadGeometry()[0];
      if(!ring || ring.length<4)continue;
      const scaleX=metresX/(16*feature.extent),scaleY=metresY/(16*feature.extent);
      let longest=0,angle=0,area=0;
      for(let j=1;j<ring.length;j++){
        const a=ring[j-1],b=ring[j],dx=(b.x-a.x)*scaleX,dy=(b.y-a.y)*scaleY;
        area+=a.x*b.y-b.x*a.y;
        if(dx*dx+dy*dy>longest){longest=dx*dx+dy*dy;angle=Math.atan2(dy,dx);}
      }
      area=Math.abs(area)*scaleX*scaleY*.5;
      if(area<20 || area>4500)continue;
      const [w,n,e,s]=feature.bbox(),u=(w+e)/(2*feature.extent),v=(n+s)/(2*feature.extent);
      if(u<0||u>=1||v<0||v>=1)continue;
      const x=((slot%16)+u)/16,y=((slot>>4)+v)/16;
      const col=Math.floor(x*metresX/48),row=Math.floor(y*metresY/48),id=col+row*256;
      const previous=cells.get(id);
      if(previous && previous.area>=area)continue;
      let lo=Infinity,hi=-Infinity;
      const c=Math.cos(angle),sn=Math.sin(angle);
      for(const p of ring){const along=p.x*scaleX*c+p.y*scaleY*sn;lo=Math.min(lo,along);hi=Math.max(hi,along);}
      const width=hi-lo,depth=area/width;
      if(!Number.isFinite(depth)||width<3||depth<2)continue;
      const height=Number(feature.properties.vt_height)|| (area>600?12:area>160?8:6);
      cells.set(id,{x,y,area,width,depth,height,angle});
    }
  }
  const roofs=[...cells.values()].filter(b=>{
    const lonlat=lonLat(px+b.x,py+b.y,12),p=toLocal(lonlat[1],lonlat[0]);
    return !existing.has((Math.floor(p.x/20)+4096)*8192+Math.floor(p.z/20)+4096) && owner(lonlat);
  });
  if(!roofs.length)continue;
  const bytes=Buffer.alloc(roofs.length*8);
  roofs.forEach((b,i)=>{
    const j=8*i;
    bytes.writeUInt16LE(Math.round(b.x*65535),j);bytes.writeUInt16LE(Math.round(b.y*65535),j+2);
    bytes[j+4]=Math.min(255,Math.round(b.width));bytes[j+5]=Math.min(255,Math.round(b.depth));
    bytes[j+6]=Math.max(3,Math.min(150,Math.round(b.height)));bytes[j+7]=Math.round(b.angle/Math.PI*256)&255;
  });
  tiles[key]=roofs.length;
  fs.writeFileSync(path.join(output,key.replace('/','-')+'.bin.gz'),gzipSync(bytes,{level:9}));
}
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify({tiles})+'\n');
console.log(Object.keys(tiles).length,'districts;',Object.values(tiles).reduce((a,b)=>a+b,0),'surveyed roofs');
