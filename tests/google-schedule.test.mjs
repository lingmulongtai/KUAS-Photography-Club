import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGoogleSchedule,fetchGoogleSchedule} from '../src/lib/google-schedule.ts';
const now=new Date('2026-11-01T00:00:00Z');
const calendar=(...events)=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events.map(e=>'BEGIN:VEVENT\r\n'+e.join('\r\n')+'\r\nEND:VEVENT\r\n').join('')+'END:VCALENDAR';

test('recurrences honor excluded dates and individually moved instances in JST',async()=>{
  const s=await parseGoogleSchedule(calendar(
    ['UID:weekly','DTSTAMP:20261001T000000Z','SUMMARY:Meeting','DTSTART:20261106T090000Z','DTEND:20261106T100000Z','RRULE:FREQ=WEEKLY;COUNT=3','EXDATE:20261113T090000Z'],
    ['UID:weekly','DTSTAMP:20261001T000000Z','RECURRENCE-ID:20261120T090000Z','SUMMARY:Moved meeting','DTSTART:20261120T110000Z','DTEND:20261120T120000Z'],
  ),now);
  assert.deepEqual(s.events.map(e=>[e.date,e.time]),[['2026-11-06','18:00–19:00'],['2026-11-20','20:00–21:00']]);
});
test('all-day end dates are exclusive and UTC timestamps roll into the JST date',async()=>{
  const s=await parseGoogleSchedule(calendar(
    ['UID:festival','DTSTAMP:20261001T000000Z','SUMMARY:Festival','DTSTART;VALUE=DATE:20261102','DTEND;VALUE=DATE:20261104'],
    ['UID:night','DTSTAMP:20261001T000000Z','SUMMARY:Night','DTSTART:20261103T180000Z','DTEND:20261103T190000Z'],
  ),now);
  assert.deepEqual(s.events.map(e=>e.date),['2026-11-02','2026-11-03','2026-11-04']);
  assert.equal(s.events[0].time,undefined);assert.equal(s.events[2].time,'03:00–04:00');
});
test('private and cancelled events and attendee details never enter the public response',async()=>{
  const base=['DTSTAMP:20261001T000000Z','DTSTART:20261106T090000Z','DTEND:20261106T100000Z'];
  const s=await parseGoogleSchedule(calendar(
    ['UID:secret','SUMMARY:Secret','CLASS:PRIVATE',...base],
    ['UID:cancelled','SUMMARY:Cancelled','STATUS:CANCELLED',...base],
    ['UID:ok','SUMMARY:<b>Open</b>','ATTENDEE:mailto:private@example.com','DESCRIPTION:Private note',...base],
  ),now);
  assert.equal(s.events.length,1);assert.equal(s.events[0].title,'Open');
  assert.ok(!JSON.stringify(s).includes('private'));assert.ok(!JSON.stringify(s).includes('note'));
});
test('the confirmed October 23 cancellation overrides an accidental regular meeting',async()=>{
  const s=await parseGoogleSchedule(calendar(['UID:meeting','DTSTAMP:20261001T000000Z','SUMMARY:定例ミーティング','DTSTART:20261023T090000Z','DTEND:20261023T100000Z']),new Date('2026-10-20T00:00:00Z'));
  assert.ok(!s.events.some(e=>e.date==='2026-10-23'&&e.kind==='meeting'));
  assert.ok(s.events.some(e=>e.date==='2026-10-23'&&e.titleEn));
});
test('upstream failure and oversized feeds fail closed',async()=>{
  await assert.rejects(fetchGoogleSchedule(now,async()=>new Response('',{status:403})));
  await assert.rejects(fetchGoogleSchedule(now,async()=>new Response('x'.repeat(1024*1024+1))));
});
