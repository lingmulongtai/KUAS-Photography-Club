import { toLocal } from './geo.ts';

/** The old Osaka Bay shoreline through the river mouths, Suma to Kishiwada (lat, lon). */
const BAY_SHORE:readonly [number,number][]=[
  [34.640,135.110],[34.680,135.190],[34.710,135.340],[34.695,135.393],[34.695,135.405],[34.683,135.418],
  [34.655,135.410],[34.625,135.425],[34.597,135.452],[34.580,135.460],[34.470,135.360],
];
const shore = BAY_SHORE.map(([lat,lon])=>toLocal(lat,lon));

/** How far a river reach has become sea: 1 at the mouths, fading out 1.5-7 km upstream. */
export function tidalWeight(x:number,z:number){
  let best=Infinity;
  for(let i=0;i<shore.length-1;i++){
    const a=shore[i],b=shore[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
    best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
  }
  const k=Math.max(0,Math.min(1,(7000-best)/5500));
  return k*k*(3-2*k);
}
