import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, TOPIC_MISSIONS } from '../src/scripts/studio/missions.ts';
import { FILTERS, GRADES, LENSES } from '../src/scripts/studio/gear.ts';
import { coach } from '../src/scripts/studio/coach.ts';
import { picker } from '../src/scripts/studio/i18n.ts';

const japanese = /[぀-ヿ㐀-鿿！-｠]/;
const PLACES = ['garden', 'flowers', 'autumn', 'snow', 'sunset', 'night', 'street', 'neon', 'lightroom', 'stars'];

/** Both languages present, English free of Japanese. `latin` labels (50mm F1.8) may read the same in both. */
const bilingual = (label, text, { empty = false, latin = false } = {}) => {
  if (empty && !text.ja && !text.en) return;
  assert.ok(text.ja && (latin || japanese.test(text.ja)), `${label}: Japanese is missing`);
  assert.ok(text.en && !japanese.test(text.en), `${label}: English is missing or has Japanese in it (${text.en})`);
};

test('every challenge is unique, and every topic page links to challenges that exist', () => {
  const ids = MISSIONS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const [topic, list] of Object.entries(TOPIC_MISSIONS)) {
    assert.ok(list.length > 0, topic);
    for (const id of list) assert.ok(ids.includes(id), `${topic} → ${id}`);
  }
  for (const m of MISSIONS) assert.ok(PLACES.includes(m.setup.place), `${m.id} starts in ${m.setup.place}`);
});

test('challenges, lenses and filters are written in both languages', () => {
  for (const m of MISSIONS) {
    bilingual(`${m.id} place`, m.place);
    bilingual(`${m.id} title`, m.title);
    bilingual(`${m.id} goal`, m.goal);
  }
  for (const l of LENSES) {
    bilingual(`${l.id} name`, l.name);
    bilingual(`${l.id} short`, l.short, { latin: true });
    bilingual(`${l.id} note`, l.note);
    assert.ok(GRADES[l.grade], `${l.id} grade`);
  }
  for (const f of FILTERS) {
    assert.ok(f.name.ja && f.name.en, `${f.id} name`);
    bilingual(`${f.id} note`, f.note, { empty: true });
  }
});

const goodShot = {
  place: 'street',
  subject: 'mannequin',
  mm: 200,
  N: 4,
  t: 1 / 60,
  iso: 3200,
  tripod: true,
  filterStops: 0,
  focus: 10,
  distance: 10,
  subjectSharp: true,
  meter: 0.1,
  clipped: 0,
  stack: null,
  meteors: 0,
  sunInFrame: false,
  lights: 0,
  flashOn: false,
  flashShort: false,
  pinwheel: false,
};

test('a challenge passes when its goal is met and says what is missing in the page language', () => {
  const compress = MISSIONS.find((m) => m.id === 'compress');
  assert.deepEqual(compress.check(goodShot, picker('ja')), []);
  const close = { ...goodShot, mm: 70, distance: 3, meter: 2 };
  const ja = compress.check(close, picker('ja'));
  const en = compress.check(close, picker('en'));
  assert.equal(ja.length, 3);
  assert.equal(en.length, 3);
  assert.ok(ja.every((s) => japanese.test(s)));
  assert.ok(en.every((s) => !japanese.test(s)), en.join(' / '));
  assert.ok(en.some((s) => s.includes('135 mm')));
});

const settings = { lens: 'kit', mm: 50, N: 5.6, t: 1 / 125, iso: 400, focusMode: 'af', mf: 3, hold: 'hand', filter: 'none', plAngle: 0, peaking: false };
const flash = { mode: 'off', power: 1 / 4, fec: 0, curtain: 'front' };
const flashResult = { power: 0, short: false, overSync: false, reach: 9 };

test('the coach speaks only English on the English page, in every situation it covers', () => {
  const cases = [];
  for (const place of PLACES)
    for (const lens of LENSES)
      for (const stops of [-3, 0, 2.5])
        cases.push({ place, lens, meter: { stops, clipped: stops > 2 ? 0.2 : 0, crushed: stops < -2 ? 0.3 : 0 } });
  const odd = [
    { s: { t: 1 / 4, hold: 'hand' } },
    { s: { t: 20, iso: 6400, hold: 'tripod', focusMode: 'mf', mf: 2 }, place: 'stars' },
    { s: { N: 22 } },
    { s: { filter: 'nd1000', t: 4 } },
    { s: { filter: 'cpl' } },
    { s: { filter: 'cross' } },
    { tooClose: true, subjectDistance: 0.1 },
    { flash: { mode: 'ttl' }, flashResult: { power: 1, short: true, overSync: true, reach: 3 } },
    { flash: { mode: 'manual', power: 1 }, s: { t: 1 / 1000 } },
    { flare: 0.8 },
    { moving: true, pinwheel: true, s: { t: 1 / 15 } },
  ];
  for (const o of odd) cases.push({ place: o.place ?? 'garden', lens: LENSES[0], meter: { stops: 0, clipped: 0, crushed: 0 }, ...o });

  for (const c of cases) {
    const s = { ...settings, lens: c.lens.id, ...c.s };
    for (const lang of ['ja', 'en']) {
      const list = coach({
        lang,
        s,
        mm: s.mm,
        N: Math.max(s.N, c.lens.fmin ?? 1),
        lens: c.lens,
        filter: FILTERS.find((f) => f.id === s.filter),
        place: c.place,
        meter: c.meter,
        focus: s.focusMode === 'mf' ? s.mf : 3,
        tooClose: c.tooClose ?? false,
        subjectDistance: c.subjectDistance ?? 3,
        subjectName: lang === 'en' ? 'Mannequin' : 'デッサン人形',
        flash: { ...flash, ...c.flash },
        flashResult: { ...flashResult, ...c.flashResult },
        flare: c.flare ?? 0,
        moving: c.moving ?? false,
        pinwheel: c.pinwheel ?? false,
      });
      assert.ok(list.length > 0, `${c.place} ${c.lens.id}: no advice`);
      if (lang === 'en') {
        for (const a of list) {
          const text = `${a.topic} ${a.title} ${a.body}`;
          assert.ok(!japanese.test(text), `${c.place} ${c.lens.id} ${JSON.stringify(c.s ?? {})}: ${text}`);
        }
      }
    }
  }
});
