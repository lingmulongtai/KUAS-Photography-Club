import type { ScheduleEvent } from './schedule.ts';

/**
 * What the club calendar says about the next regular meeting. Only dated calendar entries count:
 * the usual weekly time is never turned into a confirmed date here.
 */
export type NextMeeting =
  | { state: 'meeting'; date: string; time?: string; place?: string; moved: boolean }
  | { state: 'cancelled'; date: string }
  | { state: 'unknown' };

const CANCELLED = /休会|中止|cancel/i;

/** Today in Kyoto, as YYYY-MM-DD. */
export const kyotoDay = (now: Date) => new Date(+now + 9 * 3600000).toISOString().slice(0, 10);

/**
 * The nearest meeting or meeting cancellation from today on. A cancellation on the same day as a
 * meeting entry wins, so a repeating calendar entry cannot hide it. `room` is the usual room: a
 * meeting held elsewhere is marked as moved.
 */
export function nextMeeting(events: readonly ScheduleEvent[], today: string, room: string): NextMeeting {
  const upcoming = events.filter((e) => e.date >= today);
  const cancelled = new Set(upcoming.filter((e) => e.kind !== 'meeting' && CANCELLED.test(e.title)).map((e) => e.date));
  const meetings = upcoming.filter((e) => e.kind === 'meeting' && !CANCELLED.test(e.title));
  const dates = [...new Set([...cancelled, ...meetings.map((e) => e.date)])].sort();
  const date = dates[0];
  if (!date) return { state: 'unknown' };
  if (cancelled.has(date)) return { state: 'cancelled', date };
  const meeting = meetings.find((e) => e.date === date)!;
  const time = meeting.time?.match(/\d{1,2}:\d{2}/)?.[0];
  const place = meeting.place?.trim() || undefined;
  return { state: 'meeting', date, time, place, moved: !!place && !place.toUpperCase().includes(room.toUpperCase()) };
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 11/21(金) or Fri 21 Nov. */
export function meetingDay(date: string, lang: 'ja' | 'en') {
  const day = new Date(`${date}T00:00:00Z`);
  if (lang === 'en') return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(day);
  return `${day.getUTCMonth() + 1}/${day.getUTCDate()}(${WEEKDAY_JA[day.getUTCDay()]})`;
}
