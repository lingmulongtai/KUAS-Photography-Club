import {cache,inflate,json} from './sources';
import {inPolygon,tileXY,type Point,type Ring} from './coordinates';
type BlockGrid={origin:Point;pixelSize:Point;tileSize:number;tiles:Point[]};

export async function regionalHeights(){
  const [grid,index]=await Promise.all([json<BlockGrid>('heights/index.json'),json<{packs:string[]}>('predicted-heights/index.json')]);
  const grids=new Set(grid.tiles.map(([x,y])=>x+'/'+y)),packs=new Set(index.packs),size=grid.tileSize;
  async function bytes(file:string){
    const r=await fetch('/kansai/'+file);if(!r.ok)throw Error(file);return new Uint8Array(await r.arrayBuffer());
  }
  const blocks=cache(16,async key=>new DataView(await inflate(await bytes('heights/'+key+'.f32.gz'))));
  const archive=cache(10,async key=>bytes('predicted-heights/'+key.replace('/','-')+'.bin'));
  const images=cache(55,async key=>{
    const [x,y]=key.split('/').map(Number),parent=(x>>3)+'/'+(y>>3);if(!packs.has(parent))return;
    const contents=await archive(parent),table=new DataView(contents.buffer,0,260),i=((y%8)*8+x%8)*4;
    const a=table.getUint32(i,true),b=table.getUint32(i+4,true);if(a===b)return;
    const bitmap=await createImageBitmap(new Blob([contents.subarray(a,b)],{type:'image/png'}),{colorSpaceConversion:'none'});
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bitmap,0,0);bitmap.close();
    return ctx.getImageData(0,0,256,256);
  });
  const cell=([lon,lat]:Point):Point=>[Math.floor((lon-grid.origin[0])/grid.pixelSize[0]),Math.floor((grid.origin[1]-lat)/grid.pixelSize[1])];
  const gridKey=([x,y]:Point)=>Math.floor(x/size)+'/'+Math.floor(y/size);
  return async (x:number,y:number,corners:Point[])=>{
    const imgX=x>>1,imgY=y>>1;
    const wanted=new Set(corners.map(p=>gridKey(cell(p))));
    const regional=new Map<string,DataView>();
    const [image]=await Promise.all([images(imgX+'/'+imgY),...Array.from(wanted).filter(key=>grids.has(key))
      .map(async key=>regional.set(key,await blocks(key)))]);
    return {
      block(p:Point){const xy=cell(p),data=regional.get(gridKey(xy));return data?.getFloat32(8*((xy[1]%size)*size+xy[0]%size),true);},
      predicted(rings:Ring[]){
        if(!image)return;
        const r=rings[0],xs=r.map(p=>p[0]),ys=r.map(p=>p[1]);
        const w=Math.min(...xs),s=Math.min(...ys),dx=Math.max(...xs)-w,dy=Math.max(...ys)-s;
        const pixels=new Set<number>(),votes=new Map<number,number>();
        for(let i=0;i<5;i++)for(let j=0;j<5;j++){
          const pt:Point=[w+dx*(i+.5)/5,s+dy*(j+.5)/5];if(!inPolygon(pt,rings))continue;
          const [u,v]=tileXY(...pt,15);if(Math.floor(u)!==imgX||Math.floor(v)!==imgY)continue;
          const k=4*(Math.floor((v%1)*256)*256+Math.floor((u%1)*256)),dm=image.data[k]*256+image.data[k+1];
          if(pixels.has(k))continue;
          pixels.add(k);if(dm>=20)votes.set(dm,1+(votes.get(dm)??0));
        }
        for(const [dm,n] of votes)if(n>=3&&n*2>pixels.size)return dm*.1;
      },
    };
  };
}
export type HeightSources=Awaited<ReturnType<typeof regionalHeights>>;
