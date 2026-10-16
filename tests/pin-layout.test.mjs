import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinBounds, overlaps } from '../src/scripts/hero/pin-layout.ts';

test('a tall campus label cannot cover another visible map tap target', () => {
  const campus=pinBounds(644,474,150,45);
  const tower=pinBounds(630,440,96,28);
  assert.equal(overlaps(campus,tower),true);
  assert.equal(overlaps(campus,pinBounds(850,440,96,28)),false);
  assert.equal(overlaps(campus,pinBounds(644,560,96,28)),false);
});
test('short labels still reserve a 44 pixel button and stay clear of controls', () => {
  const pin=pinBounds(100,100,20,10);
  assert.ok(pin.x<=78&&pin.x+pin.w>=122);
  assert.ok(pin.y<=78&&pin.y+pin.h>=122);
  assert.equal(overlaps(pin,{x:90,y:50,w:20,h:30}),true);
});
