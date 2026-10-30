import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleText} from '../src/lib/schedule-display.ts';

test('schedule text uses an explicit English translation and otherwise preserves the original without a language label',()=>{
  assert.equal(scheduleText('写真部ミーティング','Photography club meeting','en'),'Photography club meeting');
  assert.equal(scheduleText('写真部ミーティング',undefined,'en'),'写真部ミーティング');
  assert.equal(scheduleText('休み',undefined,'en'),'休み');
  assert.equal(scheduleText('写真部ミーティング','Photography club meeting','ja'),'写真部ミーティング');
});
