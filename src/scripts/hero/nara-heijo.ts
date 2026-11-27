import {
  addBox,
  addFrustum,
  addIrimoyaRoof,
  addLight,
  addStrut,
  addWaterPolygon,
  makeObbMask,
  makeSite,
  sitePt,
  type GroundFn,
  type LandmarkBuilder,
  type MaskShape,
  type RGB,
  type Vec3,
} from './landmark-builder';

/** Surveyed z15 Heijo Palace water basins (Kentoshi Ship reflecting pool & East Palace Garden pond) in local home metres. */
const HEIJO_WATER_POLYGONS: readonly { name: string; outer: readonly number[] }[] = [
  {
    name: 'kentoshi-pool',
    outer: [3359.2, 35285.5, 3354.8, 35285.5, 3354.8, 35299.2, 3379.3, 35300.5, 3379.8, 35250.3, 3370.2, 35189.1, 3318.8, 35189.4, 3318.8, 35209.4, 3359.2, 35209.4],
  },
  {
    name: 'east-garden',
    outer: [3913.5, 34822.8, 3910.4, 34827.2, 3914.5, 34828.2, 3914.0, 34830.2, 3910.4, 34829.9, 3909.1, 34827.2, 3904.7, 34829.0, 3902.0, 34825.3, 3890.3, 34824.1, 3889.1, 34831.7, 3894.7, 34840.7, 3888.8, 34845.4, 3888.6, 34850.5, 3892.2, 34852.0, 3895.7, 34848.3, 3899.8, 34852.2, 3905.0, 34851.0, 3906.7, 34852.5, 3910.6, 34850.0, 3915.3, 34851.0, 3916.5, 34849.0, 3914.5, 34845.8, 3917.2, 34841.9, 3921.6, 34842.2, 3920.4, 34849.3, 3922.1, 34851.5, 3925.3, 34852.7, 3934.6, 34851.2, 3934.6, 34835.6, 3929.2, 34833.9, 3926.5, 34829.5, 3928.0, 34826.5, 3934.1, 34825.3, 3933.9, 34816.5, 3929.0, 34814.0, 3927.7, 34811.1, 3930.2, 34806.5, 3936.6, 34803.8, 3936.8, 34794.0, 3927.0, 34794.5, 3923.8, 34799.4, 3916.7, 34795.7, 3910.1, 34796.7, 3913.3, 34812.1, 3922.6, 34812.6, 3922.1, 34822.6],
  },
];

/** Exact masks suppressing generic regional blocks inside reconstructed Heijo Palace monuments. */
export const HEIJO_BUILDING_MASKS: readonly MaskShape[] = [
  // First Daigokuden + Daigokumon + Cloister court
  makeObbMask(34.69395, 135.79415, 0, 52, 32),
  makeObbMask(34.69195, 135.79415, 0, 76, 34),
  // Suzakumon + Great Palace Walls
  makeObbMask(34.68705, 135.79430, 0, 128, 22),
  // Suzaku-oji Plaza (Kentoshi Ship + Guidance Hall + Tenpyo Pavilions)
  makeObbMask(34.68595, 135.79595, 0, 72, 46),
  makeObbMask(34.68595, 135.79295, 0, 48, 44),
  // East Palace Garden (東院庭園)
  makeObbMask(34.68967, 135.80240, 0, 56, 54),
];

/** Clear wild procedural trees from Heijo Palace's broad open imperial gravel courts & Suzaku-oji plaza. */
export const HEIJO_TREE_MASKS: readonly MaskShape[] = [
  makeObbMask(34.69295, 135.79415, 0, 82, 165),
  makeObbMask(34.68940, 135.79425, 0, 72, 220),
  makeObbMask(34.68650, 135.79440, 0, 145, 76),
  makeObbMask(34.68967, 135.80240, 0, 52, 48),
];

/**
 * Build UNESCO World Heritage Heijo Palace Site (平城宮跡, Nara) aligned to GSI z17 aerial:
 * - First Daigokuden (第一次大極殿): two-tier white stone podium, triple stairs, vermilion colonnade,
 *   double-tiered authentic irimoya tile roof & twin gleaming golden shibi finials
 * - Daigokuden-in South Gate (大極門 / 南門) + East/West vermilion cloister corridors & corner towers
 * - Suzakumon (朱雀門): grand 2-story vermilion palace main gate + 240 m tile-capped Great Palace Walls (築地大垣)
 * - Kentoshi Envoy Ship (遣唐使船) floating in its surveyed reflecting basin + Guidance Hall (平城宮いざない館)
 * - East Palace Garden (東院庭園): surveyed Nara-era meandering pond, lakeside pavilions & arched vermilion bridge
 */
export function buildHeijoPalace(b: LandmarkBuilder, ground: GroundFn) {
  const vermilion: RGB = [0.76, 0.19, 0.12];
  const vermilionDeep: RGB = [0.62, 0.14, 0.09];
  const whitePlaster: RGB = [0.91, 0.89, 0.84];
  const stonePodium: RGB = [0.76, 0.74, 0.69];
  const stoneTrim: RGB = [0.84, 0.82, 0.77];
  const gravelPale: RGB = [0.80, 0.76, 0.68];
  const tileDark: RGB = [0.24, 0.25, 0.28];
  const goldShibi: RGB = [0.98, 0.80, 0.22];
  const timberDark: RGB = [0.36, 0.24, 0.16];
  const latticeGreen: RGB = [0.22, 0.42, 0.26];

  // =========================================================================
  // 1. First Daigokuden (第一次大極殿 — 34.69395, 135.79415, facing due South)
  // =========================================================================
  {
    const st = makeSite(34.69395, 135.79415, ground, 0, 0.6);
    // Two-tier carved white stone ceremonial podium (基壇: 54 m × 26 m × 3.4 m)
    addBox(b, st, 0, 0, 0, 56, 2.0, 28, stonePodium, { topRgb: stoneTrim, style: 4, emit: 0.16 });
    addBox(b, st, 0, 2.0, 0, 52, 1.4, 24, stoneTrim, { topRgb: stoneTrim, style: 4, emit: 0.18 });
    // Triple grand South stone staircases + central North staircase with vermilion railings
    for (const sx of [-15, 0, 15]) {
      const sw = sx === 0 ? 8.2 : 5.4;
      addBox(b, st, sx, 0, 14.5, sw, 1.8, 4.2, stonePodium, { style: 4, emit: 0.14 });
      addBox(b, st, sx, 1.8, 13.0, sw, 1.4, 2.4, stoneTrim, { style: 4, emit: 0.16 });
      for (const side of [-1, 1]) {
        addBox(b, st, sx + side * (sw * 0.5 + 0.25), 0.8, 14.5, 0.45, 2.6, 4.6, vermilion, { style: 4, emit: 0.24 });
      }
    }
    // Perimeter vermilion balustrade (高欄) around the upper stone podium
    for (const sz of [-11.8, 11.8]) {
      addBox(b, st, -18, 3.4, sz, 15, 1.1, 0.4, vermilion, { style: 4, emit: 0.24 });
      addBox(b, st, 18, 3.4, sz, 15, 1.1, 0.4, vermilion, { style: 4, emit: 0.24 });
    }
    for (const sx of [-25.8, 25.8]) {
      addBox(b, st, sx, 3.4, 0, 0.4, 1.1, 24, vermilion, { style: 4, emit: 0.24 });
    }

    // Lower Hall Core (white plaster walls, green renji-mado lattice windows, vermilion colonnade, y = 3.4..11.2 m)
    addBox(b, st, 0, 3.4, 0, 42, 7.8, 17, whitePlaster, { style: 4, emit: 0.42 });
    // Vermilion front & rear bay columns (9 bays × 4 bays)
    for (let i = -4; i <= 4; i++) {
      const cx = i * 4.9;
      addFrustum(b, st, cx, 3.4, 9.2, 0.46, 0.42, 7.8, 8, vermilion, { style: 4, emit: 0.36 });
      addFrustum(b, st, cx, 3.4, -9.2, 0.46, 0.42, 7.8, 8, vermilion, { style: 4, emit: 0.36 });
      if (i < 4) {
        addBox(b, st, cx + 2.45, 5.2, 8.65, 2.6, 3.4, 0.35, latticeGreen, { style: 4, emit: 0.32 });
      }
    }
    for (const cz of [-4.6, 0, 4.6]) {
      addFrustum(b, st, -21.8, 3.4, cz, 0.46, 0.42, 7.8, 8, vermilion, { style: 4, emit: 0.36 });
      addFrustum(b, st, 21.8, 3.4, cz, 0.46, 0.42, 7.8, 8, vermilion, { style: 4, emit: 0.36 });
    }
    // Lower skirt pent roof (裳階 / lower tier eave, y = 10.6..14.6 m)
    addIrimoyaRoof(b, st, 0, 10.6, 0, 51.0, 25.0, 4.4, tileDark, { ridgeRatio: 0.72, gableRatio: 0.65, emit: 0.14 });

    // Upper Clerestory Hall (y = 13.6..19.2 m, vermilion brackets & white plaster upper bays)
    addBox(b, st, 0, 13.6, 0, 35, 5.6, 13.5, whitePlaster, { style: 4, emit: 0.46 });
    for (let i = -4; i <= 4; i++) {
      addFrustum(b, st, i * 4.2, 13.6, 7.0, 0.38, 0.36, 5.6, 8, vermilion, { style: 4, emit: 0.38 });
      addFrustum(b, st, i * 4.2, 13.6, -7.0, 0.38, 0.36, 5.6, 8, vermilion, { style: 4, emit: 0.38 });
    }
    // Bracket complex cornice belt (組物) under main eaves
    addBox(b, st, 0, 18.6, 0, 37.5, 1.3, 15.8, vermilionDeep, { style: 4, emit: 0.40 });

    // Grand Upper Irimoya Tile Roof with Twin Gleaming Golden Shibi Finials (y = 19.6..27.4 m!)
    addIrimoyaRoof(b, st, 0, 19.6, 0, 48.0, 23.0, 7.8, tileDark, {
      ridgeRatio: 0.56,
      gableRatio: 0.44,
      whiteTrim: whitePlaster,
      shibiRgb: goldShibi,
      shibiSize: 1.55,
      emit: 0.16,
    });
    addLight(b, sitePt(st, 0, 16, 12), [1.0, 0.76, 0.42], 5.6, 0);
  }

  // =========================================================================
  // 2. Daigokuden-in South Gate (大極門 / 南門, 2022) & Vermilion Cloisters (回廊)
  // =========================================================================
  {
    const gm = makeSite(34.69195, 135.79415, ground, 0, 0.5);
    // Luminous pale gravel ceremonial plaza stretching between Daigokumon and First Daigokuden
    addBox(b, gm, 0, 0, -108, 124, 0.55, 196, gravelPale, { topRgb: gravelPale, style: 4 });

    // Daigokumon stone podium + 2-story vermilion gate (22 m × 10 m × 18.5 m)
    addBox(b, gm, 0, 0, 0, 26, 2.0, 13, stonePodium, { topRgb: stoneTrim, style: 4, emit: 0.14 });
    addBox(b, gm, 0, 2.0, 0, 20, 6.2, 8.6, whitePlaster, { style: 4, emit: 0.38 });
    for (let i = -3; i <= 3; i++) {
      addFrustum(b, gm, i * 3.2, 2.0, 4.6, 0.38, 0.35, 6.2, 8, vermilion, { style: 4, emit: 0.34 });
      addFrustum(b, gm, i * 3.2, 2.0, -4.6, 0.38, 0.35, 6.2, 8, vermilion, { style: 4, emit: 0.34 });
    }
    // Lower skirt eave + upper story + authentic irimoya roof with golden shibi
    addIrimoyaRoof(b, gm, 0, 7.8, 0, 26, 13.5, 2.8, tileDark, { ridgeRatio: 0.68, emit: 0.12 });
    addBox(b, gm, 0, 10.2, 0, 17, 3.6, 7.2, whitePlaster, { style: 4, emit: 0.42 });
    addBox(b, gm, 0, 13.4, 0, 18.2, 0.9, 8.2, vermilionDeep, { style: 4, emit: 0.36 });
    addIrimoyaRoof(b, gm, 0, 14.1, 0, 24.5, 12.6, 4.8, tileDark, {
      ridgeRatio: 0.55,
      whiteTrim: whitePlaster,
      shibiRgb: goldShibi,
      shibiSize: 1.0,
      emit: 0.14,
    });

    // Flanking East & West Vermilion Cloister Wing Corridors (築地回廊) + Corner Watchtowers (東楼・西楼)
    for (const side of [-1, 1]) {
      const wx = side * 36;
      addBox(b, gm, wx, 0, 0, 48, 1.2, 7.6, stonePodium, { style: 4 });
      addBox(b, gm, wx, 1.2, 0, 48, 4.4, 6.0, whitePlaster, { style: 4, emit: 0.30 });
      for (let k = -20; k <= 20; k += 5) {
        addFrustum(b, gm, wx + k, 1.2, 3.2, 0.28, 0.26, 4.4, 6, vermilion, { style: 4, emit: 0.28 });
        addFrustum(b, gm, wx + k, 1.2, -3.2, 0.28, 0.26, 4.4, 6, vermilion, { style: 4, emit: 0.28 });
      }
      addIrimoyaRoof(b, gm, wx, 5.4, 0, 50, 8.8, 2.6, tileDark, { ridgeRatio: 0.90, emit: 0.10 });
      // Corner Watchtower Pavilion (東楼・西楼) at ±62 m
      const tx = side * 62;
      addBox(b, gm, tx, 0, 0, 13, 1.8, 13, stonePodium, { style: 4 });
      addBox(b, gm, tx, 1.8, 0, 10.5, 8.2, 10.5, whitePlaster, { style: 4, emit: 0.38 });
      addBox(b, gm, tx, 5.5, 0, 11.2, 0.9, 11.2, vermilion, { style: 4, emit: 0.32 });
      addIrimoyaRoof(b, gm, tx, 9.8, 0, 14.5, 14.5, 4.2, tileDark, { ridgeRatio: 0.45, whiteTrim: whitePlaster, emit: 0.12 });
    }
    addLight(b, sitePt(gm, 0, 12, 8), [1.0, 0.74, 0.40], 4.8, 0);
  }

  // =========================================================================
  // 3. Suzakumon (朱雀門 — 34.68705, 135.79430) & Great Palace Walls (築地大垣)
  // =========================================================================
  {
    const sz = makeSite(34.68705, 135.79430, ground, 0, 0.6);
    // Broad pale-gravel Suzaku-oji ceremonial forecourt south of Suzakumon
    addBox(b, sz, 0, 0, 48, 72, 0.55, 86, gravelPale, { topRgb: gravelPale, style: 4 });

    // Suzakumon elevated two-tier white stone base (28 m × 14 m × 2.2 m) + triple wooden stair flights
    addBox(b, sz, 0, 0, 0, 29, 2.2, 14.5, stonePodium, { topRgb: stoneTrim, style: 4, emit: 0.16 });
    for (const sx of [-7, 0, 7]) {
      addBox(b, sz, sx, 0, 8.2, 4.2, 1.9, 3.2, stoneTrim, { style: 4, emit: 0.14 });
      addBox(b, sz, sx, 0, -8.2, 4.2, 1.9, 3.2, stoneTrim, { style: 4, emit: 0.14 });
    }
    // Lower Story (5 bays × 2 bays, massive vermilion pillars + recessed triple imperial red portal doors!)
    addBox(b, sz, 0, 2.2, 0, 23, 6.8, 9.0, whitePlaster, { style: 4, emit: 0.44 });
    for (const dx of [-6.4, 0, 6.4]) {
      addBox(b, sz, dx, 2.2, 4.6, 3.6, 5.6, 0.5, vermilionDeep, { style: 4, emit: 0.38 });
    }
    for (let i = -3; i <= 3; i++) {
      addFrustum(b, sz, i * 3.8, 2.2, 5.0, 0.44, 0.40, 6.8, 8, vermilion, { style: 4, emit: 0.42 });
      addFrustum(b, sz, i * 3.8, 2.2, -5.0, 0.44, 0.40, 6.8, 8, vermilion, { style: 4, emit: 0.42 });
    }
    // Lower flared eaves (y = 8.8..12.2 m)
    addIrimoyaRoof(b, sz, 0, 8.8, 0, 30.5, 16.0, 3.4, tileDark, { ridgeRatio: 0.68, emit: 0.14 });

    // Upper Gallery Story with vermilion balcony balustrade & lattice windows (y = 11.6..16.2 m)
    addBox(b, sz, 0, 11.6, 0, 20.5, 4.6, 8.0, whitePlaster, { style: 4, emit: 0.48 });
    addBox(b, sz, 0, 11.8, 4.5, 22.0, 1.1, 0.4, vermilion, { style: 4, emit: 0.42 });
    addBox(b, sz, 0, 11.8, -4.5, 22.0, 1.1, 0.4, vermilion, { style: 4, emit: 0.42 });
    addBox(b, sz, 0, 15.8, 0, 22.2, 1.0, 9.2, vermilionDeep, { style: 4, emit: 0.40 });

    // Iconic Sweeping Upper Irimoya Tile Roof with Twin Golden Shibi Finials (y = 16.5..22.4 m!)
    addIrimoyaRoof(b, sz, 0, 16.5, 0, 29.0, 15.2, 5.9, tileDark, {
      ridgeRatio: 0.56,
      gableRatio: 0.44,
      whiteTrim: whitePlaster,
      shibiRgb: goldShibi,
      shibiSize: 1.25,
      emit: 0.16,
    });

    // Grand White-and-Vermilion Tile-Capped Palace Perimeter Walls (築地大垣) stretching 115 m East & West!
    for (const side of [-1, 1]) {
      const wx = side * 72;
      addBox(b, sz, wx, 0, 0, 114, 1.0, 3.6, stonePodium, { style: 4 });
      addBox(b, sz, wx, 1.0, 0, 114, 4.4, 2.2, whitePlaster, { style: 4, emit: 0.24 });
      for (let k = -52; k <= 52; k += 8) {
        addBox(b, sz, wx + k, 1.0, 0, 0.45, 4.4, 2.45, vermilion, { style: 4, emit: 0.22 });
      }
      addIrimoyaRoof(b, sz, wx, 5.2, 0, 116, 4.6, 1.6, tileDark, { ridgeRatio: 0.96, emit: 0.08 });
    }
    addLight(b, sitePt(sz, 0, 13, 9), [1.0, 0.72, 0.36], 5.6, 0);
  }

  // =========================================================================
  // 4. Kentoshi Envoy Ship (遣唐使船) & Suzaku-oji Plaza Pavilions (34.68595, 135.79595)
  // =========================================================================
  {
    const poolBaseY = ground(3350, 35245) + 0.35;
    const poolPoly = HEIJO_WATER_POLYGONS.find((p) => p.name === 'kentoshi-pool');
    if (poolPoly) addWaterPolygon(b, poolPoly.outer, poolBaseY, [0.06, 0.22, 0.30]);

    // Full-size Reconstructed Tang-Era Kentoshi Envoy Ship (30 m long, vermilion & white wooden hull + twin masts!)
    const ship = makeSite(34.68592, 135.79595, ground, 0.04, 0.2);
    // Lower dark-timber hull & curved red-and-white bulwarks
    addBox(b, ship, 0, 0.5, 0, 7.6, 2.8, 22, vermilion, { topRgb: [0.68, 0.52, 0.34], style: 4, emit: 0.35 });
    // Swept high prow (South) & stern (North) hull extensions
    addBox(b, ship, 0, 1.8, 12.8, 6.2, 3.0, 5.2, vermilion, { topRgb: whitePlaster, style: 4, emit: 0.38 });
    addBox(b, ship, 0, 1.8, -12.8, 6.4, 3.2, 5.2, vermilion, { topRgb: whitePlaster, style: 4, emit: 0.38 });
    addBox(b, ship, 0, 3.2, 0, 7.8, 0.55, 22.4, whitePlaster, { style: 4, emit: 0.42 });
    // Central Tang-style white-and-red deckhouse cabin
    addBox(b, ship, 0, 3.3, -1.5, 5.2, 2.8, 10.5, whitePlaster, { style: 4, emit: 0.48 });
    addIrimoyaRoof(b, ship, 0, 6.0, -1.5, 6.4, 12.0, 1.8, vermilionDeep, { ridgeRatio: 0.80, emit: 0.30 });
    // Twin tall wooden masts & horizontal bamboo-lath yardarms
    for (const [mz, mh] of [[-5.5, 16.5], [5.8, 14.5]] as const) {
      addFrustum(b, ship, 0, 3.3, mz, 0.34, 0.20, mh, 8, timberDark, { style: 4, emit: 0.20 });
      addStrut(b, sitePt(ship, -5.6, 3.3 + mh * 0.72, mz), sitePt(ship, 5.6, 3.3 + mh * 0.72, mz), 0.16, 0.16, 6, timberDark, 0.16);
    }
    addLight(b, sitePt(ship, 0, 9.5, 0), [1.0, 0.76, 0.40], 4.6, 0);

    // Heijo Palace Guidance Hall (平城宮いざない館) & Tenpyo Plaza Pavilions flanking Suzaku-oji
    const plaza = makeSite(34.68595, 135.79505, ground, 0, 0.5);
    addBox(b, plaza, 0, 0, 0, 32, 8.2, 48, [0.46, 0.44, 0.42], { topRgb: tileDark, style: 4, emit: 0.38 });
    addIrimoyaRoof(b, plaza, 0, 8.0, 0, 35, 51, 3.8, tileDark, { ridgeRatio: 0.75, emit: 0.10 });
    const westPlaza = makeSite(34.68595, 135.79295, ground, 0, 0.5);
    for (const [wx, wz, ww, wd] of [[-14, 0, 18, 42], [16, -6, 16, 26], [16, 18, 16, 16]] as const) {
      addBox(b, westPlaza, wx, 0, wz, ww, 6.8, wd, [0.54, 0.50, 0.46], { style: 4, emit: 0.36 });
      addIrimoyaRoof(b, westPlaza, wx, 6.6, wz, ww + 2.4, wd + 2.4, 2.8, tileDark, { ridgeRatio: 0.76, emit: 0.10 });
    }
  }

  // =========================================================================
  // 5. East Palace Garden (東院庭園 — 34.68967, 135.80240)
  // =========================================================================
  {
    const pondY = ground(3915, 34830) + 0.35;
    const pondPoly = HEIJO_WATER_POLYGONS.find((p) => p.name === 'east-garden');
    if (pondPoly) addWaterPolygon(b, pondPoly.outer, pondY, [0.05, 0.20, 0.24]);

    const eg = makeSite(34.68967, 135.80240, ground, 0, 0.4);
    // Central Lakeside Pavilion (中央建物) jutting out over the calm imperial pond!
    addBox(b, eg, -14, 0.2, 0, 15, 1.4, 10, stonePodium, { style: 4 });
    addBox(b, eg, -14, 1.6, 0, 13, 4.4, 8, whitePlaster, { style: 4, emit: 0.40 });
    for (let x = -19; x <= -9; x += 3.3) {
      addFrustum(b, eg, x, 1.6, 4.2, 0.26, 0.24, 4.4, 6, vermilion, { style: 4, emit: 0.35 });
      addFrustum(b, eg, x, 1.6, -4.2, 0.26, 0.24, 4.4, 6, vermilion, { style: 4, emit: 0.35 });
    }
    addIrimoyaRoof(b, eg, -14, 5.8, 0, 17, 11.5, 3.2, tileDark, { ridgeRatio: 0.58, whiteTrim: whitePlaster, emit: 0.12 });

    // South-East Corner Lookout Pavilion (隅楼) + North Imperial Banquet Hall
    addBox(b, eg, 24, 0, 16, 11, 6.2, 11, whitePlaster, { style: 4, emit: 0.36 });
    addIrimoyaRoof(b, eg, 24, 6.0, 16, 14, 14, 3.4, tileDark, { ridgeRatio: 0.42, emit: 0.12 });
    addBox(b, eg, 4, 0, -28, 22, 5.4, 10, whitePlaster, { style: 4, emit: 0.34 });
    addIrimoyaRoof(b, eg, 4, 5.2, -28, 26, 13, 3.2, tileDark, { ridgeRatio: 0.62, emit: 0.12 });

    // Arched Vermilion-Railed Timber Garden Bridge arching gracefully across the pond!
    const segs = 8;
    let prevL: Vec3 | null = null, prevR: Vec3 | null = null;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const bx = -4 + t * 18;
      const by = 1.0 + Math.sin(t * Math.PI) * 1.9;
      const pL = sitePt(eg, bx, by, -1.3);
      const pR = sitePt(eg, bx, by, 1.3);
      if (prevL && prevR) {
        addStrut(b, prevL, pL, 0.30, 0.30, 4, vermilion, 0.34);
        addStrut(b, prevR, pR, 0.30, 0.30, 4, vermilion, 0.34);
        addStrut(b, sitePt(eg, bx - 1.1, by - 0.35, 0), sitePt(eg, bx + 1.1, by - 0.35, 0), 1.2, 1.2, 4, timberDark, 0.18);
      }
      prevL = pL;
      prevR = pR;
    }
    addLight(b, sitePt(eg, -6, 6.5, 0), [1.0, 0.78, 0.44], 4.2, 0);
  }
}
