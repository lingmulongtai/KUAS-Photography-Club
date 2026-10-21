import {rng} from './util.ts';

/**
 * Cloud characters. Each visit draws one low-cloud character plus its own amount of the two high
 * layers, so the sky mixes types instead of repeating one pattern:
 * 0 fair-weather cumulus, 1 a few small puffs under cirrus, 2 a broken stratocumulus deck,
 * 3 towering cumulus (congestus) with tall, sparse heads.
 */
export const CLOUD_STYLES=['cumulus','fair','stratocumulus','congestus'] as const;

/** One weather character per visit; deterministic seeds make it reproducible in QA. */
export function cloudWeather(seed:number) {
  const random=rng(seed),style=Math.floor(random()*CLOUD_STYLES.length);
  const cover=[.42,.3,.58,.34][style]+random()*.14;
  // cloud base and top of the low layer, metres
  const base=[1350,1500,1250,1300][style]+random()*250;
  const top=base+[1250,700,600,2600][style]*(.8+random()*.4);
  // high layers: cirrus streaks ~8 km up and an altocumulus field ~4.5 km up
  const cirrus=style===1?.7+random()*.3:random()<.55?random()*.9:0;
  const alto=style===2?0:random()<.4?.35+random()*.55:0;
  return {style,cover,base,top,cirrus,alto,
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
