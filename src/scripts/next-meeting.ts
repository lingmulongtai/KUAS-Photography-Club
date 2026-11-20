import { loadSchedule } from './live-schedule';
import { kyotoDay, meetingDay, nextMeeting, type NextMeeting } from '../lib/next-meeting';

/**
 * Fills `[data-next-meeting]` from the club calendar. The server-rendered text (the usual weekly
 * time) stays whenever the calendar has nothing dated or cannot be reached.
 *
 * data-next-meeting="chip" for the hero, "card" for the meeting card; data-lang; data-room.
 */
function text(next: NextMeeting, lang: 'ja' | 'en', kind: string, room: string) {
  const en = lang === 'en';
  if (next.state === 'cancelled') return en ? `No meeting on ${meetingDay(next.date, 'en')}` : `${meetingDay(next.date, 'ja')}は休会です`;
  if (next.state !== 'meeting') return null;
  const day = meetingDay(next.date, lang);
  const time = next.time ? ` ${next.time}` : '';
  // the usual room, short enough for the chip; the full place only when the meeting has moved
  const where = next.moved ? (en ? ` · Room change: ${next.place}` : ` · 教室変更：${next.place}`) : room ? ` · ${room}` : '';
  if (kind === 'card') return en ? `Next: ${day}${time}${where}` : `次回 ${day}${time}${where}`;
  return en ? `Next meeting ${day}${time}${where}` : `次のミーティング ${day}${time}${where}`;
}

const nodes = [...document.querySelectorAll<HTMLElement>('[data-next-meeting]')];
async function refresh() {
  for (const lang of ['ja', 'en'] as const) {
    const mine = nodes.filter((node) => (node.dataset.lang === 'en' ? 'en' : 'ja') === lang);
    if (!mine.length) continue;
    try {
      const data = await loadSchedule(lang);
      for (const node of mine) {
        const room = node.dataset.room ?? '';
        const next = nextMeeting(data.events, kyotoDay(new Date()), room);
        const label = text(next, lang, node.dataset.nextMeeting ?? 'chip', room);
        const target = node.querySelector<HTMLElement>('[data-next-text]') ?? node;
        if (label) target.textContent = label;
        node.dataset.state = label ? next.state : 'usual';
        if (node.hasAttribute('data-hide-usual')) node.hidden = !label;
      }
    } catch { /* keep the usual weekly time */ }
  }
}
if (nodes.length) {
  void refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
}
