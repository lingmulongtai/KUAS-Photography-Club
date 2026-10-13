import { getCollection, type CollectionEntry } from 'astro:content';
import { club } from '../data/club';

export type Trip = CollectionEntry<'trips'>;
export type TripPhoto = Trip['data']['photos'][number];

/** All trips, newest first. */
export async function getTrips(): Promise<Trip[]> {
  const trips = await getCollection('trips');
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
