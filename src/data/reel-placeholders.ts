import { SPOTS } from './spots.ts';

/** A card on the trips page reel: a photo, or a drawn placeholder for a place. */
export interface ReelCard {
  src?: string;
  /** CSS background for a drawn card */
  art?: string;
  alt: string;
  title: string;
  meta: string;
  href?: string;
}

/** Colour washes for the drawn cards, after Kyoto's seasons and streets. */
const WASHES = [
  'linear-gradient(165deg, #f6c9c2 0%, #d98a9a 48%, #5b3f63 100%)', // cherry blossom at dusk
  'linear-gradient(165deg, #f3c27a 0%, #c9553a 52%, #3a1f24 100%)', // maple
  'linear-gradient(165deg, #9fd7d9 0%, #3a9ca6 50%, #16343c 100%)', // the Kamo river
  'linear-gradient(165deg, #8fa7e0 0%, #3d4f99 50%, #121633 100%)', // night
  'linear-gradient(165deg, #cfe0a8 0%, #6f9a55 50%, #1f3324 100%)', // moss garden
  'linear-gradient(165deg, #ffb27a 0%, #e0472f 50%, #4a1610 100%)', // torii vermilion
  'linear-gradient(165deg, #f7e2a8 0%, #d39a3c 52%, #3d2a12 100%)', // gold leaf
  'linear-gradient(165deg, #e6eef0 0%, #9fb4bb 50%, #33464c 100%)', // winter
];

/**
 * Until outings are published the reel shows the places the club photographs, as drawn cards
 * linking to their neutral spot pages. No photographs, no invented records.
 */
export function spotPlaceholders(lang: 'ja' | 'en' = 'ja'): ReelCard[] {
  return SPOTS.filter((s) => s.rank <= 3).map((s, i) => ({
    art: WASHES[i % WASHES.length],
    alt: '',
    title: lang === 'en' ? s.en : s.ja,
    meta: lang === 'en' ? 'Records coming soon' : '記録を準備中',
    href: `/trips/spots/${s.id}/`,
  }));
}
