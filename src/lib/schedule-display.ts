import type {ScheduleEvent} from './schedule.ts';

/** JST dates and exclusive calendar end instants keep the homepage current between refreshes. */
export function upcomingEvents(events:ScheduleEvent[],now=new Date(),count=4) {
  const today=new Date(+now+9*3600000).toISOString().slice(0,10);
  return events.filter(event=>event.date>=today&&(!event.endsAt||Date.parse(event.endsAt)>+now))
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.time??'').localeCompare(b.time??''))
    .slice(0,count);
}

/** Use an explicitly supplied translation, otherwise keep the original event text. */
export function scheduleText(original:string,english:string|undefined,lang:'ja'|'en') {
  return lang==='en' ? (english ?? original) : original;
}
