export type QualityTier = 0 | 1 | 2 | 3;

export interface RegionalQualityBudget {
  tier: QualityTier;
  /** Circular radius in zoom-16 (~500 m) tiles for detailed 3D regional buildings and streets. */
  detailRadius: number;
  /** Circular radius in zoom-12 (~8 km) tiles for distant skyline buildings. */
  skylineRadius: number;
  /** Maximum concurrent zoom-16/zoom-12 builds. */
  buildingConcurrency: number;
  /** Circular radius in zoom-12 (~8 km) tiles for residential neighborhood roof batches. */
  neighborhoodRadius: number;
  /** Density falloff divisor for distant neighborhoods (lower retains denser roofs farther out). */
  neighborhoodFalloff: number;
  /** Spherical Euclidean horizon fade radius for regional ground (metres, well inside camera.far). */
  groundFar: number;
  /** Ground patch load radius (metres, strictly larger than groundFar so patches load before fading in). */
  groundLoad: number;
  /** Ground patch unload radius (metres, with hysteresis over groundLoad). */
  groundUnload: number;
  /** Maximum concurrent ground patch downloads/uploads. */
  groundConcurrency: number;
  /** Live close-up orthophoto grid radius (1 => 3x3 tiles, 2 => 5x5 tiles). */
  photoRadius: 1 | 2;
  /** Maximum live GSI orthophoto zoom level when close to the ground. */
  photoMaxZoom: 16 | 17;
}

const BUDGETS: readonly RegionalQualityBudget[] = [
  {
    tier: 0,
    detailRadius: 2.6,
    skylineRadius: 2.6,
    buildingConcurrency: 2,
    neighborhoodRadius: 2.8,
    neighborhoodFalloff: 1.75,
    groundFar: 62000,
    groundLoad: 74000,
    groundUnload: 82000,
    groundConcurrency: 2,
    photoRadius: 1,
    photoMaxZoom: 16,
  },
  {
    tier: 1,
    detailRadius: 3.8,
    skylineRadius: 3.6,
    buildingConcurrency: 2,
    neighborhoodRadius: 3.8,
    neighborhoodFalloff: 1.05,
    groundFar: 76000,
    groundLoad: 88000,
    groundUnload: 96000,
    groundConcurrency: 2,
    photoRadius: 2,
    photoMaxZoom: 17,
  },
  {
    tier: 2,
    detailRadius: 5.0,
    skylineRadius: 4.5,
    buildingConcurrency: 3,
    neighborhoodRadius: 4.8,
    neighborhoodFalloff: 0.65,
    groundFar: 92000,
    groundLoad: 106000,
    groundUnload: 114000,
    groundConcurrency: 3,
    photoRadius: 2,
    photoMaxZoom: 17,
  },
  {
    tier: 3,
    detailRadius: 6.2,
    skylineRadius: 5.5,
    buildingConcurrency: 4,
    neighborhoodRadius: 5.6,
    neighborhoodFalloff: 0.4,
    groundFar: 108000,
    groundLoad: 122000,
    groundUnload: 130000,
    groundConcurrency: 3,
    photoRadius: 2,
    photoMaxZoom: 17,
  },
];

export function regionalBudgetForTier(tier: QualityTier): RegionalQualityBudget {
  return BUDGETS[Math.max(0, Math.min(3, tier)) as QualityTier];
}

export interface HardwareSpec {
  cores: number;
  memoryGb?: number;
  coarse: boolean;
  width: number;
  quality: number;
  renderer?: string;
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;
const STRONG_GPU = /\b(rtx|gtx\s*(?:10[78]|16[6]|20|30|40|50)|radeon\s*(?:rx|pro)|apple\s*m[1-9]|arc\s*a[57]|quadro|geforce)\b/i;

/** Pick starting and ceiling quality tiers from static hardware hints before live FPS is observed. */
export function detectQualityRange(spec: HardwareSpec): { initial: QualityTier; max: QualityTier } {
  const renderer = spec.renderer ?? '';
  if (SOFTWARE_RENDERER.test(renderer)) {
    return { initial: 0, max: 1 };
  }
  const lowRam = spec.memoryGb !== undefined && spec.memoryGb <= 2;
  const midRam = spec.memoryGb !== undefined && spec.memoryGb <= 4;
  if (lowRam || (spec.coarse && spec.cores <= 4)) {
    return { initial: 0, max: 1 };
  }
  if (spec.coarse || spec.width < 900 || spec.quality < 0.75 || midRam) {
    return { initial: 1, max: spec.coarse ? 2 : 3 };
  }
  if (STRONG_GPU.test(renderer) && spec.cores >= 8 && (spec.memoryGb === undefined || spec.memoryGb >= 8)) {
    return { initial: 3, max: 3 };
  }
  return { initial: 2, max: 3 };
}

export interface AdaptiveQualityState {
  tier: QualityTier;
  pixelRatio: number;
  budget: RegionalQualityBudget;
  tierChanged: boolean;
  dprChanged: boolean;
}

/**
 * Bidirectional runtime quality controller: lowers regional draw distance or pixel ratio when
 * sustained FPS drops, and smoothly restores sharpness and higher draw-distance tiers once
 * frame pacing shows steady headroom.
 */
export function createAdaptiveQuality(spec: HardwareSpec, initialMaxDpr: number) {
  const { initial, max: maxTier } = detectQualityRange(spec);
  let tier: QualityTier = initial;
  let maxDpr = Math.max(0.75, initialMaxDpr);
  let pixelRatio = maxDpr;
  let emaMs = 16.67;
  let slowSeconds = 0;
  let fastSeconds = 0;
  let lastChangeAt = -Infinity;
  let promoteCooldown = 8;
  let startedAt: number | undefined;

  const minDpr = 0.75;
  const dprStep = 0.25;

  function snapshot(tierChanged = false, dprChanged = false): AdaptiveQualityState {
    return {
      tier,
      pixelRatio,
      budget: regionalBudgetForTier(tier),
      tierChanged,
      dprChanged,
    };
  }

  return {
    get tier() { return tier; },
    get maxTier() { return maxTier; },
    get pixelRatio() { return pixelRatio; },
    get budget() { return regionalBudgetForTier(tier); },
    setMaxDpr(nextMax: number) {
      const clamped = Math.max(minDpr, nextMax);
      const prevMax = maxDpr;
      maxDpr = clamped;
      if (pixelRatio > clamped) {
        pixelRatio = clamped;
      } else if (Math.abs(pixelRatio - prevMax) < 1e-3) {
        pixelRatio = clamped;
      }
      return pixelRatio;
    },
    step(dt: number, nowSec: number, settleHold = false): AdaptiveQualityState {
      if (dt <= 0 || !Number.isFinite(dt)) return snapshot();
      startedAt ??= nowSec;
      // Ignore single-frame spikes (tab switch / initial shader compile) so they never permanently latch low quality.
      const clampedMs = Math.min(80, dt * 1000);
      emaMs = emaMs * 0.88 + clampedMs * 0.12;

      if (settleHold || nowSec - startedAt < 3.5) {
        slowSeconds = 0;
        fastSeconds = 0;
        return snapshot();
      }

      const isSlow = emaMs > 30; // < ~33 FPS sustained
      const isFast = emaMs < 19.5; // > ~51 FPS sustained

      if (isSlow) {
        slowSeconds += dt;
        fastSeconds = Math.max(0, fastSeconds - dt * 2);
      } else if (isFast) {
        fastSeconds += dt;
        slowSeconds = Math.max(0, slowSeconds - dt * 2);
      } else {
        slowSeconds = Math.max(0, slowSeconds - dt * 0.5);
        fastSeconds = Math.max(0, fastSeconds - dt * 0.5);
      }

      // Downgrade quickly when frame rate stays below target for > 2.2 s.
      if (slowSeconds >= 2.2 && nowSec - lastChangeAt >= 4.5) {
        slowSeconds = 0;
        fastSeconds = 0;
        lastChangeAt = nowSec;
        promoteCooldown = Math.min(14, promoteCooldown * 1.4);
        // Trim draw-distance tier first while above tier 0, then trim pixel density if still slow.
        if (tier > 0 && pixelRatio >= Math.min(maxDpr, 1.0)) {
          tier = (tier - 1) as QualityTier;
          return snapshot(true, false);
        }
        if (pixelRatio > minDpr + 1e-3) {
          pixelRatio = Math.max(minDpr, Math.round((pixelRatio - dprStep) * 100) / 100);
          return snapshot(false, true);
        }
        if (tier > 0) {
          tier = (tier - 1) as QualityTier;
          return snapshot(true, false);
        }
      }

      // Recover sharpness first, then promote regional draw-distance tier when headroom is steady.
      if (fastSeconds >= 4.0 && nowSec - lastChangeAt >= promoteCooldown) {
        fastSeconds = 0;
        slowSeconds = 0;
        lastChangeAt = nowSec;
        promoteCooldown = Math.max(8, promoteCooldown * 0.85);
        if (pixelRatio < maxDpr - 1e-3) {
          pixelRatio = Math.min(maxDpr, Math.round((pixelRatio + dprStep) * 100) / 100);
          return snapshot(false, true);
        }
        if (tier < maxTier && emaMs < 18.5) {
          tier = (tier + 1) as QualityTier;
          return snapshot(true, false);
        }
      }

      return snapshot();
    },
  };
}
