/** Sample actual GSI footprints for the houses between the street model and the distant skyline. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync,gzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import sharp from 'sharp';
import {CLASS,USAGE} from '../../src/scripts/hero/buildings-data.ts';
import {facadeKind} from '../../src/scripts/kansai/city-footprint.ts';
import {lonLat,prefectureLookup,tileMetresPerDegree,tileXY} from '../../src/scripts/kansai/coordinates.ts';

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

const profiles=read('kobe-roofs/index.json');
const attributes=read('building-attributes/index.json');
const attributeTiles=new Set(attributes.tiles);
const predicted=read('predicted-heights/index.json');
const predictedPacks=new Set(predicted.packs);
const regional=read('heights/index.json');
const regionalTiles=new Set(regional.tiles.map(([x,y])=>x+'/'+y));
const regionalCache=new Map();
const sacredIndex=fs.existsSync(path.join(root,'sacred/index.json'))?read('sacred/index.json').tiles:{};

const incremental=process.argv.includes('--kobe');
const previousIndex=incremental?read('neighborhoods/index.json'):{tiles:{},profiled:[]};
const tiles=incremental?previousIndex.tiles:{};
const profiledSet=new Set(incremental?previousIndex.profiled:[]);

const EXTENT=16384;
const boundsKey=(w,n,e,s)=>[Math.round((w+e)/2),Math.round((n+s)/2),e-w,s-n].join('/');

function containsFlat(ring,x,y){
  let inside=false;
  for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2){
    const a=ring[i],b=ring[i+1],c=ring[j],d=ring[j+1];
    if((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
  }
  return inside;
}
function insideFlat(rings,x,y){
  return containsFlat(rings[0],x,y) && !rings.slice(1).some(r=>containsFlat(r,x,y));
}
function addToBins(bins,w,n,e,s,item){
  const x0=Math.max(0,Math.floor(w/128)),x1=Math.min(127,Math.floor(e/128));
  const y0=Math.max(0,Math.floor(n/128)),y1=Math.min(127,Math.floor(s/128));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const k=y*128+x;
    let list=bins.get(k);
    if(!list){list=[];bins.set(k,list);}
    list.push(item);
  }
}

function lookupSkyline(file){
  const keys=new Set(),bins=new Map();
  if(!fs.existsSync(file))return {keys,has:(cx,cy)=>false};
  for(const row of JSON.parse(gunzipSync(fs.readFileSync(file)))){
    const rings=row[4],points=rings[0];
    let w=Infinity,n=Infinity,e=-Infinity,s=-Infinity;
    for(let i=0;i<points.length;i+=2){
      w=Math.min(w,points[i]);e=Math.max(e,points[i]);
      n=Math.min(n,points[i+1]);s=Math.max(s,points[i+1]);
    }
    keys.add(boundsKey(w,n,e,s));
    if(row[1]===0)addToBins(bins,w,n,e,s,{w,n,e,s,rings});
  }
  const has=(cx,cy)=>{
    const list=bins.get(Math.min(127,Math.max(0,Math.floor(cy/128)))*128+Math.min(127,Math.max(0,Math.floor(cx/128))));
    return !!list && list.some(r=>cx>=r.w&&cx<=r.e&&cy>=r.n&&cy<=r.s&&insideFlat(r.rings,cx,cy));
  };
  return {keys,has};
}

function loadAttributes(key,px,py){
  const bins=new Map();
  if(!attributeTiles.has(key))return ()=>undefined;
  const rows=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'building-attributes',key.replace('/','-')+'.json.gz'))));
  for(const tag of rows){
    if(tag.part || (tag.minHeight??0)>0 || (tag.minLevel??0)>0)continue;
    for(const polygon of tag.polygons){
      const rings=polygon.map(r=>{
        const out=[];
        for(const [lon,lat] of r){
          const [col,line]=tileXY(lon,lat,12);
          out.push((col-px)*EXTENT,(line-py)*EXTENT);
        }
        return out;
      });
      const outer=rings[0];
      if(!outer || outer.length<6)continue;
      let w=Infinity,n=Infinity,e=-Infinity,s=-Infinity;
      for(let i=0;i<outer.length;i+=2){
        w=Math.min(w,outer[i]);e=Math.max(e,outer[i]);
        n=Math.min(n,outer[i+1]);s=Math.max(s,outer[i+1]);
      }
      addToBins(bins,w,n,e,s,{w,n,e,s,rings,height:tag.height,levels:tag.levels,use:tag.use,roof:tag.roof});
    }
  }
  return (cx,cy)=>{
    const list=bins.get(Math.min(127,Math.max(0,Math.floor(cy/128)))*128+Math.min(127,Math.max(0,Math.floor(cx/128))));
    if(!list)return undefined;
    let best;
    for(const r of list){
      if(cx<r.w||cx>r.e||cy<r.n||cy>r.s||!insideFlat(r.rings,cx,cy))continue;
      if(!best || ((r.height||r.levels)&&!(best.height||best.levels)) || (r.use&&!best.use))best=r;
    }
    return best;
  };
}

function loadSacred(key,metresX,metresY){
  const bins=new Map();
  if(!sacredIndex[key])return ()=>undefined;
  const rows=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'sacred',key.replace('/','-')+'.json.gz'))));
  for(const [u16,v16,wDm,dDm,angByte,hDm,kind] of rows){
    if(kind>=5)continue; // torii do not replace building roofs
    const cx=u16/65535*metresX,cy=v16/65535*metresY;
    const w=wDm*0.1,d=dDm*0.1,h=hDm*0.1,angle=angByte*Math.PI/256;
    const rad=Math.max(w,d)*0.6+1.5;
    const item={cx,cy,hw:w*0.56+1.1,hd:d*0.56+1.1,cos:Math.cos(angle),sin:Math.sin(angle),h,kind};
    const gx0=Math.max(0,Math.floor((cx-rad)/64)),gx1=Math.floor((cx+rad)/64);
    const gy0=Math.max(0,Math.floor((cy-rad)/64)),gy1=Math.floor((cy+rad)/64);
    for(let gy=gy0;gy<=gy1;gy++)for(let gx=gx0;gx<=gx1;gx++){
      const k=gy*512+gx;
      let list=bins.get(k);
      if(!list){list=[];bins.set(k,list);}
      list.push(item);
    }
  }
  return (mx,my)=>{
    const list=bins.get(Math.floor(my/64)*512+Math.floor(mx/64));
    if(!list)return undefined;
    for(const s of list){
      const dx=mx-s.cx,dy=my-s.cy;
      const u=dx*s.cos+dy*s.sin,v=-dx*s.sin+dy*s.cos;
      if(Math.abs(u)<=s.hw && Math.abs(v)<=s.hd)return s;
    }
    return undefined;
  };
}

async function loadPredicted(key){
  if(!predictedPacks.has(key))return ()=>undefined;
  const side=2**(predicted.tileZoom-predicted.packZoom);
  const size=predicted.tileSize;
  const pack=fs.readFileSync(path.join(root,'predicted-heights',key.replace('/','-')+'.bin'));
  const slots=new Array(side*side).fill(null);
  const jobs=[];
  for(let i=0;i<side*side;i++){
    const from=pack.readUInt32LE(i*4),to=pack.readUInt32LE((i+1)*4);
    if(from===to)continue;
    jobs.push(sharp(pack.subarray(from,to)).raw().toBuffer().then(buf=>{slots[i]=buf;}));
  }
  await Promise.all(jobs);
  const span=side*size;
  return (u0,v0,u1,v1)=>{
    const values=[];
    let samples=0;
    for(let iy=0;iy<3;iy++)for(let ix=0;ix<3;ix++){
      const u=u0+(u1-u0)*(ix+.5)/3,v=v0+(v1-v0)*(iy+.5)/3;
      const px=Math.min(span-1,Math.max(0,Math.floor(u*span)));
      const py=Math.min(span-1,Math.max(0,Math.floor(v*span)));
      const buf=slots[Math.floor(py/size)*side+Math.floor(px/size)];
      samples++;
      if(!buf)continue;
      const off=((py%size)*size+(px%size))*3;
      const dm=256*buf[off]+buf[off+1];
      if(dm>0)values.push(dm/10);
    }
    if(!values.length || values.length*2<samples)return undefined;
    values.sort((a,b)=>a-b);
    const mid=values.length>>1;
    return values.length%2?values[mid]:(values[mid-1]+values[mid])*0.5;
  };
}

function blockHeight(lon,lat){
  const col=Math.floor((lon-regional.origin[0])/regional.pixelSize[0]);
  const row=Math.floor((regional.origin[1]-lat)/regional.pixelSize[1]);
  const size=regional.tileSize;
  const key=Math.floor(col/size)+'/'+Math.floor(row/size);
  if(!regionalTiles.has(key))return undefined;
  if(!regionalCache.has(key)){
    regionalCache.set(key,gunzipSync(fs.readFileSync(path.join(root,'heights',key+'.f32.gz'))));
  }
  const h=regionalCache.get(key).readFloatLE(8*((row%size)*size+col%size));
  return h>0?h:undefined;
}

const stats={kobe:0,osm:0,predicted:0,block:0,estimated:0,withUse:0,sacred:0,pitched:0,bytes:0,maxTile:0};

for(const [key,files] of sources){
  const filename=key.replace('/','-'),hasKobe=Object.hasOwn(profiles,filename);
  if(incremental && !hasKobe)continue;
  const survey=new Map();
  if(hasKobe){
    const records=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'kobe-roofs',filename+'.json.gz'))));
    for(const row of records)survey.set(row.slice(0,4).join('/'),row);
  }
  const skyline=lookupSkyline(path.join(root,'skyline',filename+'.json.gz'));
  const [px,py]=key.split('/').map(Number),packs=files.map(file=>fs.readFileSync(file));
  const [west,north]=lonLat(px,py,12),[east,south]=lonLat(px+1,py+1,12);
  const [mx,my]=tileMetresPerDegree((north+south)/2);
  const metresX=mx*(east-west),metresY=my*(north-south);
  const matchAttr=loadAttributes(key,px,py);
  const matchSacred=loadSacred(key,metresX,metresY);
  const samplePredicted=await loadPredicted(key);
  const cells=new Map();

  for(let slot=0;slot<256;slot++){
    const pack=packs.find(p=>p.readUInt32LE(slot*4)<p.readUInt32LE((slot+1)*4));
    if(!pack)continue;
    const layer=new VectorTile(new Pbf(gunzipSync(pack.subarray(pack.readUInt32LE(slot*4),pack.readUInt32LE((slot+1)*4))))).layers.BldA;
    if(!layer)continue;
    const slotX=slot%16,slotY=slot>>4;
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i);
      const code=Number(feature.properties.vt_code);
      if(code!==3101 && code!==3102 && code!==3103 && code!==3111 && code!==3112)continue;
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
      const x=(slotX+u)/16,y=(slotY+v)/16;
      const packX=value=>slotX*1024+Math.round(value*1024/feature.extent);
      const packY=value=>slotY*1024+Math.round(value*1024/feature.extent);
      const signature=boundsKey(packX(w),packY(n),packX(e),packY(s)),profile=survey.get(signature);
      const cx16k=x*EXTENT,cy16k=y*EXTENT;
      if(skyline.keys.has(signature) || skyline.has(cx16k,cy16k))continue;
      const sacred=matchSacred(x*metresX,y*metresY);
      const spacing=profile?20:32;
      const col=Math.floor(x*metresX/spacing),row=Math.floor(y*metresY/spacing),id=(col+row*1024)*2+Number(!!profile);
      const priorityArea=sacred?Math.max(area,600):area;
      const previous=cells.get(id);
      if(previous && previous.priorityArea>=priorityArea)continue;
      let lo=Infinity,hi=-Infinity;
      const c=Math.cos(angle),sn=Math.sin(angle);
      for(const p of ring){const along=p.x*scaleX*c+p.y*scaleY*sn;lo=Math.min(lo,along);hi=Math.max(hi,along);}
      const width=hi-lo,depth=area/width;
      if(!Number.isFinite(depth)||width<3||depth<2)continue;

      const attr=matchAttr(cx16k,cy16k);
      const pitch=profile?.[7];
      let height,hSrc;
      if(pitch){height=(pitch[2]+pitch[3]/2)*0.5;hSrc='kobe';}
      else if(profile){height=profile[4]*0.5;hSrc='kobe';}
      else if(attr?.height>0){height=attr.height;hSrc='osm';}
      else if(attr?.levels>0){height=attr.levels*3.1;hSrc='osm';}
      else {
        const u0=(slotX+Math.max(0,w)/feature.extent)/16,v0=(slotY+Math.max(0,n)/feature.extent)/16;
        const u1=(slotX+Math.min(feature.extent,e)/feature.extent)/16,v1=(slotY+Math.min(feature.extent,s)/feature.extent)/16;
        const pred=code===3111?undefined:samplePredicted(u0,v0,u1,v1);
        const gsiH=Number(feature.properties.vt_height);
        if(pred>0){height=pred;hSrc='predicted';}
        else if(gsiH>0){height=gsiH;hSrc='estimated';}
        else {
          const est=code===3103?(area>900?45:34):code===3102?Math.min(33,8+Math.sqrt(area)*0.24)
            :code===3111?Math.min(4.3,Math.max(3.2,3+Math.sqrt(area)*0.08))
            :code===3112?Math.min(12,5+Math.sqrt(area)*0.14)
            :(area>600?10:area>220?8:6.2);
          const block=code===3111?undefined:blockHeight(...lonLat(px+x,py+y,12));
          if(block>0){height=Math.max(est*0.5,Math.min(est*2,(est+block)*0.5));hSrc='block';}
          else {height=est;hSrc='estimated';}
        }
      }
      if(code===3103 && !profile && !(attr?.height>0) && !(attr?.levels>0))height=Math.max(height,32);
      if(sacred)height=Math.max(height,sacred.h);

      const solid=code===3102 || code===3103 || code===3112;
      const shed=code===3111;
      let kind=facadeKind(solid,area,height,attr?.use,shed);
      // Only rotate the rectangle onto a measured ridge if both axes coincide.
      const direction=pitch?-pitch[1]*Math.PI/256:angle;
      const parallel=Math.abs(Math.cos(angle-direction));
      const cross=pitch && parallel<.15;
      const useRidge=pitch && (parallel>.985 || cross);
      let roof=255;
      if(useRidge){
        roof=((pitch[0]+1)<<6)|Math.min(63,Math.max(1,Math.round(pitch[3]*2)));
      }else if(sacred){
        kind=CLASS.wooden|(USAGE.house<<2);
        const rh=Math.min(height*0.45,Math.min(width,depth)*0.36,14);
        roof=(2<<6)|Math.min(63,Math.max(6,Math.round(rh*4)));
      }else if(attr?.roof){
        if((attr.roof==='gabled'||attr.roof==='half-hipped') && height<=18){
          const rh=Math.min(Math.max(Math.min(width,depth)*0.26,1.2),height*0.4);
          roof=(1<<6)|Math.min(63,Math.max(4,Math.round(rh*4)));
        }else if((attr.roof==='hipped'||attr.roof==='pyramidal') && height<=22){
          const rh=Math.min(Math.max(Math.min(width,depth)*0.32,1.4),height*0.45);
          roof=(2<<6)|Math.min(63,Math.max(5,Math.round(rh*4)));
        }else if(attr.roof==='flat' && (kind&3)===CLASS.wooden){
          kind=CLASS.sturdy|(kind&~3);
        }
      }
      cells.set(id,{
        x,y,area,priorityArea,
        width:cross?depth:width,depth:cross?width:depth,
        height,angle:useRidge?direction:angle,kind,roof,hSrc,
        hasUse:Boolean(attr?.use),isSacred:Boolean(sacred),
      });
    }
  }
  const roofs=[...cells.values()].filter(b=>{
    const lonlat=lonLat(px+b.x,py+b.y,12),p=toLocal(lonlat[1],lonlat[0]);
    return !existing.has((Math.floor(p.x/20)+4096)*8192+Math.floor(p.z/20)+4096) && owner(lonlat);
  });
  if(!roofs.length)continue;
  const stride=10;
  profiledSet.add(key);
  const bytes=Buffer.alloc(roofs.length*stride);
  roofs.forEach((b,i)=>{
    const j=stride*i;
    bytes.writeUInt16LE(Math.round(b.x*65535),j);bytes.writeUInt16LE(Math.round(b.y*65535),j+2);
    bytes[j+4]=Math.min(255,Math.round(b.width));bytes[j+5]=Math.min(255,Math.round(b.depth));
    bytes[j+6]=Math.max(3,Math.min(150,Math.round(b.height)));bytes[j+7]=Math.round(b.angle/Math.PI*256)&255;
    bytes[j+8]=b.kind;bytes[j+9]=b.roof;
    stats[b.hSrc]++;
    if(b.hasUse)stats.withUse++;
    if(b.isSacred)stats.sacred++;
    if(b.roof!==255)stats.pitched++;
  });
  tiles[key]=roofs.length;
  const gz=gzipSync(bytes,{level:9});
  stats.bytes+=gz.length;
  stats.maxTile=Math.max(stats.maxTile,gz.length);
  fs.writeFileSync(path.join(output,filename+'.bin.gz'),gz);
}
if(!incremental){
  const keep=new Set(Object.keys(tiles).map(k=>k.replace('/','-')+'.bin.gz'));
  for(const name of fs.readdirSync(output))if(name.endsWith('.bin.gz') && !keep.has(name))fs.unlinkSync(path.join(output,name));
}
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify({tiles,profiled:[...profiledSet].sort()})+'\n');
console.log(Object.keys(tiles).length,'districts;',Object.values(tiles).reduce((a,b)=>a+b,0),'profiled roofs;',JSON.stringify(stats));
