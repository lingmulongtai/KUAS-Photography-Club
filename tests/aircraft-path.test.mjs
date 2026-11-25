import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRLINER_FLIGHTS,
  HELICOPTER_FLIGHTS,
  airlinerPose,
  helicopterPose,
} from '../src/scripts/hero/aircraft-path.ts';

const flatGround = () => 12;

test('Itami landing flight descends smoothly to runway deck and rolls out on the ground', () => {
  const flight = AIRLINER_FLIGHTS.find((f) => f.id === 'itm-land-1');
  assert.ok(flight);
  const cycle = flight.cycleSeconds;
  const atPhase = (p) => airlinerPose(flight, (p - flight.phase) * cycle, flatGround);

  const far = atPhase(0.10);
  const shortFinal = atPhase(0.55);
  const touchdown = atPhase(0.65);
  const rollout = atPhase(0.84);

  assert.ok(far.y > shortFinal.y + 120, 'airliner descends along glideslope');
  assert.ok(shortFinal.y > touchdown.y, 'short final sits above runway deck');
  assert.equal(touchdown.onGround, true);
  assert.equal(rollout.onGround, true);
  assert.ok(Math.abs(touchdown.y - rollout.y) < 0.01, 'rollout stays level on runway deck');
  assert.ok(shortFinal.landingLights > 0.8, 'landing lights stay bright on final approach');
});

test('KIX and Kobe takeoff flights accelerate on runway, rotate nose-up, and climb cleanly', () => {
  for (const id of ['kix-takeoff-a1', 'ukb-takeoff-1']) {
    const flight = AIRLINER_FLIGHTS.find((f) => f.id === id);
    assert.ok(flight, id);
    const cycle = flight.cycleSeconds;
    const atPhase = (p) => airlinerPose(flight, (p - flight.phase) * cycle, flatGround);

    const rollStart = atPhase(0.12);
    const rotate = atPhase(0.33);
    const climb = atPhase(0.75);

    assert.equal(rollStart.onGround, true);
    assert.ok(rotate.pitch > 0.12, `${id} rotates nose up before liftoff`);
    assert.equal(climb.onGround, false);
    assert.ok(climb.y > rollStart.y + 300, `${id} climbs hundreds of metres after takeoff`);
  }
});

test('Helicopter flights lift off vertically from pad, cruise smoothly, and return to pad', () => {
  const heli = HELICOPTER_FLIGHTS[0];
  const atPhase = (p) => helicopterPose(heli, (p - heli.phase) * heli.cycleSeconds, flatGround);

  const parked = atPhase(0.03);
  const hover = atPhase(0.13);
  const cruise = atPhase(0.50);
  const landed = atPhase(0.97);

  assert.equal(parked.onGround, true);
  assert.equal(hover.onGround, false);
  assert.ok(hover.y > parked.y + 30, 'vertical liftoff rises above helipad');
  assert.ok(Math.hypot(hover.x - parked.x, hover.z - parked.z) < 0.01, 'liftoff rises vertically above pad');
  assert.ok(Math.hypot(cruise.x - parked.x, cruise.z - parked.z) > 1000, 'helicopter cruises over the bay/city');
  assert.equal(landed.onGround, true);
  assert.ok(Math.hypot(landed.x - parked.x, landed.z - parked.z) < 0.01, 'helicopter returns to pad');
});
