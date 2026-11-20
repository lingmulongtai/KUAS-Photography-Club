import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextMeeting, meetingDay, kyotoDay} from '../src/lib/next-meeting.ts';

const meeting=(date,extra={})=>({date,title:'定例ミーティング',kind:'meeting',time:'18:00–20:00',...extra});
test('only dated calendar entries make a next meeting; the weekly habit never does',()=>{
  assert.deepEqual(nextMeeting([],'2026-11-20','S306'),{state:'unknown'});
  assert.deepEqual(nextMeeting([{date:'2026-11-29',title:'嵐山撮影会',kind:'trip'}],'2026-11-20','S306'),{state:'unknown'});
});
test('the nearest meeting from today, with its start time and room',()=>{
  const next=nextMeeting([meeting('2026-11-13'),meeting('2026-11-27'),meeting('2026-11-20',{place:'太秦キャンパス S306'})],'2026-11-20','S306');
  assert.deepEqual(next,{state:'meeting',date:'2026-11-20',time:'18:00',place:'太秦キャンパス S306',moved:false});
  assert.equal(nextMeeting([meeting('2026-11-27',{place:'S401'})],'2026-11-20','S306').moved,true);
});
test('a cancellation wins over a repeating meeting entry on the same day, and counts when it comes first',()=>{
  const off={date:'2026-11-27',title:'龍尾祭準備のため休会',kind:'other'};
  assert.deepEqual(nextMeeting([meeting('2026-11-27'),off,meeting('2026-12-04')],'2026-11-21','S306'),{state:'cancelled',date:'2026-11-27'});
  assert.equal(nextMeeting([meeting('2026-11-20'),off],'2026-11-20','S306').state,'meeting');
});
test('dates are written the way each language reads them, in Kyoto time',()=>{
  assert.equal(meetingDay('2026-11-20','ja'),'11/20(金)');
  assert.equal(meetingDay('2026-11-20','en'),'Fri 20 Nov');
  assert.equal(kyotoDay(new Date('2026-11-20T15:30:00Z')),'2026-11-21');
});
