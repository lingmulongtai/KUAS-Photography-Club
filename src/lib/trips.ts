import { getCollection, type CollectionEntry } from 'astro:content';
import { club } from '../data/club';
import { isPublicContent } from './public-content';

export type Trip = CollectionEntry<'trips'>;
export type TripPhoto = Trip['data']['photos'][number];

/** All trips, newest first. */
export async function getTrips(): Promise<Trip[]> {
  const trips = await getCollection('trips', isPublicContent);
  return trips.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export const formatDate = (d: Date) =>
  `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

export const formatDateJa = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

/** Credit line required by the club guidelines (§6). */
export const credit = (photo: TripPhoto, date: Date) => `© ${photo.by} / ${club.name}（${date.getFullYear()}）`;

/** Photos for film strips: newest trips first, spread over up to three strips. */
export function stripsFrom(trips: Trip[], perStrip = 8, count = 3) {
  const all = trips.flatMap((t) => t.data.photos.map((p) => ({ src: p.src, date: t.data.date, portrait: p.portrait })));
  const strips = Array.from({ length: count }, (_, i) => all.slice(i * perStrip, (i + 1) * perStrip));
  return strips.filter((s) => s.length > 0);
}

/**
 * Photos for the reel at the top of the trips page, taking one photo from each trip in turn so
 * neighbouring cards come from different outings. With no published trips yet, the design
 * sample photos stand in (unlinked, and the page says so).
 */
export async function reelPhotos(lang: 'ja' | 'en' = 'ja') {
  const toCards = (trips: Trip[], linked: boolean) => {
    const lists = trips.map((t) =>
      t.data.photos.map((p) => ({
        src: p.src,
        alt: p.alt,
        title: t.data.title,
        // samples carry no date: they are not records of an outing
        meta: linked ? `${formatDate(t.data.date)} · ${t.data.place}` : t.data.place,
        href: linked ? `/trips/${t.id}/` : undefined,
      })),
    );
    const out = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
    return out;
  };
  const published = await getTrips();
  if (published.length) return { photos: toCards(published, true), sample: false };
  const samples = (await getCollection('trips', (e) => e.data.sample === true && e.data.draft !== true)).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  const photos = toCards(samples, false).map((p) => ({ ...p, title: lang === 'en' ? 'Sample photo' : 'サンプル写真' }));
  return { photos, sample: true };
}
