import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotPlaceholders } from '../src/data/reel-placeholders.ts';
import { SPOTS } from '../src/data/spots.ts';

test('the reel stands in with drawn place cards, never photographs or records', () => {
  for (const lang of ['ja', 'en']) {
    const cards = spotPlaceholders(lang);
    assert.ok(cards.length >= 16, 'enough cards to fill the ring');
    for (const card of cards) {
      assert.equal(card.src, undefined);
      assert.ok(card.art?.startsWith('linear-gradient('));
      assert.match(card.href, /^\/trips\/spots\/[a-z]+\/$/);
      assert.ok(SPOTS.some((s) => card.href === `/trips/spots/${s.id}/`));
    }
  }
  assert.equal(spotPlaceholders('en')[0].meta, 'Records coming soon');
});
