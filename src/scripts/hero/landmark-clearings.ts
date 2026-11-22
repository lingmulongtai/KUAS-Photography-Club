import {inRing,type Ring} from '../kansai/coordinates.ts';
import {toLocal} from './geo.ts';

interface Parcel {ring:Ring;west:number;north:number;east:number;south:number}
// Index surveyed building footprints once, including the crowns immediately beside the walls.
export function landmarkClearings(sites:{rings:Ring[];approaches?:Ring[]}[]){
  const cells=new Map<number,Parcel[]>();
  const cell=(m:number)=>Math.floor(m/128);
  const key=(col:number,row:number)=>col*65536+row;
  const margin=3;
  for(const site of sites)for(const polygon of [...site.rings,...(site.approaches??[])]){
    if(polygon.length<3)continue;
    const ring:Ring=polygon.map(([lon,lat])=>{const p=toLocal(lat,lon);return [p.x,p.z];});
    const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
    const parcel={ring,west:Math.min(...xs)-margin,east:Math.max(...xs)+margin,north:Math.min(...zs)-margin,south:Math.max(...zs)+margin};
    for(let c=cell(parcel.west);c<=cell(parcel.east);c++)for(let r=cell(parcel.north);r<=cell(parcel.south);r++){
      const k=key(c,r),group=cells.get(k);
      if(group)group.push(parcel);else cells.set(k,[parcel]);
    }
  }
  return (x:number,z:number)=>{
    const parcels=cells.get(key(cell(x),cell(z)));
    if(!parcels)return false;
    for(const {ring,west,east,north,south} of parcels){
      if(x<west||x>east||z<north||z>south)continue;
      if(inRing([x,z],ring))return true;
      for(let i=0;i<ring.length;i++){
        const [ax,az]=ring[i],[bx,bz]=ring[(i+1)%ring.length],dx=bx-ax,dz=bz-az;
        const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
        if((x-ax-t*dx)**2+(z-az-t*dz)**2<=margin**2)return true;
      }
    }
    return false;
  };
}
