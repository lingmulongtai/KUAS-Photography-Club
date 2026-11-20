import type { LiveSchedule } from '../lib/google-schedule';

/** One request per language and minute, however many parts of the page show the calendar. */
const cache = new Map<string, { at: number; request: Promise<LiveSchedule> }>();

export function loadSchedule(lang: 'ja' | 'en', fresh = false): Promise<LiveSchedule> {
  const hit = cache.get(lang);
  if (hit && !fresh && Date.now() - hit.at < 50000) return hit.request;
  const request = fetch(lang === 'en' ? '/api/schedule.json?lang=en' : '/api/schedule.json', { signal: AbortSignal.timeout(16000) })
    .then((response) => {
      if (!response.ok) throw new Error('unavailable');
      return response.json() as Promise<LiveSchedule>;
    });
  cache.set(lang, { at: Date.now(), request });
  request.catch(() => { if (cache.get(lang)?.request === request) cache.delete(lang); });
  return request;
}
