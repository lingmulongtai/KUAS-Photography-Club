import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleText,upcomingEvents} from '../src/lib/schedule-display.ts';

test('schedule text uses an explicit English translation and otherwise preserves the original without a language label',()=>{
  assert.equal(scheduleText('写真部ミーティング','Photography club meeting','en'),'Photography club meeting');
  assert.equal(scheduleText('写真部ミーティング',undefined,'en'),'写真部ミーティング');
  assert.equal(scheduleText('休み',undefined,'en'),'休み');
  assert.equal(scheduleText('写真部ミーティング','Photography club meeting','ja'),'写真部ミーティング');
});

const event=(date,extra={})=>({date,title:'Meeting',kind:'meeting',...extra});

test('upcoming dates use JST at midnight, sort before limiting and leave the source intact',()=>{
  const events=[event('2026-11-28'),event('2026-11-26'),event('2026-11-27')];
  assert.deepEqual(upcomingEvents(events,new Date('2026-11-26T14:59:59Z'),2).map(e=>e.date),['2026-11-26','2026-11-27']);
  assert.deepEqual(upcomingEvents(events,new Date('2026-11-26T15:00:00Z'),2).map(e=>e.date),['2026-11-27','2026-11-28']);
  assert.equal(events[0].date,'2026-11-28');
});

test('a cached meeting disappears at its exclusive end, while later dates remain',()=>{
  const events=[event('2026-11-27',{endsAt:'2026-11-27T09:30:00Z'}),event('2026-12-04')];
  assert.equal(upcomingEvents(events,new Date('2026-11-27T09:29:59Z')).length,2);
  assert.deepEqual(upcomingEvents(events,new Date('2026-11-27T09:30:00Z')).map(e=>e.date),['2026-12-04']);
  assert.deepEqual(upcomingEvents(events,new Date('2026-12-04T15:00:00Z')),[]);
});

test('an ongoing overnight event remains on its current date until it ends',()=>{
  const events=['2026-11-27','2026-11-28'].map(date=>event(date,{endsAt:'2026-11-27T16:00:00Z'}));
  assert.deepEqual(upcomingEvents(events,new Date('2026-11-27T15:30:00Z')).map(e=>e.date),['2026-11-28']);
  assert.equal(upcomingEvents(events,new Date('2026-11-27T16:00:00Z')).length,0);
});
