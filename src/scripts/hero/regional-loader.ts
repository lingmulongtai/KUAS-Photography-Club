import type {Box} from './geo.ts';

export interface CityRegion {
  id:string;
  box:Box;
  buildings:{meta:string;file:string};
  lines:{file:string;box:Box;q:number};
  photo:{box:Box;file:string;mobile:{file:string}};
}

/** One neighbouring area at a time; boundary points belong to the east/south area. */
export function regionAt(regions:readonly CityRegion[],p:{x:number;z:number}) {
  return regions.find(r=>p.x>=r.box[0]&&p.x<r.box[2]&&p.z>=r.box[1]&&p.z<r.box[3])??null;
}

/** Include the streets around the explorer and those visible ahead across a sheet boundary. */
export function regionInView(regions:readonly CityRegion[],eye:{x:number;z:number},bearing:number) {
  const inside=regionAt(regions,eye);
  if(inside)return inside;
  const yaw=bearing*Math.PI/180;
  const aheadX=eye.x+1700*Math.sin(yaw),aheadZ=eye.z-1700*Math.cos(yaw);
  const distance=(x:number,z:number,[west,north,east,south]:Box)=>
    Math.hypot(Math.max(west-x,0,x-east),Math.max(north-z,0,z-south));
  let nearest:CityRegion|null=null,best=Infinity;
  for(const region of regions){
    const around=distance(eye.x,eye.z,region.box),ahead=distance(aheadX,aheadZ,region.box);
    if(around>1200 && ahead>1450)continue;
    const score=around+ahead*.5;
    if(score<best){nearest=region;best=score;}
  }
  return nearest;
}

/** Keep the visible city during a serial download/build. Release it immediately before
 * the new city installs its shared terrain textures. Failed loads can be retried. */
export function createRegionalLoader<T extends {dispose():void}>(
  load:(region:CityRegion)=>Promise<T>,
  activate:(region:CityRegion,data:T,current:()=>boolean,releasePrevious:()=>void)=> (()=>void) | Promise<()=>void>,
  onError:(error:unknown)=>void,
) {
  let wanted:CityRegion|null=null;
  let active:{id:string;dispose():void}|null=null;
  let running:Promise<void>|null=null;
  const releasePrevious=()=>{active?.dispose();active=null;};
  let revision=0,settledRevision=0;
  // One speculative dataset at most, and no parallel regional downloads/decodes.
  let downloading:Promise<unknown>=Promise.resolve();
  let warm:{id:string;promise:Promise<T>;claimed:boolean;released:boolean}|null=null;
  const serialLoad=(region:CityRegion)=>{
    const next=downloading.then(()=>load(region));
    downloading=next.catch(()=>{});
    return next;
  };
  const take=(region:CityRegion)=>{
    if(warm?.id===region.id){const entry=warm;warm=null;entry.claimed=true;return entry.promise;}
    return serialLoad(region);
  };
  async function pump() {
    try {
    while(wanted?.id!==active?.id) {
      const next=wanted;
      if(!next){releasePrevious();return;}
      let data:T;
      try {data=await take(next);} catch(error) {
        onError(error);
        if(wanted?.id!==next.id)continue;
        return;
      }
      if(wanted?.id!==next.id){data.dispose();continue;}
      try {
        const dispose=await activate(next,data,()=>wanted?.id===next.id,releasePrevious);
        if(wanted?.id!==next.id){dispose();continue;}
        releasePrevious();
        active={id:next.id,dispose};
      } catch(error){data.dispose();if(wanted?.id!==next.id)continue;onError(error);return;}
    }
    } finally {settledRevision=revision;}
  }
  function start():Promise<void> {
    running=pump().then(()=>{
      running=null;
      // A request can arrive after pump settles but before this continuation runs.
      if(revision!==settledRevision && wanted?.id!==active?.id)return start();
    });
    return running;
  }
  return {
    prefetch(region:CityRegion) {
      if(region.id===active?.id||region.id===wanted?.id||region.id===warm?.id)return;
      const entry={id:region.id,promise:serialLoad(region),claimed:false,released:false};
      const previous=warm;warm=entry;
      if(previous)previous.promise.then(data=>{if(!previous.claimed&&!previous.released){previous.released=true;data.dispose();}},()=>{});
      void entry.promise.then(data=>{if(warm!==entry&&!entry.claimed&&!entry.released){entry.released=true;data.dispose();}})
        .catch(error=>{if(warm===entry)warm=null;if(!entry.claimed)onError(error);});
    },
    request(region:CityRegion|null) {
      wanted=region;
      revision++;
      if(!running)return start();
      return running;
    },
    get id(){return active?.id??null;},
  };
}
