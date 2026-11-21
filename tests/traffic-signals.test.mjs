import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { signalApproaches, signalAspect, remainingAfterSignal, VEHICLE_GAP } from '../src/scripts/hero/traffic-signals.ts';
import { trafficJunctions } from '../src/scripts/hero/traffic-junctions.ts';
import { trafficSegments } from '../src/scripts/hero/traffic-access.ts';
import { loadLines, LINE } from '../src/scripts/hero/lines-data.ts';

const widths = [3, 4.5, 9, 16, 24];
const road = (...coords) => ({ pts: Float32Array.from(coords), rank: 3, motorway: false });
const cross = () => [road(-100,0, 0,0), road(0,0, 100,0), road(0,0, 0,100), road(0,-100, 0,0)];
const at = (paths, elevated = () => false, cap = 100) => signalApproaches(paths, trafficJunctions(paths), widths, elevated, cap);

test('perpendicular approaches never get simultaneous green; amber and all-red clear the crossing', () => {
  const arms = at(cross());
  assert.equal(arms.length, 4);
  const [a,b,c,d] = arms;
  assert.equal(a.phase,b.phase); assert.equal(c.phase,d.phase);
  let amber = 0, clear = 0;
  for (let t = 0; t < 52; t++) {
    const main = signalAspect(t, a.phase), side = signalAspect(t, c.phase);
    if (main === 1) amber++;
    if (main === 2 && side === 2) clear++;
    assert.ok(main === 2 || side === 2);
  }
  assert.equal(amber, 3); assert.equal(clear, 4);
  assert.equal(at(cross().slice(0,3)).length, 3, 'at-grade T junction');
  assert.equal(at(cross(), () => false, 3).length, 0, 'no partially signalled intersection');
});

test('a geometric crossing, grade-separated arm, expressway or simple bend gets no signal', () => {
  assert.equal(at([road(-100,0,100,0),road(0,-100,0,100)]).length,0);
  assert.equal(at(cross(), (_x,z) => z > 1).length,0);
  const freeway = cross(); freeway[1].motorway = true;
  assert.equal(at(freeway).length,0);
  assert.equal(at([road(-100,0,0,0),road(0,0,20,100)]).length,0);
});

test('cars queue in lane behind the front bumper, tolerate position rounding, and depart on green', () => {
  const stop = 12.4;
  let front = 18, rear = 27;
  for (let frame=0; frame<100; frame++) {
    front = remainingAfterSignal(front, .5, stop, 2, -Infinity);
    rear = remainingAfterSignal(rear, .6, stop, 2, front);
    assert.ok(rear - front >= VEHICLE_GAP - 1e-8);
  }
  assert.equal(front,stop);
  assert.ok(Math.abs(rear - stop - VEHICLE_GAP) < 1e-8);
  assert.equal(remainingAfterSignal(stop-.001,1,stop,1,-Infinity), stop-.001);
  assert.equal(remainingAfterSignal(stop-1,1,stop,1,-Infinity), stop-2, 'already across');
  front = remainingAfterSignal(front,.7,stop,0,-Infinity);
  assert.ok(remainingAfterSignal(rear,.8,stop,0,front) < rear);
});

test('the shipped central, southern and Tamba networks contain bounded signal approaches', async t => {
  const original = globalThis.fetch;
  const root = new URL('../public/kyoto/', import.meta.url);
  globalThis.fetch = async url => new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(() => { globalThis.fetch = original; });
  const { regions } = JSON.parse(await readFile(new URL('regions.json',root),'utf8'));
  for (const id of ['core','south','kameoka','sonobe']) {
    const m = regions.find(r => r.id === id)?.lines;
    const lines = await loadLines(undefined,m?.file,m?.box,m?.q);
    const paths = [];
    for (const l of lines) {
      if (l.kind !== LINE.road || (l.attr & 15) < 2) continue;
      for (const pts of trafficSegments(l.pts)) {
        let length = 0;
        for (let i=2;i<pts.length;i+=2) length += Math.hypot(pts[i]-pts[i-2],pts[i+1]-pts[i-1]);
        if (length >= 80) paths.push({ pts, rank:l.attr & 15, motorway:(l.attr >> 4) === 3 });
      }
    }
    const arms = at(paths, () => false, 260);
    assert.ok(arms.length >= 3 && arms.length <= 260, id);
  }
});
