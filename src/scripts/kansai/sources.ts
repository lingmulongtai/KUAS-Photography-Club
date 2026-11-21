import {rasterPixels} from './raster';
import {VectorTile,type VectorTileFeature} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type {Point, Ring} from './coordinates';
import {tileXY} from './coordinates';

const root='/kansai/';
async function response(file:string) {
  const res=await fetch(root+file);
  if(!res.ok)throw new Error(file+' '+res.status);
  return res;
}
export async function json<T>(file:string):Promise<T> {return (await response(file)).json();}
export async function inflate(bytes:Uint8Array<ArrayBuffer>):Promise<ArrayBuffer> {
  if(bytes[0]!==31 || bytes[1]!==139)return bytes.slice().buffer;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export function cache<T>(capacity:number, read:(key:string)=>Promise<T>) {
  const pending=new Map<string,Promise<T>>();
  return (key:string)=>{
    const hit=pending.get(key);
    if(hit){pending.delete(key);pending.set(key,hit);return hit;}
    const value=read(key).catch(error=>{if(pending.get(key)===value)pending.delete(key);throw error;});
    pending.set(key,value);
    if(pending.size>capacity)pending.delete(pending.keys().next().value!);
    return value;
  };
}
export interface BuildingTag {
  id:string; polygons:Ring[][]; height?:number; levels?:number; minHeight?:number; minLevel?:number;
  roof?:string; roofHeight?:number; roofLevels?:number; part?:boolean;
}
type GridIndex={tiles:Point[]};
type PackedIndex={prefectures:Record<string,string[]>;zoom:number;packZoom:number};
function addTo<T>(bins:Map<number,T[]>,slot:number,row:T){
  if(!bins.has(slot))bins.set(slot,[]);
  bins.get(slot)!.push(row);
}
async function packedTiles(folder:string){
  const index=await json<PackedIndex>(folder+'/index.json');
  const span=2**(index.zoom-index.packZoom);
  const owners=new Map<string,string[]>();
  for(const [pref,keys] of Object.entries(index.prefectures))for(const key of keys){
    if(!owners.has(key))owners.set(key,[]);
    owners.get(key)!.push(pref);
  }
  const pack=cache(12,async key=>new Uint8Array(await (await response(folder+'/'+key+'.bin')).arrayBuffer()));
  const read=cache(90,async name=>{
    const [x,y]=name.split('/').map(Number);
    const key=Math.floor(x/span)+'/'+Math.floor(y/span),slot=(y%span)*span+x%span;
    for(const code of owners.get(key)??[]){
      const bytes=await pack(code+'/'+key.replace('/','-'));
      const table=new DataView(bytes.buffer,bytes.byteOffset,(span*span+1)*4);
      const start=table.getUint32(4*slot,true),end=table.getUint32(4*slot+4,true);
      if(end>start)return new VectorTile(new Pbf(new Uint8Array(await inflate(bytes.subarray(start,end)))));
    }
  });
  return (x:number,y:number)=>read(x+'/'+y);
}
export async function modelSources(){
  const [network,surfaces,edges,cover,fields,attributes]=await Promise.all([
    packedTiles('network'),packedTiles('surfaces'),packedTiles('surfaces/edges'),json<GridIndex>('landcover/index.json'),
    json<GridIndex>('fields/index.json'),json<{tiles:string[]}>('building-attributes/index.json'),
  ]);
  const treeTiles=new Set(cover.tiles.map(([x,y])=>x+'-'+y));
  const fieldTiles=new Set(fields.tiles.map(([x,y])=>x+'/'+y));
  const tagTiles=new Set(attributes.tiles);
  const field=cache(8,async key=>{
    const bytes=await inflate(new Uint8Array(await (await response('fields/'+key+'.pbf.gz')).arrayBuffer()));
    const layer=new VectorTile(new Pbf(new Uint8Array(bytes))).layers.fields;
    const bins=new Map<number,VectorTileFeature[]>();
    for(let i=0;i<layer.length;i++){
      const f=layer.feature(i),b=f.bbox(),x=Math.floor((b[0]+b[2])*8/f.extent),y=Math.floor((b[1]+b[3])*8/f.extent);
      addTo(bins,y*16+x,f);
    }
    return bins;
  });
  const tags=cache(5,async key=>{
    const bytes=await inflate(new Uint8Array(await (await response('building-attributes/'+key.replace('/','-')+'.json.gz')).arrayBuffer()));
    const rows:BuildingTag[]=JSON.parse(new TextDecoder().decode(bytes));
    const [parentX,parentY]=key.split('/').map(Number);
    const bins=new Map<number,BuildingTag[]>();
    for(const row of rows){
      let west=180,east=-180,south=90,north=-90;
      for(const rings of row.polygons)for(const [lon,lat] of rings[0]){
        west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);
      }
      const [x0,y0]=tileXY(west,north,16),[x1,y1]=tileXY(east,south,16);
      for(let y=Math.max(0,Math.floor(y0)-parentY*16);y<=Math.min(15,Math.floor(y1)-parentY*16);y++)
        for(let x=Math.max(0,Math.floor(x0)-parentX*16);x<=Math.min(15,Math.floor(x1)-parentX*16);x++)addTo(bins,16*y+x,row);
    }
    return bins;
  });
  const raster=cache(8,async key=>{
    const bitmap=await createImageBitmap(await (await response('landcover/'+key+'.png')).blob());
    return rasterPixels(bitmap);
  });
  return {
    network,surfaces,edges,
    fields:async(key:string,slot:number)=>fieldTiles.has(key)?(await field(key)).get(slot)??[]:[],
    tags:async(key:string,slot:number)=>tagTiles.has(key)?(await tags(key)).get(slot)??[]:[],
    async canopy(bounds:Point[]){
      const cells=new Map<string,ImageData>();
      const keys=new Set(bounds.map(([x,y])=>Math.floor(x*8)+'-'+Math.floor((90-y)*8)));
      await Promise.all([...keys].filter(k=>treeTiles.has(k)).map(async k=>cells.set(k,await raster(k))));
      return ([lon,lat]:Point)=>{
        const x=lon*8,y=(90-lat)*8,data=cells.get(Math.floor(x)+'-'+Math.floor(y));
        if(!data)return 0;
        return data.data[4*(Math.floor((y%1)*data.height)*data.width+Math.floor((x%1)*data.width))]/255;
      };
    },
  };
}
export type ModelSources=Awaited<ReturnType<typeof modelSources>>;
