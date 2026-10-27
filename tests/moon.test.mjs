import test from 'node:test';
import assert from 'node:assert/strict';
import {moonAge,moonPhaseName,moonPosition,moonTimes} from '../src/scripts/hero/astro.ts';
const at=s=>new Date(s);
test('moon age counts days from the real new moons',()=>{
  // new moons 2026-10-10 15:50 UTC and 2026-11-09 07:02 UTC, full moon 2026-10-26 04:12 UTC
  assert.ok(moonAge(at('2026-10-11T15:50:00Z'))>.8&&moonAge(at('2026-10-11T15:50:00Z'))<1.2);
  assert.ok(moonAge(at('2026-11-10T07:00:00Z'))<1.2,'resets at the next new moon');
  assert.ok(Math.abs(moonAge(at('2026-10-26T04:12:00Z'))-15.5)<.6);
  assert.equal(moonPhaseName(moonAge(at('2026-10-26T04:12:00Z'))),'満月');
  assert.equal(moonPhaseName(moonAge(at('2026-10-10T16:00:00Z'))),'新月');
  assert.ok(moonPosition(at('2026-10-10T16:00:00Z')).illumination<.01);
  assert.ok(moonPosition(at('2026-10-26T04:12:00Z')).illumination>.99);
});
test('the moon rises with the sun at new moon and at sunset when full',()=>{
  const nu=moonTimes(at('2026-10-10T03:00:00Z')),full=moonTimes(at('2026-10-26T03:00:00Z'));
  assert.ok(nu.rise>4*60&&nu.rise<7*60,'new moon rises around sunrise');
  assert.ok(nu.set>16*60&&nu.set<19*60,'and sets around sunset');
  assert.ok(full.rise>15*60&&full.rise<18.5*60,'full moon rises around sunset');
  // the moonrise comes later each day
  const a=moonTimes(at('2026-10-18T03:00:00Z')).rise,b=moonTimes(at('2026-10-19T03:00:00Z')).rise;
  assert.ok(b-a>20&&b-a<80);
});
