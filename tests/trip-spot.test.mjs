import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { tripMarkdown, appendPhotos, cleanSpot } from '../src/lib/admin/content.ts';

const photo = { name:'01.jpg', alt:'鴨川の夜景', by:'写真部' };
const trip = {slug:'test-trip', title:'夜の撮影会',date:'2026-10-14',place:'河原町',summary:'川沿いを歩きました。',body:'本文',photos:[photo]};
const front = (md) => parse(md.split('---')[1]);
test('new trips serialize only recognized optional place pins', () => {
  assert.equal(front(tripMarkdown(trip)).spot, undefined);
  assert.equal(front(tripMarkdown({...trip,spot:'kawaramachi'})).spot, 'kawaramachi');
  assert.throws(() => tripMarkdown({...trip,spot:'<script>'}), /ピン/);
  assert.throws(() => cleanSpot({id:'gion'}), /ピン/);
});
test('adding photos preserves a pin unless explicitly changed or cleared', () => {
  const md = tripMarkdown({...trip,spot:'gion'});
  const added = {...photo,name:'02.jpg'};
  assert.equal(front(appendPhotos(md,trip.slug,[added])).spot, 'gion');
  const changed = appendPhotos(md,trip.slug,[],'kawaramachi');
  assert.equal(front(changed).spot, 'kawaramachi');
  assert.equal(front(changed).photos.length, 1);
  assert.ok(changed.endsWith('本文\n'));
  assert.equal(front(appendPhotos(md,trip.slug,[],null)).spot, undefined);
  assert.throws(() => appendPhotos(md,trip.slug,[],'missing'), /ピン/);
});
