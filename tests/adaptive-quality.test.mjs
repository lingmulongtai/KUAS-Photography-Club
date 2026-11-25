import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdaptiveQuality,
  detectQualityRange,
  regionalBudgetForTier,
} from '../src/scripts/hero/adaptive-quality.ts';

test('detectQualityRange classifies software, mobile, desktop and high-spec GPUs sensibly', () => {
  assert.deepEqual(
    detectQualityRange({ cores: 8, memoryGb: 16, coarse: false, width: 1440, quality: 1, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' }),
    { initial: 0, max: 1 },
  );
  assert.deepEqual(
    detectQualityRange({ cores: 4, memoryGb: 4, coarse: true, width: 390, quality: 0.55 }),
    { initial: 0, max: 1 },
  );
  assert.deepEqual(
    detectQualityRange({ cores: 8, memoryGb: 8, coarse: false, width: 1440, quality: 1, renderer: 'Intel Iris Xe' }),
    { initial: 2, max: 3 },
  );
  assert.deepEqual(
    detectQualityRange({ cores: 12, memoryGb: 16, coarse: false, width: 1920, quality: 1, renderer: 'ANGLE (NVIDIA GeForce RTX 4070 Direct3D11)' }),
    { initial: 3, max: 3 },
  );
});

test('regionalBudgetForTier strictly grows draw distances and keeps groundLoad well beyond groundFar', () => {
  const tiers = [0, 1, 2, 3].map((t) => regionalBudgetForTier(t));
  for (let i = 0; i < tiers.length; i++) {
    assert.ok(tiers[i].groundLoad >= tiers[i].groundFar + 12000, `tier ${i} loads ground beyond radial fade`);
    assert.ok(tiers[i].groundUnload >= tiers[i].groundLoad + 8000, `tier ${i} has unload hysteresis`);
    if (i > 0) {
      assert.ok(tiers[i].detailRadius > tiers[i - 1].detailRadius);
      assert.ok(tiers[i].skylineRadius > tiers[i - 1].skylineRadius);
      assert.ok(tiers[i].neighborhoodRadius > tiers[i - 1].neighborhoodRadius);
      assert.ok(tiers[i].neighborhoodFalloff < tiers[i - 1].neighborhoodFalloff);
      assert.ok(tiers[i].groundFar > tiers[i - 1].groundFar);
    }
  }
});

test('createAdaptiveQuality steps down under sustained low FPS and recovers DPR and tier when FPS improves', () => {
  const aq = createAdaptiveQuality(
    { cores: 8, memoryGb: 8, coarse: false, width: 1440, quality: 1, renderer: 'Intel Iris Xe' },
    1.5,
  );
  assert.equal(aq.tier, 2);
  assert.equal(aq.pixelRatio, 1.5);

  let now = 0;
  // Pass initial 3.5 s settle window at normal 60 FPS.
  for (let i = 0; i < 240; i++) {
    now += 1 / 60;
    aq.step(1 / 60, now);
  }
  assert.equal(aq.tier, 2);

  // Sustained slow frames (~25 FPS = 40 ms) should step down tier first.
  for (let i = 0; i < 80; i++) {
    now += 0.04;
    aq.step(0.04, now);
  }
  assert.equal(aq.tier, 1, 'tier steps down from 2 to 1 under sustained 25 FPS');
  assert.equal(aq.pixelRatio, 1.5, 'pixel ratio stays crisp while tier drops first');

  // Continuing slow frames should drop to tier 0 and then reduce DPR.
  for (let i = 0; i < 400; i++) {
    now += 0.045;
    aq.step(0.045, now);
  }
  assert.equal(aq.tier, 0);
  assert.ok(aq.pixelRatio < 1.5, `pixel ratio lowered under sustained heavy load: ${aq.pixelRatio}`);

  // Once frame times recover to 60 FPS, DPR recovers first, then tier promotes back up.
  for (let i = 0; i < 3600; i++) {
    now += 1 / 60;
    aq.step(1 / 60, now);
  }
  assert.equal(aq.pixelRatio, 1.5, 'pixel ratio fully recovers to maxDpr');
  assert.ok(aq.tier >= 1, `tier promotes back up when FPS is steady: ${aq.tier}`);
});

test('brief loading stutter never permanently lowers quality', () => {
  const aq = createAdaptiveQuality(
    { cores: 8, memoryGb: 16, coarse: false, width: 1440, quality: 1 },
    2.0,
  );
  let now = 0;
  for (let i = 0; i < 240; i++) {
    now += 1 / 60;
    aq.step(1 / 60, now);
  }
  // 10 frames of 80 ms loading stutter (< 1 s total) followed by 60 FPS.
  for (let i = 0; i < 10; i++) {
    now += 0.08;
    aq.step(0.08, now);
  }
  for (let i = 0; i < 120; i++) {
    now += 1 / 60;
    aq.step(1 / 60, now);
  }
  assert.equal(aq.tier, 2);
  assert.equal(aq.pixelRatio, 2.0);
});
