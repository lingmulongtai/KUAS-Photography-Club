import type { ScheduleEvent } from './schedule.ts';

const compact = (date: string) => date.replaceAll('-', '');
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * A Google Calendar "add event" link for one schedule entry, in Kyoto time. A single-day time
 * (18:00 or 18:00–20:00) becomes a timed event; anything else becomes an all-day entry.
 */
export function addToCalendarUrl(event: Pick<ScheduleEvent, 'date' | 'title' | 'time' | 'place'>, details = '') {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.title);
  const span = event.time?.match(/^(\d{1,2}):(\d{2})(?:\s*[–-]\s*(\d{1,2}):(\d{2}))?$/);
  if (span) {
    const [, h1, m1, h2, m2] = span;
    const start = `${compact(event.date)}T${h1.padStart(2, '0')}${m1}00`;
    // an open-ended start gets an hour, the length of a meeting
    const endHour = h2 ?? String(Math.min(23, Number(h1) + 1));
    const end = `${compact(event.date)}T${endHour.padStart(2, '0')}${h2 ? m2 : m1}00`;
    url.searchParams.set('dates', `${start}/${end}`);
    url.searchParams.set('ctz', 'Asia/Tokyo');
  } else {
    url.searchParams.set('dates', `${compact(event.date)}/${compact(nextDay(event.date))}`);
  }
  if (event.place) url.searchParams.set('location', event.place);
  if (details) url.searchParams.set('details', details);
  return url.href;
}
