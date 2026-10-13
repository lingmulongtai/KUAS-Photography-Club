import { getCollection, render, type CollectionEntry } from 'astro:content';
import { club } from '../data/club';

export type EventKind = 'meeting' | 'trip' | 'event' | 'deadline' | 'other';

export interface ScheduleEvent {
  date: string;
  title: string;
  kind: EventKind;
  time?: string;
  place?: string;
  note?: string;
  link?: string;
}

export interface ScheduleMonth {
  id: string;
  year: number;
  month: number;
  sample: boolean;
  events: ScheduleEvent[];
  entry: CollectionEntry<'schedule'>;
}

export const kindLabel: Record<EventKind, string> = {
  meeting: 'ミーティング',
  trip: '撮影会',
  event: 'イベント',
  deadline: '締切',
  other: 'お知らせ',
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Day of week for a YYYY-MM-DD string (0 = Sunday), independent of the build machine's time zone. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const weekdayJa = (date: string) => WEEKDAYS[weekday(date)];
export const formatDay = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${weekdayJa(date)}）`;
};

function expand(entry: CollectionEntry<'schedule'>): ScheduleMonth {
  const [year, month] = entry.data.month.split('-').map(Number);
  const events: ScheduleEvent[] = entry.data.events.map((e) => ({ ...e }));
  if (entry.data.weeklyMeeting) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const date = `${year}-${pad(month)}-${pad(d)}`;
      if (weekday(date) !== 5 || entry.data.noMeeting.includes(date)) continue;
      events.push({
        date,
        title: '定例ミーティング',
        kind: 'meeting',
        time: club.meetings.times.join(' / '),
        place: `${club.campus} ${club.meetings.room}`,
      });
    }
  }
  events.sort((a, b) => (a.date === b.date ? (a.kind === 'meeting' ? -1 : 1) : a.date < b.date ? -1 : 1));
  return { id: entry.id, year, month, sample: entry.data.sample, events, entry };
}

/** Every month on file, oldest first. */
export async function getSchedule(): Promise<ScheduleMonth[]> {
  const entries = await getCollection('schedule');
  return entries.map(expand).sort((a, b) => (a.entry.data.month < b.entry.data.month ? -1 : 1));
}

export async function renderNotes(m: ScheduleMonth) {
  return render(m.entry);
}

/** Calendar cells for a month, weeks starting on Monday. Null cells pad the first and last week. */
export function calendarCells(year: number, month: number) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = weekday(`${year}-${pad(month)}-01`);
  const lead = (first + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
