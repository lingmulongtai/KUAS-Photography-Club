import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addToCalendarUrl} from '../src/lib/calendar-link.ts';

const params=url=>Object.fromEntries(new URL(url).searchParams);
test('a timed event keeps its Kyoto start and end',()=>{
  const p=params(addToCalendarUrl({date:'2026-11-21',title:'定例ミーティング',time:'18:00–20:00',place:'S306'},'KUAS Photography Club'));
  assert.equal(p.action,'TEMPLATE');assert.equal(p.text,'定例ミーティング');
  assert.equal(p.dates,'20261121T180000/20261121T200000');assert.equal(p.ctz,'Asia/Tokyo');
  assert.equal(p.location,'S306');assert.equal(p.details,'KUAS Photography Club');
});
test('a start time alone gets an hour; no time, or a multi-day span, becomes all-day',()=>{
  assert.equal(params(addToCalendarUrl({date:'2026-11-21',title:'x',time:'9:30'})).dates,'20261121T093000/20261121T103000');
  assert.equal(params(addToCalendarUrl({date:'2026-12-31',title:'x'})).dates,'20261231/20270101');
  assert.equal(params(addToCalendarUrl({date:'2026-11-21',title:'x',time:'2026-11-21 10:00 – 2026-11-22 12:00'})).dates,'20261121/20261122');
});
