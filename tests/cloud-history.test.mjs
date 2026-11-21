import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCloudHistory } from '../src/scripts/hero/cloud-history.ts';

function setup() {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 80000);
  camera.position.set(3200, 230, -1500);
  camera.rotation.y = .9;
  const material = new THREE.ShaderMaterial({ uniforms: { wind: { value: new THREE.Vector2() }, uVolumeOnly: {value:false} } });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const color = new THREE.Color(.3, .2, .1);
  const initialTarget = {}, captures = [], frames = [];
  let target = initialTarget, alpha = .8;
  const gl = { FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, checkFramebufferStatus: () => 2 };
  const renderer = {
    capabilities: { maxTextureSize: 8192 }, debug: { onShaderError: null }, autoClear: true,
    getContext: () => gl, getRenderTarget: () => target, setRenderTarget(t) { target = t; },
    getClearAlpha: () => alpha, getClearColor: t => t.copy(color),
    setClearColor(c, a) { color.set(c); alpha = a; }, clear() {},
    render(scene, eye) {
      assert.equal(scene.children[0].material.uniforms.uVolumeOnly.value,true);
      assert.equal(material.uniforms.uVolumeOnly.value,false);
      captures.push({ target, rect: target.scissor.clone(), eye: eye.quaternion.clone(),
        wind: scene.children[0].material.uniforms.wind.value.x });
    },
  };
  const history = createCloudHistory(renderer, camera, mesh);
  const state = { w: 960, h: 600, weather: {}, travel: 0, date: 1000 };
  function draw() {
    assert.equal(target, initialTarget);
    assert.equal(color.r, .3);
    assert.equal(alpha, .8);
    assert.equal(renderer.autoClear, true);
    const u = mesh.material.uniforms;
    frames.push({ past: u.uCloudPast.value, present: u.uCloudPresent.value, weight: u.uCloudMix.value });
  }
  function step(callback = draw) {
    const result = history.render(state.w, state.h, state.weather, state.travel, state.date, callback, state.elapsed);
    assert.equal(mesh.material, material);
    return result;
  }
  return { camera, material, captures, frames, gl, renderer, state, step, history };
}

test('a slow pan reprojects full-density clouds and shows only complete snapshots', () => {
  const h = setup();
  assert.equal(h.step(), false); // a cut always draws the direct sky
  assert.equal(h.step(), true);
  const seed = h.captures[0];
  assert.ok(seed.rect.width >= 960 * 1.25 && seed.rect.height >= 600 * 1.25);
  assert.equal(h.frames[0].past, h.frames[0].present);
  for (let i = 1; i <= 36; i++) {
    h.camera.rotateY(THREE.MathUtils.degToRad(.5));
    h.material.uniforms.wind.value.x = i;
    assert.equal(h.step(), true, `pan frame ${i}`);
  }
  const strips = h.captures.slice(1, 7);
  let x = 0;
  for (const strip of strips) {
    assert.equal(strip.wind, 1);
    assert.equal(strip.rect.x, x);
    assert.equal(strip.rect.height, seed.rect.height);
    assert.equal(strip.target, strips[0].target);
    assert.equal(strip.eye.angleTo(seed.eye), 0);
    x += strip.rect.width;
  }
  assert.equal(x, seed.rect.width);
  assert.deepEqual(h.frames.slice(1, 7).map(frame => frame.weight), [1, 2, 3, 4, 5, 6].map(i => i / 6));
  assert.equal(h.frames[6].present, seed.target.texture);
  assert.equal(h.frames[7].past, seed.target.texture);
  assert.equal(h.frames[7].present, strips[0].target.texture);
  assert.ok(h.captures.at(-1).eye.angleTo(seed.eye) > .1);
});

test('view changes, time jumps, and weather changes start with a fresh direct frame', () => {
  const h = setup();
  for (const change of [
    () => { h.camera.position.x += 2; }, () => { h.camera.rotateY(.2); },
    () => { h.camera.fov = 40; h.camera.updateProjectionMatrix(); },
    () => { h.state.weather = {}; }, () => { h.state.travel += 1; },
    () => { h.state.date += 5000; }, () => { h.state.w = 970; }, () => h.history.invalidate(),
  ]) {
    change();
    assert.equal(h.step(), false);
    assert.equal(h.step(), true);
    assert.equal(h.frames.at(-1).present, h.frames.at(-1).past);
  }
  h.state.w = 5000; h.state.h = 3000;
  assert.equal(h.step(), false);
  assert.equal(h.step(), false);
});

test('faster frames spread the same full image across more frames with a bounded refresh interval', () => {
  const h = setup();
  h.state.elapsed = 1 / 36;
  h.step();
  let source, width = 0, count = 0;
  for (let i = 0; i < 80; i++) {
    assert.ok(h.step());
    const { target, rect } = h.captures.at(-1);
    if (target !== source) {
      if (source) {
        assert.equal(width, source.width);
        if (i > 50) assert.ok(count >= 10 && count * h.state.elapsed < .34);
      }
      source = target; count = 0; width = 0;
    }
    assert.equal(rect.x, width);
    width += rect.width; count++;
  }
});

test('a full-HD viewport keeps its native sampling within the memory budget and releases it on exit', () => {
  const h = setup();
  h.state.w = 1920; h.state.h = 1080;
  h.camera.aspect = 1920 / 1080; h.camera.updateProjectionMatrix();
  assert.equal(h.step(), false);
  assert.equal(h.step(), true);
  const { target } = h.captures[0];
  assert.ok(target.width >= 1920 * 1.125 && target.height >= 1080 * 1.125);
  assert.ok(target.width * target.height * 3 * 8 <= 64 * 1024 * 1024);
  for (let i = 0; i < 24; i++) {
    h.camera.rotateY(THREE.MathUtils.degToRad(.2));
    assert.equal(h.step(), true);
  }
  let released = 0;
  for (const target of new Set(h.captures.map(capture => capture.target))) {
    target.addEventListener('dispose', () => { released++; });
  }
  h.history.invalidate();
  h.history.invalidate();
  assert.equal(released, 3);
  assert.equal(h.step(), false);
  assert.equal(h.step(), true);
});

test('the high-density panorama spends fewer rays outside the viewport and covers a continuous 18-degree turn', () => {
  const h = setup();
  h.state.w = 1440; h.state.h = 810; h.state.elapsed = 1 / 30;
  h.camera.aspect = 16 / 9; h.camera.updateProjectionMatrix();
  assert.equal(h.step(),false); assert.ok(h.step());
  const {target} = h.captures[0];
  assert.equal(target.width, Math.floor((1440 + 2 * Math.ceil(1440 / 16)) * 1.125));
  for (let i = 0; i < 150; i++) {
    h.camera.rotateY(THREE.MathUtils.degToRad(.12));
    assert.ok(h.step());
  }
});

test('allocation and shader failures restore the live scene and allow context recovery', () => {
  const h = setup();
  const old = console.warn;
  console.warn = () => {};
  try {
    h.gl.checkFramebufferStatus = () => 0;
    assert.equal(h.step(), false);
    assert.equal(h.step(), false);
    assert.equal(h.captures.length, 0);
    h.gl.checkFramebufferStatus = () => 2;
    h.history.restored();
    assert.equal(h.step(), false);
    let errors = 0;
    const handler = () => { errors++; };
    h.renderer.debug.onShaderError = handler;
    assert.equal(h.step(() => h.renderer.debug.onShaderError()), false);
    assert.equal(errors, 1);
    assert.equal(h.renderer.debug.onShaderError, handler);
    assert.equal(h.step(), false);
    h.history.restored();
    assert.equal(h.step(), false);
    assert.equal(h.step(), true);
  } finally { console.warn = old; }
});
