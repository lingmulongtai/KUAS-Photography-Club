import type {Box} from './geo';

export interface PhotoSheet {box:Box;file:string;mobile:{file:string}}
const contains=(b:Box,p:{x:number;z:number})=>p.x>=b[0]&&p.x<b[2]&&p.z>=b[1]&&p.z<b[3];

/** Keep one displayed sheet and one nearby sheet, with serial bounded downloads. */
export function createNearbyPhotos<T>(index:()=>Promise<PhotoSheet[]>,load:(sheet:PhotoSheet)=>Promise<T>,
  apply:(value:T|null)=>void,dispose:(value:T)=>void,onError:(error:unknown)=>void) {
  let manifest:Promise<PhotoSheet[]>|undefined,tail:Promise<unknown>=Promise.resolve();
  let revision=0,active:string|null=null,desired:string|null=null;
  const cache=new Map<string,{promise:Promise<T>;released:boolean}>();
  const sheets=()=>manifest??=index().catch(error=>{manifest=undefined;throw error;});
  const release=(key:string)=>{const entry=cache.get(key);if(!entry)return;cache.delete(key);
    void entry.promise.then(value=>{if(!entry.released){entry.released=true;dispose(value);}},()=>{});};
  const get=(sheet:PhotoSheet)=>{
    const existing=cache.get(sheet.file);if(existing)return existing.promise;
    const entry={promise:tail.then(()=>load(sheet)),released:false};
    tail=entry.promise.catch(()=>{});cache.set(sheet.file,entry);
    for(const key of cache.keys())if(cache.size>2&&key!==active&&key!==desired&&key!==sheet.file)release(key);
    void entry.promise.catch(()=>{if(cache.get(sheet.file)===entry)cache.delete(sheet.file);});
    return entry.promise;
  };
  return {
    update(center:{x:number;z:number}|null) {
      const request=++revision,target=center?{...center}:null;desired=null;
      if(!target){active=null;apply(null);return Promise.resolve();}
      return sheets().then(async list=>{
        if(request!==revision)return;
        const sheet=list.find(s=>contains(s.box,target));
        if(!sheet){active=null;apply(null);return;}
        desired=sheet.file;
        if(active===sheet.file)return;
        const value=await get(sheet);
        if(request!==revision)return;
        active=sheet.file;apply(value);
      }).catch(onError);
    },
    prefetch(center:{x:number;z:number}) {
      const target={...center};
      return sheets().then(async list=>{
        const distance=(b:Box)=>Math.hypot(Math.max(b[0]-target.x,0,target.x-b[2]),Math.max(b[1]-target.z,0,target.z-b[3]));
        const sheet=list.reduce<PhotoSheet|undefined>((best,s)=>!best||distance(s.box)<distance(best.box)?s:best,undefined);
        if(sheet){
          if(!cache.has(sheet.file)&&[...cache.keys()].filter(key=>key===active||key===desired).length>=2)return;
          await get(sheet);
        }
      }).catch(onError);
    },
  };
}
