import { parse, stringify } from 'yaml';

/* Markdown for trips and monthly schedules, in the same shape as the files in src/content/. */

export interface PhotoIn {
  /** file name inside public/photos/<slug>/, e.g. 03.jpg */
  name: string;
  alt: string;
  by: string;
  caption?: string;
  portrait?: boolean;
}

export interface TripIn {
  slug: string;
  title: string;
  date: string;
  place: string;
  members?: number | null;
  summary: string;
  body: string;
  photos: PhotoIn[];
}

export interface EventIn {
  date: string;
  title: string;
  kind: 'meeting' | 'trip' | 'event' | 'deadline' | 'other';
  time?: string;
  place?: string;
  note?: string;
  link?: string;
}

export interface ScheduleIn {
  month: string;
  weeklyMeeting: boolean;
  noMeeting: string[];
  events: EventIn[];
  /** Notes for the month, shown under the calendar. */
  notes?: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const FILE = /^[a-z0-9][a-z0-9-]{0,60}\.jpg$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const KINDS = ['meeting', 'trip', 'event', 'deadline', 'other'];

const text = (v: unknown, max: number, field: string, required = true) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new Error(`${field}を入力してください`);
  if (s.length > max) throw new Error(`${field}が長すぎます（${max}文字まで）`);
  return s;
};

export const photoPath = (slug: string, name: string) => `public/photos/${slug}/${name}`;
export const tripPath = (slug: string) => `src/content/trips/${slug}.md`;
export const schedulePath = (month: string) => `src/content/schedule/${month}.md`;

export function checkSlug(slug: unknown) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('URL 用の名前は半角英小文字・数字・ハイフンで入力してください');
  return slug;
}

function cleanPhotos(slug: string, photos: unknown) {
  if (!Array.isArray(photos)) throw new Error('写真がありません');
  return photos.map((p, i) => {
    const name = typeof p?.name === 'string' ? p.name : '';
    if (!FILE.test(name)) throw new Error(`写真 ${i + 1} のファイル名が正しくありません`);
    const out: Record<string, unknown> = {
      src: `/photos/${slug}/${name}`,
      alt: text(p.alt, 120, `写真 ${i + 1} の説明`),
      by: text(p.by, 40, `写真 ${i + 1} の撮影者`),
    };
    const caption = text(p.caption, 200, `写真 ${i + 1} のキャプション`, false);
    if (caption) out.caption = caption;
    if (p.portrait) out.portrait = true;
    return out;
  });
}

const markdown = (front: Record<string, unknown>, body: string) =>
  `---\n${stringify(front, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;

/** A new trip's Markdown file. */
export function tripMarkdown(input: TripIn) {
  const slug = checkSlug(input.slug);
  if (!DAY.test(input.date ?? '')) throw new Error('日付を YYYY-MM-DD で入力してください');
  const photos = cleanPhotos(slug, input.photos);
  if (!photos.length) throw new Error('写真を1枚以上追加してください');
  const front: Record<string, unknown> = {
    title: text(input.title, 60, 'タイトル'),
    date: input.date,
    place: text(input.place, 80, '場所'),
  };
  const members = Number(input.members);
  if (Number.isInteger(members) && members > 0) front.members = members;
  front.summary = text(input.summary, 140, 'ひとこと紹介');
  front.photos = photos;
  return markdown(front, text(input.body, 8000, '本文', false) || front.summary as string);
}

/** Front-matter entries for photos added to a trip, for the demo preview. */
export function photoEntries(slug: string, photos: PhotoIn[]) {
  return stringify({ photos: cleanPhotos(checkSlug(slug), photos) }, { lineWidth: 0 });
}

/** An existing trip's Markdown with more photos added to the end of its list. */
export function appendPhotos(md: string, slug: string, photos: PhotoIn[]) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('撮影会のファイルが読めませんでした');
  const front = parse(m[1]) as Record<string, unknown>;
  const list = Array.isArray(front.photos) ? front.photos : [];
  const added = cleanPhotos(checkSlug(slug), photos);
  if (!added.length) throw new Error('写真を1枚以上追加してください');
  front.photos = [...list, ...added];
  return markdown(front, m[2]);
}

/** A month's schedule file. */
export function scheduleMarkdown(input: ScheduleIn) {
  if (!MONTH.test(input.month ?? '')) throw new Error('月を YYYY-MM で入力してください');
  const inMonth = (d: string) => DAY.test(d) && d.startsWith(input.month);
  const noMeeting = (input.noMeeting ?? []).filter((d) => typeof d === 'string' && d);
  for (const d of noMeeting) if (!inMonth(d)) throw new Error(`お休みの日 ${d} がこの月ではありません`);
  const events = (input.events ?? []).map((e, i) => {
    if (!inMonth(e?.date ?? '')) throw new Error(`予定 ${i + 1} の日付がこの月ではありません`);
    const kind = KINDS.includes(e.kind) ? e.kind : 'event';
    const out: Record<string, unknown> = { date: e.date, title: text(e.title, 80, `予定 ${i + 1} の内容`), kind };
    for (const k of ['time', 'place', 'note', 'link'] as const) {
      const v = text(e[k], k === 'note' ? 300 : 120, `予定 ${i + 1}`, false);
      if (v) out[k] = v;
    }
    if (out.link && !/^(https?:\/\/|\/)/.test(out.link as string)) throw new Error(`予定 ${i + 1} のリンクは http(s):// か / で始めてください`);
    return out;
  });
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const front: Record<string, unknown> = { month: input.month };
  if (input.weeklyMeeting === false) front.weeklyMeeting = false;
  if (noMeeting.length) front.noMeeting = noMeeting.sort();
  front.events = events;
  return markdown(front, text(input.notes, 4000, 'お知らせ', false));
}
