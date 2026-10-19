import {rng} from './util.ts';

/** One weather character per visit; deterministic seeds make it reproducible in QA. */
export function cloudWeather(seed:number) {
  const random=rng(seed),style=Math.floor(random()*3);
  return {style,cover:(style===2?.56:.44)+random()*.16,
    offset:[random()*256,random()*256] as const,
    wind:[.0005+random()*.0005,(random()-.5)*.0008] as const};
}

/** Continuous drift plus the displayed time's travel, including midnight crossings. */
export function createCloudClock() {
  let previous:number|null=null,seconds=0;
  return {
    step(minutes:number,dt:number,reducedMotion=false) {
      const delta=previous===null?0:((minutes-previous+720)%1440+1440)%1440-720;
      previous=minutes;
      if(!reducedMotion)seconds+=Math.max(0,Math.min(.2,dt))+delta*60;
      else if(Math.abs(delta)>.5)seconds+=delta*60;
      return seconds;
    },
  };
}
