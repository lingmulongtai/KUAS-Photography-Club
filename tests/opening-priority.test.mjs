import test from 'node:test';
import assert from 'node:assert/strict';
import { openingPriorities } from '../src/scripts/hero/opening-priority.ts';
import { VIEWS } from '../src/scripts/hero/views.ts';

test('Shogunzuka defers behind-camera Yamashina/Biwa to interaction and distant south/otokuni to after-open', () => {
  const p = openingPriorities(VIEWS.shogunzuka);
  assert.equal(p.yamashina, 'onInteract');
  assert.equal(p.yamashinaBasin, 'onInteract');
  assert.equal(p.eastBackdrop, 'onInteract');
  assert.equal(p.biwa, 'onInteract');
  assert.equal(p.south, 'afterOpen');
  assert.equal(p.otokuni, 'afterOpen');
  assert.equal(p.otokuniTennozan, 'afterOpen');
});

test('Kameoka Terrace defers all off-frustum Kyoto basin surrounding layers to interaction', () => {
  const p = openingPriorities(VIEWS.kameokaTerrace);
  assert.deepEqual(p, {
    south: 'onInteract',
    yamashina: 'onInteract',
    yamashinaBasin: 'onInteract',
    otokuni: 'onInteract',
    otokuniTennozan: 'onInteract',
    eastBackdrop: 'onInteract',
    biwa: 'onInteract',
  });
});

test('Tennozan loads foreground southern and Otokuni surveys before open while deferring distant Yamashina', () => {
  const p = openingPriorities(VIEWS.tennozan);
  assert.equal(p.south, 'opening');
  assert.equal(p.otokuni, 'opening');
  assert.equal(p.otokuniTennozan, 'opening');
  assert.equal(p.biwa, 'opening');
  assert.equal(p.yamashina, 'afterOpen');
  assert.equal(p.yamashinaBasin, 'afterOpen');
  assert.equal(p.eastBackdrop, 'afterOpen');
});

test('Daimonji loads immediate Yamashina foreground before open and defers distant south/otokuni and behind-camera Biwa', () => {
  const p = openingPriorities(VIEWS.daimonji);
  assert.equal(p.yamashina, 'opening');
  assert.equal(p.yamashinaBasin, 'opening');
  assert.equal(p.eastBackdrop, 'opening');
  assert.equal(p.biwa, 'onInteract');
  assert.equal(p.south, 'afterOpen');
  assert.equal(p.otokuni, 'afterOpen');
  assert.equal(p.otokuniTennozan, 'afterOpen');
});

test('Atago keeps visible Lake Biwa in opening while deferring distant cross-basin resident surveys', () => {
  const p = openingPriorities(VIEWS.atago);
  assert.equal(p.biwa, 'opening');
  assert.equal(p.south, 'afterOpen');
  assert.equal(p.yamashina, 'afterOpen');
  assert.equal(p.otokuni, 'afterOpen');
});
