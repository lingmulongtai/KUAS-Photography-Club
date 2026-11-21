import type {Cesium3DTileContent} from 'cesium';
import {inBox,type Point,type Box,type Ring} from './coordinates.ts';

type Member={content:Cesium3DTileContent;id:number;shown:boolean;box:Box;group?:Building};
type Building={key:string;lod:number;box:Box;center:Point;shown:boolean;members:Set<Member>};
type Grid=Map<number,Set<Building>>;
const cell=(x:number,y:number)=>x*100000+y;
const location=([x,y]:Point)=>cell(Math.floor(x*250),Math.floor(y*250));
function visitCells(b:Box,visit:(index:number)=>void){
  for(let x=Math.floor(b[0]*250);x<=Math.floor(b[2]*250);x++){
    for(let y=Math.floor(b[1]*250);y<=Math.floor(b[3]*250);y++)visit(cell(x,y));
  }
}
function indexBuilding(grid:Grid,index:number,building:Building,add:boolean){
  let bin=grid.get(index);
  if(add){
    if(!bin){bin=new Set();grid.set(index,bin);}
    bin.add(building);
  }else if(bin){
    bin.delete(building);
    if(!bin.size)grid.delete(index);
  }
}
function footprints(content:Cesium3DTileContent){
  const records:Member[]=[];
  for(let id=0;id<content.featuresLength;id++){
    const f=content.getFeature(id);
    if(!f.hasProperty('_xmin'))break;
    const box:Box=[f.getProperty('_xmin'),f.getProperty('_ymin'),f.getProperty('_xmax'),f.getProperty('_ymax')];
    if(!box.every(Number.isFinite)||box[2]-box[0]>.08||box[3]-box[1]>.08)continue;
    records.push({content,id,shown:f.show,box});
  }
  return records;
}

export class SurveyCoverage {
  private records=new WeakMap<Cesium3DTileContent,Member[]>();
  private previous=new Map<Cesium3DTileContent,number>();
  private rings=new Set<Ring>();
  private groups=new Map<string,Building>();
  private centers:Grid=new Map();
  private cover:Grid=new Map();
  revision=0;

  contains(point:Point,above=-1){
    const bin=this.cover.get(location(point));
    if(bin)for(const building of bin)if(building.lod>above&&inBox(point,building.box))return true;
    return false;
  }

  apply(visible:Map<Cesium3DTileContent,number>,newRings:Ring[]|undefined,landmarkContains:(p:Point)=>boolean){
    const old=this.previous;
    if(!newRings&&old.size===visible.size){
      let unchanged=true;
      for(const tile of visible.keys())if(!old.has(tile)){unchanged=false;break;}
      if(unchanged)return false;
    }
    const pending=Array.from({length:5},()=>new Set<Building>());
    let coverageChanged=false,featureChanged=false;
    const invalidate=(box:Box,above:number)=>{
      visitCells(box,k=>{
        const bin=this.centers.get(k);
        if(bin)for(const b of bin)if(b.lod<above&&inBox(b.center,box))pending[b.lod].add(b);
      });
    };
    const cover=(b:Building,on:boolean)=>{
      visitCells(b.box,k=>indexBuilding(this.cover,k,b,on));
      invalidate(b.box,b.lod);
      coverageChanged=true;
    };
    const publish=(member:Member,show:boolean)=>{
      if(member.shown===show)return;
      member.content.getFeature(member.id).show=show;
      member.shown=show;featureChanged=true;
    };

    // One building may span many tiles. Attach replacement owners before retiring old ones.
    const added:Member[]=[];
    for(const [content,lod] of visible){
      if(old.has(content))continue;
      let rows=this.records.get(content);
      if(!rows){rows=footprints(content);this.records.set(content,rows);}
      for(const m of rows){
        const box=m.box,key=lod+'/'+box.join(',');
        let b=this.groups.get(key);
        if(!b){
          const center:Point=[(box[0]+box[2])/2,(box[1]+box[3])/2];
          b={key,lod,box,center,members:new Set(),shown:false};
          this.groups.set(key,b);indexBuilding(this.centers,location(center),b,true);
          pending[lod].add(b);
        }
        m.group=b;b.members.add(m);added.push(m);
      }
    }
    for(const content of old.keys()){
      if(visible.has(content))continue;
      // Cesium may already have destroyed this content during traversal.
      for(const m of this.records.get(content)??[]){
        const b=m.group!;b.members.delete(m);m.group=undefined;
        if(b.members.size)continue;
        this.groups.delete(b.key);indexBuilding(this.centers,location(b.center),b,false);
        if(b.shown)cover(b,false);
      }
    }
    if(newRings){
      const next=new Set(newRings);
      const invalidateRing=(r:Ring)=>{
        const box:Box=[Infinity,Infinity,-Infinity,-Infinity];
        for(const [x,y] of r){box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);}
        invalidate(box,5);
      };
      for(const ring of next)if(!this.rings.has(ring))invalidateRing(ring);
      for(const ring of this.rings)if(!next.has(ring))invalidateRing(ring);
      this.rings=next;
    }
    // Restoring a middle LOD may in turn hide a lower one in a neighboring tile.
    for(let lod=4;lod>=0;lod--)for(const b of pending[lod]){
      if(!b.members.size)continue;
      const show=!this.contains(b.center,lod)&&!landmarkContains(b.center);
      if(b.shown===show)continue;
      b.shown=show;cover(b,show);
      for(const member of b.members)publish(member,show);
    }
    for(const m of added)publish(m,m.group!.shown);
    this.previous=visible;
    if(coverageChanged)this.revision++;
    return featureChanged;
  }
}
