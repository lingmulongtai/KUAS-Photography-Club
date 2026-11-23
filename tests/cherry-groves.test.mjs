import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toLocal} from '../src/scripts/hero/geo.ts';
import {cherryPick,cherryShare} from '../src/scripts/hero/cherry-groves.ts';

test('cherry viewing grounds flower densely over a baseline of wild yamazakura', () => {
  const maruyama = toLocal(35.0035, 135.7815), atago = toLocal(35.06, 135.63);
  assert.ok(cherryShare(maruyama.x, maruyama.z) > .5, 'Maruyama Park is mostly in flower');
  const wild = cherryShare(atago.x, atago.z);
  assert.ok(wild > 0 && wild < .15, 'ordinary hillsides keep a scattering of wild cherries');
  // The share falls off smoothly from a grove instead of stopping at a circle.
  const edge = cherryShare(maruyama.x + 220, maruyama.z), out = cherryShare(maruyama.x + 300, maruyama.z);
  assert.ok(edge > out && edge < cherryShare(maruyama.x, maruyama.z));
});

test('a tree pick is stable and spread over the unit interval', () => {
  assert.equal(cherryPick(12.5, -40), cherryPick(12.5, -40));
  const picks = Array.from({length: 2000}, (_, i) => cherryPick(i * 8.3, i * -5.1));
  assert.ok(picks.every(v => v >= 0 && v < 1));
  const below = picks.filter(v => v < .1).length / picks.length;
  assert.ok(below > .07 && below < .13);
});
