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

/** A complete consist reverses only after stopping at an end; no teleporting at wraparound. */
export function trainProgress(time:number,length:number,span:number,speed:number){
  const low=span/2+2,high=Math.max(low,length-span/2-2),travel=(high-low)/speed,pause=12;
  const cycle=2*(travel+pause),t=((time%cycle)+cycle)%cycle;
  if(t<travel)return {distance:low+t*speed,direction:1};
  if(t<travel+pause)return {distance:high,direction:1};
  if(t<2*travel+pause)return {distance:high-(t-travel-pause)*speed,direction:-1};
  return {distance:low,direction:-1};
}

/** Divide a long route into bounded sections so illustrative trains never meet on one track. */
export function trainSections(length:number,span:number) {
  return Math.max(1,Math.min(8,Math.floor(length/3000),Math.floor(length/(span+4))));
}

export function sectionTrainProgress(time:number,length:number,span:number,speed:number,index:number,count:number) {
  const section=length/count,progress=trainProgress(time,section,span,speed);
  return {...progress,distance:index*section+progress.distance};
}
