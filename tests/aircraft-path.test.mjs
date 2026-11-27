import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AIRLINER_FLIGHTS, HELICOPTER_FLIGHTS, airlinerPose, helicopterPose } from '../src/scripts/hero/aircraft-path.ts';

const require = createRequire(import.meta.url);
const { buildSync } = require('esbuild');
const Module = require('node:module');

const flatGround = () => 12;
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

test('Itami landing flight descends smoothly to runway deck and rolls out with continuous speed', () => {
  const flight = AIRLINER_FLIGHTS.find((f) => f.id === 'itm-land-1');
  assert.ok(flight);
  const cycle = flight.cycleSeconds;
  const tAt = (phase) => ((phase - flight.phase + 1) % 1) * cycle;

  const high = airlinerPose(flight, tAt(0.1), flatGround);
  const mid = airlinerPose(flight, tAt(0.45), flatGround);
  const preTouch = airlinerPose(flight, tAt(0.615), flatGround);
  const touch = airlinerPose(flight, tAt(0.625), flatGround);
  const roll = airlinerPose(flight, tAt(0.76), flatGround);

  assert.ok(high.y > mid.y && mid.y > touch.y, 'approach altitude should decrease continuously');
  assert.equal(high.onGround, false);
  assert.equal(roll.onGround, true);
  assert.ok(Math.abs(touch.y - roll.y) < 0.8, 'touchdown and rollout should stay smoothly on runway deck');

  // Verify no sudden speed surge at touchdown (p = 0.62)
  const dt = 0.25;
  const pPre0 = airlinerPose(flight, tAt(0.615) - dt, flatGround);
  const pPre1 = airlinerPose(flight, tAt(0.615), flatGround);
  const pPost0 = airlinerPose(flight, tAt(0.625), flatGround);
  const pPost1 = airlinerPose(flight, tAt(0.625) + dt, flatGround);
  const vBefore = Math.hypot(pPre1.x - pPre0.x, pPre1.z - pPre0.z) / dt;
  const vAfter = Math.hypot(pPost1.x - pPost0.x, pPost1.z - pPost0.z) / dt;
  assert.ok(vBefore > 55 && vBefore < 85, `approach speed realistic (${vBefore.toFixed(1)} m/s)`);
  assert.ok(vAfter <= vBefore + 4 && vAfter > 50, `no touchdown acceleration surge (${vBefore.toFixed(1)} -> ${vAfter.toFixed(1)} m/s)`);
  assert.ok(Math.abs(preTouch.y - touch.y) < 3.5, 'smooth flare into touchdown');
});

test('All airliner takeoff and landing flights align nose with velocity and bank into turns', () => {
  for (const flight of AIRLINER_FLIGHTS) {
    if (flight.kind === 'overflight') continue;
    const cycle = flight.cycleSeconds;
    const dt = 0.25;
    for (let k = 1; k < 180; k++) {
      const p = 0.02 + (0.96 * k) / 180;
      const t = ((p - flight.phase + 1) % 1) * cycle;
      const a = airlinerPose(flight, t - dt, flatGround);
      const b = airlinerPose(flight, t, flatGround);
      const c = airlinerPose(flight, t + dt, flatGround);
      const vx = (c.x - a.x) / (2 * dt);
      const vz = (c.z - a.z) / (2 * dt);
      const spd = Math.hypot(vx, vz);
      assert.ok(spd < 145, `${flight.id} speed bounded (${spd.toFixed(1)} m/s at p=${p.toFixed(3)})`);
      if (spd > 5) {
        const velYaw = Math.atan2(vx, vz);
        const slip = Math.abs(angleDiff(b.yaw, velYaw));
        assert.ok(slip < 0.08, `${flight.id} yaw aligns with travel direction (slip=${slip.toFixed(3)} rad at p=${p.toFixed(3)})`);
      }
      // Verify coordinated bank direction when turning significantly in the air
      const yawRate = angleDiff(c.yaw, a.yaw) / (2 * dt);
      if (!b.onGround && Math.abs(yawRate) > 0.006 && Math.abs(b.roll) > 0.01) {
        // Right turn => yawRate < 0 => roll > 0 (right wing down)
        assert.ok(Math.sign(b.roll) === -Math.sign(yawRate), `${flight.id} banks inward (yawRate=${yawRate.toFixed(4)}, roll=${b.roll.toFixed(4)})`);
      }
    }
  }
});

test('All helicopter flights stay within realistic speed, C1 continuous yaw/roll, and zero pad snap', () => {
  for (const heli of HELICOPTER_FLIGHTS) {
    const cycle = heli.cycleSeconds;
    const steps = 360;
    const dt = cycle / steps;
    let maxSpeed = 0;
    let maxYawStep = 0;
    let maxRollStep = 0;
    let maxAlt = 0;
    let prev = helicopterPose(heli, 0, flatGround);
    for (let i = 1; i <= steps; i++) {
      const cur = helicopterPose(heli, i * dt, flatGround);
      const spd = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z) / dt;
      maxSpeed = Math.max(maxSpeed, spd);
      maxYawStep = Math.max(maxYawStep, Math.abs(angleDiff(cur.yaw, prev.yaw)));
      maxRollStep = Math.max(maxRollStep, Math.abs(cur.roll - prev.roll));
      maxAlt = Math.max(maxAlt, cur.y);
      // When moving horizontally at cruise speed, nose must point along travel vector (centered finite difference)
      const hSpd = Math.hypot(cur.x - prev.x, cur.z - prev.z) / dt;
      if (hSpd > 10) {
        const next = helicopterPose(heli, (i + 0.5) * dt, flatGround);
        const before = helicopterPose(heli, (i - 0.5) * dt, flatGround);
        const velYaw = Math.atan2(next.x - before.x, next.z - before.z);
        const slip = Math.abs(angleDiff(cur.yaw, velYaw));
        assert.ok(slip < 0.08, `${heli.id} yaw tracks velocity (slip=${slip.toFixed(3)} rad at step ${i})`);
      }
      prev = cur;
    }
    assert.ok(maxSpeed >= 25 && maxSpeed <= 60, `${heli.id} realistic cruise speed (${maxSpeed.toFixed(1)} m/s)`);
    assert.ok(maxYawStep < 0.25, `${heli.id} no abrupt yaw snap (max step ${maxYawStep.toFixed(3)} rad)`);
    assert.ok(maxRollStep < 0.12, `${heli.id} smooth banking (max roll step ${maxRollStep.toFixed(3)} rad)`);
    assert.ok(maxAlt > 140, `${heli.id} reaches scenic cruise altitude (${maxAlt.toFixed(1)} m)`);
  }
});

test('B787-8 airliner, helicopters, airports, Osaka landmarks and Biwa bridges build cleanly', () => {
  const result = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        export { buildAircraft } from './src/scripts/hero/aircraft.ts';
        export { buildKansaiAirports } from './src/scripts/hero/airports.ts';
        export { buildOsakaLandmarks, inOsakaLandmarkMask, inLandmarkTreeExclusion } from './src/scripts/hero/osaka-landmarks.ts';
        export { buildBiwaBridges } from './src/scripts/hero/biwa-bridges.ts';
        export { createEnv } from './src/scripts/hero/env.ts';
        export { toLocal } from './src/scripts/hero/geo.ts';
      `,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const mod = new Module(import.meta.url);
  mod.filename = import.meta.filename;
  mod.paths = require.resolve.paths('three') ?? [];
  mod._compile(result.outputFiles[0].text, import.meta.filename);
  const { buildAircraft, buildKansaiAirports, buildOsakaLandmarks, inOsakaLandmarkMask, inLandmarkTreeExclusion, buildBiwaBridges, createEnv, toLocal } = mod.exports;

  const env = createEnv();
  const built = buildAircraft(env, flatGround);
  const airliner = built.mesh.getObjectByName('kansai-airliners');
  const heli = built.mesh.getObjectByName('kansai-helicopters');
  const rotor = built.mesh.getObjectByName('kansai-helicopter-rotors');
  const tailRotor = built.mesh.getObjectByName('kansai-helicopter-tail-rotors');
  assert.ok(airliner && airliner.geometry.getAttribute('position').count > 1200, 'B787-8 mesh merged cleanly');
  assert.ok(heli && heli.geometry.getAttribute('position').count > 200, 'helicopter body merged cleanly');
  assert.ok(rotor && rotor.geometry.getAttribute('position').count > 100, 'main rotor merged cleanly');
  assert.ok(tailRotor && tailRotor.geometry.getAttribute('position').count > 20, 'tail rotor merged cleanly');
  built.update(1.5);

  const airports = buildKansaiAirports(env, flatGround);
  assert.ok(airports.children.length >= 2, 'airports group contains meshes and airfield lighting');
  const osakaIcons = buildOsakaLandmarks(env, flatGround);
  assert.ok(osakaIcons.children.length >= 2, 'Osaka & Nara landmarks group contains meshes and beacons');
  const meshVerts = osakaIcons.children[0].geometry.getAttribute('position').count;
  assert.ok(meshVerts > 15000, `combined Osaka/USJ/Heijo landmark mesh built cleanly (${meshVerts} verts)`);
  // Verify exact oriented footprint & tree clearing masks cover Umeda, USJ and Heijo Palace
  for (const [label, lat, lon] of [
    ['JR Osaka Station', 34.70240, 135.49595],
    ['HEP FIVE', 34.70232, 135.50028],
    ['USJ Hogwarts', 34.66878, 135.43145],
    ['USJ Super Nintendo World', 34.66835, 135.43310],
    ['Heijo Daigokuden', 34.69395, 135.79415],
    ['Heijo Suzakumon', 34.68705, 135.79430],
  ]) {
    const p = toLocal(lat, lon);
    assert.equal(inOsakaLandmarkMask(p.x, p.z), true, `building mask covers ${label}`);
  }
  const umekita = toLocal(34.70415, 135.49265);
  const heijoCourt = toLocal(34.69295, 135.79415);
  assert.equal(inLandmarkTreeExclusion(umekita.x, umekita.z), true, 'tree clearing covers Umekita Park');
  assert.equal(inLandmarkTreeExclusion(heijoCourt.x, heijoCourt.z), true, 'tree clearing covers Heijo Palace court');
  const biwaBridges = buildBiwaBridges(env);
  assert.ok(biwaBridges.geometry.getAttribute('position').count > 200, 'Biwa bridges geometry built');
});
