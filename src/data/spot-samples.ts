import { SPOTS } from './spots.ts';
import type { HeroTrip } from '../scripts/hero/labels';

/** Neutral destinations keep map navigation available without presenting invented records or photos. */
export const SPOT_SAMPLES: HeroTrip[]=SPOTS.map(spot=>({
  spot:spot.id,title:`${spot.ja}の活動記録`,href:`/trips/spots/${spot.id}/`,
  src:'', alt:'',
  credit:'活動記録を準備中',sample:true,
}));

export function completeSpotPreviews(trips:HeroTrip[]):HeroTrip[] {
  return SPOT_SAMPLES.flatMap(sample=>{
    const related=trips.filter(t=>t.spot===sample.spot);
    const real=related.filter(t=>!t.sample);
    return real.length ? real : [sample];
  });
}
