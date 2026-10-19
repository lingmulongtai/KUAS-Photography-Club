import {rng} from './util.ts';

/** One weather character per visit; deterministic seeds make it reproducible in QA. */
export function cloudWeather(seed:number) {
  const random=rng(seed),style=Math.floor(random()*3);
  return {style,cover:(style===2?.56:.44)+random()*.16,
    offset:[random()*256,random()*256] as const,
    wind:[.0005+random()*.0005,(random()-.5)*.0008] as const};
}

/** Continuous drift plus cumulative user-requested time travel, never the live clock. */
export function createCloudClock() {
  let previous=0,seconds=0;
  return {
    step(travelMinutes:number,dt:number,reducedMotion=false) {
      const delta=travelMinutes-previous;previous=travelMinutes;
      seconds+=delta*60+(reducedMotion?0:Math.max(0,Math.min(.2,dt)));
      return seconds;
    },
  };
}
