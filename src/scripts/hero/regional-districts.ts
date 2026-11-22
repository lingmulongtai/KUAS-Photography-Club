import {loadTexture,type GridMeta} from './data';
import type {Box} from './geo';
import type {RegionalPhoto} from './regional-photo';

export interface District {id:string;box:Box;file:string;zoom:number;grid?:GridMeta}

export function districtImagery(districts:District[],aniso:number,onChange:(broad:RegionalPhoto|null,inset:RegionalPhoto|null)=>void){
  const entries=districts.map(record=>({...record,sheet:null as RegionalPhoto|null,pending:false,retry:0,distance:Infinity}));
  let broad:RegionalPhoto|null=null,inset:RegionalPhoto|null=null;
  return (x:number,z:number,now:number)=>{
    for(const e of entries){
      const [w,n,r,s]=e.box;
      e.distance=Math.hypot(Math.max(0,w-x,x-r),Math.max(0,n-z,z-s));
    }
    entries.sort((a,b)=>a.distance-b.distance);
    const wide=entries.find(e=>e.zoom<=15 && e.distance<14500);
    const close=entries.find(e=>e.zoom>15 && e.distance<3000);
    for(const e of [wide,close]){
      if(!e||e.sheet||e.pending||now<e.retry)continue;
      e.pending=true;
      void loadTexture(e.file,aniso).then(photo=>{e.sheet={photo,box:e.box};})
        .catch(()=>{e.retry=performance.now()/1000+12;}).finally(()=>{e.pending=false;});
    }
    if(broad!==(wide?.sheet??null)||inset!==(close?.sheet??null)){
      broad=wide?.sheet??null;inset=close?.sheet??null;onChange(broad,inset);
    }
    for(const e of entries)if(e.sheet && e.distance>(e.zoom>15?6500:19000)){
      e.sheet.photo.dispose();e.sheet=null;
    }
    return !!close && close.distance<150;
  };
}
