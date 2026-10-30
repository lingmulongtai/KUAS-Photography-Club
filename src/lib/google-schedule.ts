import ical from 'node-ical';
import { PUBLIC_CALENDAR_ICS } from '../data/public-calendar.ts';
import type { ScheduleEvent } from './schedule.ts';

export interface LiveSchedule { events:ScheduleEvent[]; updatedAt:string; from:string; to:string; translationStatus?:'complete'|'partial'; }
const jstDate = (date:Date) => new Date(+date+9*3600000).toISOString().slice(0,10);
const jstTime = (date:Date) => new Date(+date+9*3600000).toISOString().slice(11,16);
// node-ical represents floating DATE values at midnight in the host timezone.
const floatingDate = (date:Date) => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const plain = (value:unknown):string => {
  const raw=typeof value==='string'?value:value&&typeof value==='object'&&'val' in value?String(value.val):'';
  return raw.replace(/<[^>]*>/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,500);
};

/** A bounded year of dates. DATE values stay calendar dates; timed events use JST. */
export async function parseGoogleSchedule(text:string,now=new Date()):Promise<LiveSchedule> {
  if(!text.includes('BEGIN:VCALENDAR'))throw new Error('Invalid calendar');
  const today=jstDate(now),[year,month]=today.split('-').map(Number);
  const from=new Date(Date.UTC(year,month-1,1)-9*3600000);
  const to=new Date(Date.UTC(year,month+11,1)-9*3600000);
  const data=await ical.async.parseICS(text),events:ScheduleEvent[]=[];
  for(const component of Object.values(data)) {
    if(component?.type!=='VEVENT'||component.recurrenceid||component.status==='CANCELLED'||component.class==='PRIVATE'||component.class==='CONFIDENTIAL')continue;
    // A club schedule never needs hundreds of thousands of minute/second instances.
    if(component.rrule&&/FREQ=(SECONDLY|MINUTELY|HOURLY)/.test(component.rrule.toString()))throw new Error('Calendar recurrence frequency exceeds budget');
    for(const instance of ical.expandRecurringEvent(component,{from,to,includeOverrides:true,excludeExdates:true,expandOngoing:true})) {
      const event=instance.event;
      if(event.status==='CANCELLED'||event.class==='PRIVATE'||event.class==='CONFIDENTIAL')continue;
      const title=plain(instance.summary);
      if(!title)continue;
      const first=instance.isFullDay?floatingDate(instance.start):jstDate(instance.start);
      // End is exclusive for all-day events. Show ongoing multi-day events on each day.
      const last=instance.isFullDay?floatingDate(new Date(+instance.end-1)):jstDate(new Date(Math.max(+instance.start,+instance.end-1)));
      const endDate=jstDate(instance.end);
      const time=first===endDate
        ? jstTime(instance.start)+(+instance.end>+instance.start?'–'+jstTime(instance.end):'')
        : first+' '+jstTime(instance.start)+' – '+endDate+' '+jstTime(instance.end);
      const kind=/休会|中止|cancel/i.test(title)?'other':/ミーティング|定例|meeting/i.test(title)?'meeting':/撮影会|photo outing|photowalk/i.test(title)?'trip':/締切|deadline/i.test(title)?'deadline':'event';
      const visibleFirst=first<jstDate(from)?jstDate(from):first;
      for(let day=new Date(visibleFirst+'T00:00:00Z'),i=0;i<370&&day.toISOString().slice(0,10)<=last&&day.toISOString().slice(0,10)<jstDate(to);i++,day=new Date(+day+86400000)) {
        const date=day.toISOString().slice(0,10);
        if(date<jstDate(from)||date>=jstDate(to))continue;
        events.push({date,title,kind,...(!instance.isFullDay?{time}:{}),...(plain(event.location)?{place:plain(event.location)}:{})});
        if(events.length>2000)throw new Error('Calendar event limit exceeded');
      }
    }
  }
  // The organizer's confirmed cancellation remains authoritative if a repeating
  // calendar entry accidentally includes it. No other meetings are synthesized.
  if(today<='2026-10-23') {
    for(let i=events.length-1;i>=0;i--)if(events[i].date==='2026-10-23'&&events[i].kind==='meeting')events.splice(i,1);
    if(!events.some(e=>e.date==='2026-10-23'&&/休会|中止|cancel/i.test(e.title)))events.push({
      date:'2026-10-23',title:'龍尾祭準備のため、通常の定例ミーティングは休会',
      titleEn:'Regular meeting cancelled for campus festival preparations',kind:'other',
    });
  }
  const unique=[...new Map(events.map(e=>[JSON.stringify([e.date,e.title,e.time??'',e.place??'']),e])).values()];
  unique.sort((a,b)=>a.date.localeCompare(b.date)||(a.time??'').localeCompare(b.time??'')||a.title.localeCompare(b.title));
  return {events:unique,updatedAt:now.toISOString(),from:jstDate(from),to:jstDate(to)};
}

/** Fixed public source only: no caller-supplied URL, tokens or private ICS addresses. */
export async function fetchGoogleSchedule(now=new Date(),request:typeof fetch=fetch) {
  const response=await request(PUBLIC_CALENDAR_ICS,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok||!response.body)throw new Error('Public calendar unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>1024*1024)throw new Error('Calendar exceeds size limit');
      chunks.push(value);
    }
  }finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return parseGoogleSchedule(new TextDecoder().decode(bytes),now);
}
