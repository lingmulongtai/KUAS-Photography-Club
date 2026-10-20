import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAU, cardPose, dealProgress, layoutFor, photoFor, ringPose, wrapAngle } from '../src/scripts/reel/pose.ts';

const desktop = layoutFor(1280);
const phone = layoutFor(390);

test('layout keeps cards almost touching and fewer of them on phones', () => {
  assert.equal(desktop.count, 16);
  assert.equal(phone.count, 12);
  for (const l of [desktop, phone]) {
    const gap = (TAU * l.radius) / l.count - l.width;
    assert.ok(gap > 0 && gap < l.width * 0.1, `gap ${gap}`);
  }
});

test('the loader ring is a small tilted coin seen from outside; the open ring is level around the viewer', () => {
  const closed = ringPose(desktop, 0);
  const open = ringPose(desktop, 1);
  assert.ok(closed.radius < closed.perspective, 'the viewer starts outside the ring');
  assert.ok(closed.tilt < 0 && closed.roll < 0);
  assert.ok(open.radius > open.perspective, 'the viewer ends inside the ring');
  assert.equal(open.tilt, 0);
  assert.equal(open.roll, 0);
  assert.equal(open.scale, 1);
});

test('cards are dealt one after another and the waiting stack is never visible', () => {
  const scene = { formation: 0, expansion: 0, spin: 0 };
  for (let i = 0; i < desktop.count; i++) assert.equal(cardPose(i, desktop, scene).opacity, 0);
  const half = { formation: 0.5, expansion: 0, spin: 0 };
  assert.ok(dealProgress(0, 16, 0.5) === 1);
  assert.ok(dealProgress(15, 16, 0.5) === 0);
  assert.ok(cardPose(0, desktop, half).visible);
  assert.ok(!cardPose(15, desktop, half).visible);
  const done = { formation: 1, expansion: 0, spin: 0 };
  for (let i = 0; i < desktop.count; i++) assert.ok(cardPose(i, desktop, done).opacity > 0.99);
});

test('once open, cards behind the viewer are hidden and the ones ahead are shown', () => {
  const scene = { formation: 1, expansion: 1, spin: 0 };
  const ahead = cardPose(0, desktop, scene);
  const behind = cardPose(desktop.count / 2, desktop, scene);
  assert.ok(ahead.visible && ahead.opacity > 0.99);
  assert.ok(!behind.visible);
  assert.ok(Math.abs(wrapAngle(behind.angle)) > 3);
});

test('photos change only while a card is out of sight, and every photo comes round', () => {
  const photos = 30;
  const seen = new Set();
  for (let step = 0; step < 4000; step++) {
    const spin = step * 0.01;
    for (let i = 0; i < desktop.count; i++) {
      const now = cardPose(i, desktop, { formation: 1, expansion: 1, spin });
      const next = cardPose(i, desktop, { formation: 1, expansion: 1, spin: spin + 0.01 });
      if (next.cycle !== now.cycle) assert.ok(!now.visible && !next.visible, `slot ${i} swapped in view`);
      if (now.visible) seen.add(photoFor(i, now.cycle, desktop.count, photos));
    }
  }
  assert.equal(seen.size, photos);
  assert.equal(photoFor(3, 0, 16, 0), -1);
});

test('poses stay finite for any spin', () => {
  for (const spin of [-1e4, -3.2, 0, Math.PI, 1e4]) {
    for (let i = 0; i < phone.count; i++) {
      const p = cardPose(i, phone, { formation: 1, expansion: 0.5, spin });
      assert.ok(Number.isFinite(p.depth) && Number.isFinite(p.opacity) && !p.transform.includes('NaN'));
    }
  }
});
