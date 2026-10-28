export interface RailwayRoute {
  id:string;points:[number,number][];states:number[];tracks:number[];
  stations:{code:string;distance:number}[];color:string;cars:number;carLength:number;
}

/** Shared geometry/vehicle alignment; source states never become guessed tunnel shortcuts. */
export function railwayPath(route:RailwayRoute,ground:(x:number,z:number)=>number){
  const distances=[0];
  for(let i=1;i<route.points.length;i++)distances.push(distances[i-1]+Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]));
  const raw=route.points.map(([x,z],i)=>ground(x,z)+(route.states[Math.min(i,route.states.length-1)]===1?6:0));
  // Approximate vertical alignment only. The DEM is not a surveyed rail elevation.
  const heights=raw.map((_,i)=>{
    let sum=0,n=0;for(let j=Math.max(0,i-5);j<=Math.min(raw.length-1,i+5);j++){sum+=raw[j];n++;}return sum/n+.22;
  });
  const length=distances.at(-1)!;
  function at(distance:number){
    const d=Math.max(0,Math.min(length,distance));let lo=0,hi=distances.length-2;
    while(lo<hi){const m=Math.ceil((lo+hi)/2);if(distances[m]<=d)lo=m;else hi=m-1;}
    const i=lo,a=route.points[i],b=route.points[i+1],span=distances[i+1]-distances[i],t=(d-distances[i])/(span||1);
    return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,y:heights[i]+(heights[i+1]-heights[i])*t,
      dx:(b[0]-a[0])/(span||1),dz:(b[1]-a[1])/(span||1),visible:route.states[i]<2,state:route.states[i],tracks:route.tracks[i]};
  }
  return {length,distances,heights,at};
}

/** Keep a bounded fleet, spaced far enough apart along each route. */
export function trainSections(length:number,span:number) {
  return Math.max(1,Math.min(8,Math.floor(length/3000),Math.floor(length/(span+4))));
}

/** Trains follow the whole route; disappear only near its ends before restarting. */
export function serviceTrainProgress(time:number,length:number,span:number,speed:number,index:number,count:number,direction:1|-1) {
  const low=span/2+2,high=Math.max(low,length-span/2-2),range=high-low;
  if(!range)return {distance:low,direction,visible:false};
  const phase=((time*speed+index*range/count)%range+range)%range;
  const margin=span/2+15;
  return {distance:direction===1?low+phase:high-phase,direction,visible:phase>margin&&phase<range-margin};
}
