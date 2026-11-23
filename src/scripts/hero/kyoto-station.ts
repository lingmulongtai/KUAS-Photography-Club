/** Origin of the station survey (public/kyoto/kyoto-station-district*.glb) in the hero's frame. */
export const STATION_CENTER={x:-96.23,z:1957.7};
/** The mapped main block, drawn by the survey model and kept only as its fallback footprint. */
export function replacesKyotoStation(ring:Float32Array){
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<ring.length;i+=2){b[0]=Math.min(b[0],ring[i]);b[1]=Math.min(b[1],ring[i+1]);b[2]=Math.max(b[2],ring[i]);b[3]=Math.max(b[3],ring[i+1]);}
  return [-335.2,1911.35,142.74,2004.04].every((v,i)=>Math.abs(v-b[i])<2);
}

/** The survey draws its plaza layers in flat display colours: white kerbs and
 * paving, mid-grey carriageway and a bright planting green. Classify them so
 * they can take the same asphalt and paving as the terrain's street field. */
export function plazaSurface(source:{name:string;color:{r:number;g:number;b:number}}){
  if(!source.name.startsWith('Plaza-'))return 0;
  const {r,g,b}=source.color;
  if(g>r*1.3&&g>b*1.3)return 3;
  return r+g+b>2.1?2:1;
}
