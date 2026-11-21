import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4, Scene, Vector2, Vector3} from 'three';
import {createSunShadow} from '../src/scripts/hero/shadow.ts';

test('scrubbing across twilight keeps direct sunlight paired with a current shadow map', t => {
  let now = 0, draws = 0;
  t.mock.method(performance, 'now', () => now);
  const renderer = {
    getRenderTarget: () => null, setRenderTarget() {}, clear() {},
    getClearAlpha: () => 1, getClearColor() {}, setClearColor() {},
    render() { draws++; },
  };
  const env = {
    uShadowMap: {}, uShadowOn: {}, uShadowTexel: {value:new Vector2()},
    uShadowMatrix: {value:new Matrix4()}, uShadowBias: {}, uShadowWorld: {},
  };
  const shadow = createSunShadow(renderer, new Scene(), env, 64);
  const direction = degrees => new Vector3(Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180), 0);
  const update = (degrees, light) => { now += 16; shadow.update(direction(degrees), light); };
  update(-3, 0);
  assert.equal(draws, 0);
  update(-.8, .01);
  assert.equal(env.uShadowOn.value, 1);
  assert.equal(draws, 1, 'the first light already casts shadows');
  update(-.6, .02);
  assert.equal(draws, 1, 'small steps still use the recent shadow map');
  update(5, 1);
  assert.equal(draws, 2, 'a large scrub cannot reuse the old direction');
  update(-3, 0);
  assert.equal(env.uShadowOn.value, 0);
  assert.equal(draws, 2);
  update(5, 1);
  assert.equal(draws, 3, 'returning from darkness refreshes even inside the throttle interval');
});
