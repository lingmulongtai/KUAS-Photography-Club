import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredTheme } from '../src/lib/theme.ts';

test('light remains the default until a visitor explicitly chooses a theme', () => {
  for (const saved of [null, undefined, '', 'system', 'unknown', {}, 0]) assert.equal(preferredTheme(saved), 'light');
  for (const saved of ['light', 'dark', 'black']) assert.equal(preferredTheme(saved), saved);
});
