import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { isPublicContent } from '../src/lib/public-content.ts';
import { scheduleMarkdown } from '../src/lib/admin/content.ts';

test('public collections reject samples and drafts, independent of environment', () => {
  assert.equal(isPublicContent({ data: { sample: true } }), false);
  assert.equal(isPublicContent({ data: { draft: true } }), false);
  assert.equal(isPublicContent({ data: { sample: false } }), true);
  assert.equal(isPublicContent({ data: {} }), true);
});

test('editing a schedule preserves English notice fields', () => {
  const data = parse(readFileSync(new URL('../src/content/schedule/2026-10.md', import.meta.url), 'utf8').split('---')[1]);
  const updated = parse(scheduleMarkdown({ ...data, noMeeting: [], notes: '' }).split('---')[1]);
  assert.equal(updated.events[0].titleEn, data.events[0].titleEn);
  const withNote = scheduleMarkdown({ ...data, noMeeting: [], events: [{ ...data.events[0], noteEn: 'Check with the organizers.' }] });
  assert.equal(parse(withNote.split('---')[1]).events[0].noteEn, 'Check with the organizers.');
});

test('October and November sample events never enter the published schedule', () => {
  const dir = new URL('../src/content/schedule/', import.meta.url);
  const entries = readdirSync(dir).map(file => ({ data: parse(readFileSync(new URL(file, dir), 'utf8').split('---')[1]) }));
  const published = entries.filter(isPublicContent).flatMap(e => e.data.events ?? []);
  assert.equal(published.some(e => e.kind === 'meeting' && String(e.date).includes('2026-10-23')), false);
  assert.equal(published.filter(e => e.date === '2026-10-23' && e.kind === 'other').length, 1);
  for (const date of ['2026-10-24', '2026-10-30', '2026-10-31', '2026-11-14', '2026-11-20', '2026-11-28']) {
    assert.equal(published.some(e => e.date === date), false, date);
  }
});
