import { SPOTS } from './spots.ts';
import type { HeroTrip } from '../scripts/hero/labels';

/** Design placeholders only: no invented dates, participants or field photographs. */
export const SPOT_SAMPLES: HeroTrip[]=SPOTS.map(spot=>({
  spot:spot.id,title:`${spot.ja}の撮影イメージ`,href:`/trips/spots/${spot.id}/`,
  src:'/photos/samples/kawaramachi-night/01.jpg',
  alt:'構図確認用の夜景イラスト。この場所で撮影した写真ではありません。',
  credit:'イメージ用サンプル · 実際の撮影会記録は準備中',sample:true,
}));

export function completeSpotPreviews(trips:HeroTrip[]):HeroTrip[] {
  return SPOT_SAMPLES.flatMap(sample=>{
    const related=trips.filter(t=>t.spot===sample.spot);
    const real=related.filter(t=>!t.sample);
    return real.length ? real : related.length ? related : [sample];
  });
}
