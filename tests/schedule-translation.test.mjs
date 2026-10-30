import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleTranslator} from '../src/lib/schedule-translation.ts';
import {parseGoogleSchedule} from '../src/lib/google-schedule.ts';
const event=(title,other={})=>({date:'2026-11-06',kind:'event',title,...other});
const ok=text=>Response.json({responseStatus:200,quotaFinished:false,responseData:{translatedText:text}});

test('translates unique new titles and reuses results across recurring events and refreshes',async()=>{
  const calls=[];let current=0;
  const translator=createScheduleTranslator(async url=>{calls.push(url.searchParams.get('q'));return ok('Nara photo outing');},()=>current);
  const input=[event('撮影会奈良'),event('撮影会奈良',{date:'2026-11-07'}),event('既に英訳済み',{titleEn:'Verified title'}),event('English meeting')];
  const first=await translator.translate(input);assert.equal(first.translationStatus,'complete');
  assert.deepEqual(first.events.map(e=>e.titleEn),['Nara photo outing','Nara photo outing','Verified title',undefined]);
  assert.equal(first.events[0].title,'撮影会奈良');assert.deepEqual(calls,['撮影会奈良']);
  await translator.translate(input);assert.equal(calls.length,1);
  await translator.translate([event('京都撮影会')]);assert.deepEqual(calls,['撮影会奈良','京都撮影会']);
  current=25*60*60*1000;await translator.translate(input);assert.equal(calls.length,3);
});

test('does not translate private or cancelled calendar events',async()=>{
  const ics=['BEGIN:VCALENDAR','VERSION:2.0',...[
    ['UID:ok','SUMMARY:公開撮影会'],['UID:secret','SUMMARY:秘密の予定','CLASS:PRIVATE'],['UID:cancel','SUMMARY:中止の予定','STATUS:CANCELLED'],
  ].flatMap(e=>['BEGIN:VEVENT',...e,'DTSTAMP:20261001T000000Z','DTSTART:20261106T090000Z','DTEND:20261106T100000Z','END:VEVENT']),'END:VCALENDAR'].join('\r\n');
  const schedule=await parseGoogleSchedule(ics,new Date('2026-11-01T00:00:00Z')),sent=[];
  const translator=createScheduleTranslator(async url=>{sent.push(url.searchParams.get('q'));return ok('Public photo outing');});
  await translator.translate(schedule.events);assert.deepEqual(sent,['公開撮影会']);
});

test('preserves cancellation meaning and never shows provider error text as an event title',async()=>{
  const translator=createScheduleTranslator(async()=>ok('Photo Club Meeting Closed'));
  const result=await translator.translate([event('写真部ミーティング 休み'),event('別のミーティング 休み'),event('龍尾祭')]);
  assert.equal(result.events[0].titleEn,'Photography Club Meeting cancelled');
  assert.equal(result.events[1].titleEn,undefined);assert.equal(result.events[2].titleEn,'Ryubisai Festival');assert.equal(result.translationStatus,'partial');
  const invalid=createScheduleTranslator(async()=>Response.json({responseStatus:429,responseData:{translatedText:'QUOTA EXCEEDED'}}));
  assert.equal((await invalid.translate([event('新しい撮影会')])).events[0].titleEn,undefined);
});

test('times out without losing events and retries an unavailable translation',async()=>{
  let attempts=0;const translator=createScheduleTranslator(async(_url,{signal})=>{
    if(++attempts===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
    return ok('Kyoto photo outing');
  });
  const source=[event('京都撮影会',{time:'18:00',place:'京都'})];
  const first=await translator.translate(source,15);assert.equal(first.translationStatus,'partial');assert.deepEqual(first.events,source);
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await translator.translate(source,500);assert.equal(second.events[0].titleEn,'Kyoto photo outing');
  assert.equal(second.events[0].time,'18:00');assert.equal(second.events[0].place,'京都');
});
