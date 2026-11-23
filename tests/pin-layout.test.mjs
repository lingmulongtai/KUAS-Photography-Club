import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinBounds, pinFootprint, overlaps, choosePinSlot, effectivePinPriority, maxPinDistance, ACTION_SLOTS } from '../src/scripts/hero/pin-layout.ts';

test('a tall campus label cannot cover another visible map tap target', () => {
  const campus = pinBounds(644, 474, 150, 45);
  const tower = pinBounds(630, 440, 96, 28);
  assert.equal(overlaps(campus, tower), true);
  assert.equal(overlaps(campus, pinBounds(850, 440, 96, 28)), false);
  assert.equal(overlaps(campus, pinBounds(644, 560, 96, 28)), false);
});

test('short labels still reserve a 44 pixel button and stay clear of controls', () => {
  const pin = pinBounds(100, 100, 20, 10);
  assert.ok(pin.x <= 78 && pin.x + pin.w >= 122);
  assert.ok(pin.y <= 78 && pin.y + pin.h >= 122);
  assert.equal(overlaps(pin, { x: 90, y: 50, w: 20, h: 30 }), true);
});

test('choosePinSlot gracefully falls back to side or bottom slots without overlapping placed pins or UI', () => {
  const placed = [...pinFootprint(500, 400, 110, 28, 'top')];
  // Nearby pin whose centered 'top' label would collide by 24 px moves cleanly to a non-overlapping side/bottom slot.
  const choice = choosePinSlot(588, 408, 90, 26, 1280, 720, placed, []);
  assert.ok(choice, 'nearby pin finds a non-overlapping fallback slot');
  assert.notEqual(choice.slot, 'top');
  for (const r of choice.rects) for (const p of placed) assert.equal(overlaps(r, p), false);

  // Pin directly below top navigation bar falls back to 'bottom' or side instead of disappearing.
  const topBar = [{ x: 0, y: 0, w: 1280, h: 120 }];
  const underBar = choosePinSlot(600, 154, 110, 28, 1280, 720, [], topBar);
  assert.ok(underBar);
  assert.notEqual(underBar.slot, 'top');
  assert.equal(overlaps(underBar.box, { x: -8, y: -8, w: 1296, h: 136 }), false);

  // Action pill pins restrict themselves to centered top/bottom slots.
  const pill = choosePinSlot(600, 154, 150, 44, 1280, 720, [], topBar, null, ACTION_SLOTS);
  assert.ok(pill);
  assert.equal(pill.slot, 'bottom');

  // If completely surrounded on all four sides, returns null rather than overlapping.
  const crowded = [
    pinBounds(500, 400, 240, 120, 'top'),
    pinBounds(500, 400, 240, 120, 'bottom'),
  ];
  assert.equal(choosePinSlot(500, 400, 90, 26, 1280, 720, crowded, []), null);
});

test('choosePinSlot keeps its fallback slot until top has comfortable hysteresis clearance', () => {
  // Obstacle sits just 2 px above the normal top box (no overlap at gap=6, but fails comfort gap=12).
  const normalTop = pinBounds(500, 300, 100, 26, 'top', 6);
  const tightBlock = [{ x: 420, y: normalTop.y - 30, w: 160, h: 20 }]; // bottom at normalTop.y - 10, +8 pad => normalTop.y - 2
  const kept = choosePinSlot(500, 300, 100, 26, 1280, 720, [], tightBlock, 'right');
  assert.ok(kept);
  assert.equal(kept.slot, 'right', 'holds previous fallback slot to avoid frame-to-frame jitter');
});

test('nearby foreground pins outrank distant landmarks while panoramas preserve rank hierarchy', () => {
  // Close to Kyoto Station (rank 4, 500 m) with KUAS (rank 0, 5.5 km) in the distance: foreground wins.
  assert.ok(effectivePinPriority(4, 500) < effectivePinPriority(0, 5500));
  // Close to Seta Karahashi (rank 2, 450 m) with Otsu Port (rank 1, 4.5 km) behind it: foreground wins.
  assert.ok(effectivePinPriority(2, 450) < effectivePinPriority(1, 4500));
  // From Shogunzuka panorama (KUAS 6.8 km, Kawaramachi 2.3 km, Gion 1.8 km): flagship & rank-1 stay ahead of Gion.
  assert.ok(effectivePinPriority(0, 6800) < effectivePinPriority(2, 1800));
  assert.ok(effectivePinPriority(1, 2300) < effectivePinPriority(2, 1800));
  // Previously shown pin gets hysteresis bonus to prevent strobing.
  assert.ok(effectivePinPriority(2, 2000, true) < effectivePinPriority(2, 2000, false));
  // Distance ceilings taper sensibly by rank.
  assert.ok(maxPinDistance(0) >= maxPinDistance(1));
  assert.ok(maxPinDistance(1) > maxPinDistance(2));
  assert.ok(maxPinDistance(2) > maxPinDistance(3));
  assert.ok(maxPinDistance(3) > maxPinDistance(4));
});
