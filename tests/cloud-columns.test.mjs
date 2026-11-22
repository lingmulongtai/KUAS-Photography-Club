import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudColumns, WEATHER_SCALE } from '../src/scripts/hero/cloud-columns.ts';

function setup() {
  const columns = createCloudColumns({ uStyle:{value:0}, uCover:{value:.42}, uClear:{value:.6} });
  const original = {}, handler = () => {};
  let active = original, draws = 0;
  const gl = { FRAMEBUFFER:1, FRAMEBUFFER_COMPLETE:2, checkFramebufferStatus:() => 2 };
  const renderer = {
    debug:{onShaderError:handler}, getContext:() => gl, getRenderTarget:() => active,
    setRenderTarget(t) { active = t; }, render() { draws++; },
  };
  return { columns, gl, renderer, handler, original, draws:() => draws };
}

test('weather columns stay aligned to the world as the wind, eye and season change', () => {
  const {columns, renderer, gl, draws} = setup(), weather = {}, u = columns.uniforms;
  const x = -21.45, z = 145.63;
  columns.update(renderer, x, z, weather);
  const initial = u.uColumnAnchor.value.clone(), size = u.uCloudColumns.value.image.height;
  assert.equal(u.uColumnsReady.value, true);
  gl.checkFramebufferStatus = () => assert.fail('fixed targets were already verified for this context');
  columns.update(renderer, x + 1200 * WEATHER_SCALE, z, weather);
  assert.equal(draws(), 2);
  // Include one bilinear footprint, anchor drift, tower displacement and the longest sun probe.
  const reach = (44000 + 1536 + .11 * 6800 + 960) / 96 + 1;
  assert.ok(reach < size / 2);
  columns.update(renderer, x + 44 * 96 * WEATHER_SCALE, z, weather);
  assert.equal(u.uColumnAnchor.value.x - initial.x, 44);
  assert.equal(u.uColumnAnchor.value.y, initial.y);
  assert.equal(draws(), 4);
  columns.update(renderer, x + 44 * 96 * WEATHER_SCALE, z, {});
  assert.equal(draws(), 6);
});

test('a failed column bake uses procedural density and rebuilds after context restoration', () => {
  const {columns, renderer, gl, handler, original, draws} = setup(), weather = {};
  gl.checkFramebufferStatus = () => 0;
  columns.update(renderer, 0, 0, weather);
  assert.equal(columns.uniforms.uColumnsReady.value, false);
  assert.equal(columns.uniforms.uCloudColumns.value, null);
  assert.equal(renderer.getRenderTarget(), original);
  assert.equal(renderer.debug.onShaderError, handler);
  gl.checkFramebufferStatus = () => 2;
  columns.update(renderer, 0, 0, weather);
  assert.equal(draws(), 0);
  columns.restored();
  columns.update(renderer, 0, 0, weather);
  assert.equal(columns.uniforms.uColumnsReady.value, true);
  columns.restored();
  assert.equal(columns.uniforms.uColumnCeilings.value, null);
  renderer.render = () => renderer.debug.onShaderError();
  columns.update(renderer, 0, 0, weather);
  assert.equal(columns.uniforms.uColumnsReady.value, false);
  assert.equal(renderer.getRenderTarget(), original);
  assert.equal(renderer.debug.onShaderError, handler);
});
