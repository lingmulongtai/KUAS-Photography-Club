import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toLocal} from '../src/scripts/hero/geo.ts';
import {tidalWeight} from '../src/scripts/hero/osaka-tidal.ts';

test('Osaka river reaches turn to sea at their mouths and stay rivers inland', () => {
  const at = (lat, lon) => { const p = toLocal(lat, lon); return tidalWeight(p.x, p.z); };
  assert.equal(at(34.683, 135.418), 1, 'Yodo River mouth');
  assert.equal(at(34.597, 135.452), 1, 'Yamato River mouth');
  const juso = at(34.716, 135.482);
  assert.ok(juso > 0 && juso < 1, 'the Yodo blends a few kilometres upstream');
  assert.equal(at(34.810, 135.650), 0, 'Hirakata keeps the river surface that joins the Uji-Yodo waterway');
  assert.equal(at(35.0036, 135.7595), 0, 'Kyoto rivers are untouched');
});
