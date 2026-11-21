import {insideRing} from './island-mask.ts';
import type {GroundFeature} from './ground-relief-data.ts';

/** Exact farm interiors for the procedural forest. Crossing a relief tile
 * retains parcels that extend into the next tile and preserves holes and hedges. */
export function createFieldInteriors() {
  type Parcel = GroundFeature['paths'];
  const bins = new Map<number,Set<Parcel>>();
  const recent = new Map<string,{bin:number;parcel:Parcel}[]>();
  // The terrain spans fewer than 1,000 buckets in either direction.
  const binKey = (cx:number,cz:number) => cx*4096+cz;
  return {
    addCell(key:string, parcels:Parcel[]) {
      const known=recent.get(key);
      if(known){recent.delete(key);recent.set(key,known);return false;}
      const entries:{bin:number;parcel:Parcel}[]=[];
      for(const parcel of parcels) {
        const outer=parcel[0];
        let west=Infinity,north=Infinity,east=-Infinity,south=-Infinity;
        for(let i=0;i<outer.length;i+=2){
          west=Math.min(west,outer[i]);east=Math.max(east,outer[i]);
          north=Math.min(north,outer[i+1]);south=Math.max(south,outer[i+1]);
        }
        for(let cx=Math.floor(west/64);cx<=Math.floor(east/64);cx++){
          for(let cz=Math.floor(north/64);cz<=Math.floor(south/64);cz++){
            const bin=binKey(cx,cz);
            if(!bins.has(bin))bins.set(bin,new Set());
            bins.get(bin)!.add(parcel);entries.push({bin,parcel});
          }
        }
      }
      recent.set(key,entries);
      if(recent.size>128){
        const oldest=recent.keys().next().value!;
        for(const {bin,parcel} of recent.get(oldest)!){
          const bucket=bins.get(bin)!;
          bucket.delete(parcel);
          if(!bucket.size)bins.delete(bin);
        }
        recent.delete(oldest);
      }
      return parcels.length>0;
    },
    contains(x:number,z:number) {
      const bucket=bins.get(binKey(Math.floor(x/64),Math.floor(z/64)));
      if(bucket)for(const paths of bucket){
        if(insideRing(paths[0],x,z) && !paths.some((ring,i)=>i>0 && insideRing(ring,x,z)))return true;
      }
      return false;
    },
  };
}
