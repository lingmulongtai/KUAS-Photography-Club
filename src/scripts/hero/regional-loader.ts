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

/** Serial loading bounds memory even when destinations change faster than downloads finish.
 * A stale result is released without constructing its city. Failed loads can be retried. */
export function createRegionalLoader<T extends {dispose():void}>(
  load:(region:CityRegion)=>Promise<T>,
  activate:(region:CityRegion,data:T)=> (()=>void) | Promise<()=>void>,
  onError:(error:unknown)=>void,
) {
  let wanted:CityRegion|null=null;
  let active:{id:string;dispose():void}|null=null;
  let running:Promise<void>|null=null;
  async function pump() {
    while(wanted?.id!==active?.id) {
      const next=wanted;
      active?.dispose();active=null;
      if(!next) return;
      let data:T;
      try {data=await load(next);} catch(error) {
        onError(error);
        if(wanted?.id!==next.id)continue;
        return;
      }
      if(wanted?.id!==next.id){data.dispose();continue;}
      try {
        const dispose=await activate(next,data);
        if(wanted?.id!==next.id){dispose();continue;}
        active={id:next.id,dispose};
      } catch(error){data.dispose();onError(error);if(wanted?.id!==next.id)continue;return;}
    }
  }
  return {
    request(region:CityRegion|null) {
      wanted=region;
      if(!running)running=pump().finally(()=>{running=null;});
      return running;
    },
    get id(){return active?.id??null;},
  };
}
