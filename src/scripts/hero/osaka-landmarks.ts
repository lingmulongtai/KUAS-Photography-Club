import type * as THREE from 'three';
import type { Env } from './env';
import {
  addAnnulusRing,
  addBox,
  addDome,
  addFrustum,
  addLight,
  addRectWithCircularAperture,
  addStrut,
  addTubeSpline,
  createLandmarkBuilder,
  finalizeLandmarkGroup,
  inMaskShapes,
  makeCircleMask,
  makeObbMask,
  makeSite,
  pushQuad,
  pushTri,
  siteNrm,
  sitePt,
  type GroundFn,
  type LandmarkBuilder,
  type MaskShape,
  type RGB,
  type Vec3,
} from './landmark-builder';
import { UMEDA_BUILDING_MASKS, UMEDA_TREE_MASKS, buildOsakaUmeda } from './osaka-umeda';

/** Exact GSI z17 surveyed positions of Osaka's signature skyline landmarks. */
export const OSAKA_SKYLINE_SITES = {
  abenoHarukas: { lat: 34.646181, lon: 135.513396, rotY: 0.284, maskRadius: 68 },
  umedaSky: { lat: 34.705244, lon: 135.490177, rotY: 0.072, maskRadius: 76 },
  tsutenkaku: { lat: 34.652540, lon: 135.506305, rotY: 0.273, maskRadius: 26 },
} as const;

const CORE_OSAKA_MASKS: MaskShape[] = [
  // Abeno Harukas Tower + Kintetsu Wing Building (oriented +0.284 rad)
  makeObbMask(34.646181, 135.513396, 0.284, 52, 42),
  makeObbMask(34.64596, 135.51425, 0.284, 44, 34),
  // Umeda Sky Building + Shin-Umeda City plaza (oriented +0.072 rad)
  makeObbMask(34.705244, 135.490177, 0.072, 60, 36),
  // Tsutenkaku Tower (oriented +0.273 rad)
  makeCircleMask(34.652540, 135.506305, 25),
];

const EXTRA_BUILDING_MASKS: MaskShape[] = [...UMEDA_BUILDING_MASKS];
const EXTRA_TREE_MASKS: MaskShape[] = [...UMEDA_TREE_MASKS];

/** Register additional bespoke district building & tree masks (Umeda, USJ, Heijo Palace). */
export function registerLandmarkMasks(buildings: readonly MaskShape[], trees: readonly MaskShape[] = []) {
  EXTRA_BUILDING_MASKS.push(...buildings);
  EXTRA_TREE_MASKS.push(...trees);
}

/** True when a generic skyline/regional building sits inside any bespoke Kansai landmark footprint. */
export function inOsakaLandmarkMask(x: number, z: number): boolean {
  return inMaskShapes(CORE_OSAKA_MASKS, x, z) || inMaskShapes(EXTRA_BUILDING_MASKS, x, z);
}

/** True when wild procedural trees should yield to landscaped plazas, water basins, or palace gravel courts. */
export function inLandmarkTreeExclusion(x: number, z: number): boolean {
  return inMaskShapes(EXTRA_TREE_MASKS, x, z);
}

function glassCrown(c: RGB): RGB {
  return [c[0] * 0.62, c[1] * 0.72, c[2] * 0.84];
}

/** Build Abeno Harukas (300 m) + Kintetsu Wing Building + "a"-shaped Abeno Pedestrian Overpass. */
function buildAbenoHarukas(b: LandmarkBuilder, ground: GroundFn) {
  const st = makeSite(
    OSAKA_SKYLINE_SITES.abenoHarukas.lat,
    OSAKA_SKYLINE_SITES.abenoHarukas.lon,
    ground,
    OSAKA_SKYLINE_SITES.abenoHarukas.rotY,
    2.0,
  );
  const glassPodium: RGB = [0.22, 0.34, 0.44];
  const glassMid: RGB = [0.21, 0.36, 0.50];
  const glassUpper: RGB = [0.28, 0.44, 0.58];
  const glassCrownCol: RGB = [0.38, 0.56, 0.68];
  const frameSilver: RGB = [0.80, 0.83, 0.87];
  const frameLight: RGB = [0.90, 0.92, 0.95];
  const stoneWarm: RGB = [0.74, 0.71, 0.66];
  const louverDark: RGB = [0.15, 0.18, 0.22];
  const warmDeck: RGB = [0.60, 0.50, 0.36];
  const gardenGreen: RGB = [0.16, 0.35, 0.14];
  const padYellow: RGB = [0.94, 0.80, 0.18];

  // --- Tier 1: Kintetsu Department Store Tower Building (0–82 m, 88 m × 66 m) ---
  addBox(b, st, 0, 0, 0, 84, 11.5, 62, [0.18, 0.24, 0.31], { emit: 0.72, glass: 0.90, style: 2 });
  addBox(b, st, 0, 11.0, 0, 91, 1.8, 69, frameSilver, { emit: 0.24, includeBottom: true });
  addBox(b, st, 0, 12.2, 0, 88, 69.8, 66, glassPodium, {
    topRgb: [0.54, 0.56, 0.59], emit: 0.50, glass: 0.82, style: 1,
  });
  // Horizontal cornice ribbons + vertical silver architectural pilaster fins
  for (const fy of [27, 45, 63]) {
    addBox(b, st, 0, fy, 0, 89.2, 1.0, 67.2, frameSilver, { emit: 0.14 });
  }
  for (let x = -38; x <= 38; x += 9.5) {
    addBox(b, st, x, 12.2, 33.2, 1.0, 69.8, 1.0, frameSilver, { emit: 0.10 });
    addBox(b, st, x, 12.2, -33.2, 1.0, 69.8, 1.0, frameSilver, { emit: 0.10 });
  }
  for (let z = -26; z <= 26; z += 10.4) {
    addBox(b, st, -44.2, 12.2, z, 1.0, 69.8, 1.0, frameSilver, { emit: 0.10 });
    addBox(b, st, 44.2, 12.2, z, 1.0, 69.8, 1.0, frameSilver, { emit: 0.10 });
  }

  // --- Kintetsu Wing Building immediately East (+78 m along local +X, 0–48 m) ---
  addBox(b, st, 78, 0, -2, 74, 46, 56, stoneWarm, { topRgb: [0.58, 0.59, 0.61], emit: 0.34, glass: 0.45, style: 1 });
  addBox(b, st, 78, 46, -2, 75.2, 1.6, 57.2, frameLight, { emit: 0.18 });
  // Wing rooftop garden & glazed sky-courtyard linking to the Tower Building
  addBox(b, st, 74, 47.6, -4, 42, 0.8, 28, warmDeck, { topRgb: warmDeck, style: 4 });
  addBox(b, st, 68, 48.4, -12, 18, 1.2, 10, gardenGreen, { topRgb: gardenGreen, style: 4 });
  addBox(b, st, 86, 48.4, 8, 18, 1.2, 12, gardenGreen, { topRgb: gardenGreen, style: 4 });
  addBox(b, st, 42, 18, -2, 14, 24, 34, glassPodium, { emit: 0.42, glass: 0.86, style: 2 });

  // --- 16F Outdoor Sky Garden Terrace (82 m) on the East/South podium setback ---
  addBox(b, st, 0, 81.2, 0, 90.2, 1.8, 68.2, frameLight, { emit: 0.34, style: 3 });
  addBox(b, st, 22, 83.0, 2, 34, 0.8, 54, warmDeck, { topRgb: warmDeck, emit: 0.22, style: 4 });
  addBox(b, st, 25, 83.8, -12, 16, 1.4, 16, gardenGreen, { topRgb: gardenGreen, style: 4 });
  addBox(b, st, 24, 83.8, 12, 18, 1.4, 18, gardenGreen, { topRgb: gardenGreen, style: 4 });
  addBox(b, st, 2, 83.8, 26, 36, 1.4, 9, gardenGreen, { topRgb: gardenGreen, style: 4 });
  // Perimeter glazed balustrade around the 16F Sky Garden
  addBox(b, st, 44.4, 83.0, 0, 0.6, 2.3, 66.4, glassCrownCol, { emit: 0.30, glass: 0.90, style: 2 });
  addBox(b, st, 18, 83.0, 33.4, 52, 2.3, 0.6, glassCrownCol, { emit: 0.30, glass: 0.90, style: 2 });

  // --- Tier 2: Mid-Rise Office Block (82–186 m, 62 m × 56 m stepped toward West/NW) ---
  const mx = -11, mz = -4;
  addBox(b, st, mx, 82, mz, 62, 104, 56, glassMid, {
    topRgb: [0.56, 0.60, 0.64], emit: 0.58, glass: 0.93, style: 1,
  });
  addBox(b, st, mx, 126, mz, 62.6, 4.4, 56.6, louverDark, { emit: 0.06 });
  addBox(b, st, mx, 180, mz, 62.8, 5.2, 56.8, louverDark, { emit: 0.08 });
  // Full-height projecting Cesar Pelli silver pinstripe blade fins
  for (let x = -28; x <= 28; x += 7) {
    addBox(b, st, mx + x, 82, mz + 28.2, 0.8, 104, 1.15, frameSilver, { emit: 0.12 });
    addBox(b, st, mx + x, 82, mz - 28.2, 0.8, 104, 1.15, frameSilver, { emit: 0.12 });
  }
  for (let z = -24; z <= 24; z += 8) {
    addBox(b, st, mx + 31.2, 82, mz + z, 1.15, 104, 0.8, frameSilver, { emit: 0.12 });
    addBox(b, st, mx - 31.2, 82, mz + z, 1.15, 104, 0.8, frameSilver, { emit: 0.12 });
  }
  for (const sx of [-30.8, 30.8]) for (const sz of [-27.8, 27.8]) {
    addBox(b, st, mx + sx, 82, mz + sz, 2.0, 105, 2.0, frameLight, { emit: 0.18 });
  }
  // 38F setback cornice & terrace planters at 186 m
  addBox(b, st, mx, 185.0, mz, 64.2, 1.8, 58.2, frameLight, { emit: 0.36, style: 3 });
  addBox(b, st, 10, 186.8, 10, 16, 1.4, 16, gardenGreen, { topRgb: gardenGreen, style: 4 });

  // --- Tier 3: Osaka Marriott Miyako Hotel & Harukas 300 Tower (186–278 m, 44 m × 48 m) ---
  const ux = -19, uz = -8;
  addBox(b, st, ux, 186, uz, 44, 92, 48, glassUpper, {
    topRgb: [0.60, 0.64, 0.69], emit: 0.64, glass: 0.96, style: 1,
  });
  addBox(b, st, ux, 246, uz, 44.5, 4.0, 48.5, louverDark, { emit: 0.06 });
  for (let x = -18; x <= 18; x += 6) {
    addBox(b, st, ux + x, 186, uz + 24.2, 0.72, 114, 1.05, frameSilver, { emit: 0.14 });
    addBox(b, st, ux + x, 186, uz - 24.2, 0.72, 114, 1.05, frameSilver, { emit: 0.14 });
  }
  for (let z = -20; z <= 20; z += 6.66) {
    addBox(b, st, ux + 22.2, 186, uz + z, 1.05, 114, 0.72, frameSilver, { emit: 0.14 });
    addBox(b, st, ux - 22.2, 186, uz + z, 1.05, 114, 0.72, frameSilver, { emit: 0.14 });
  }
  for (const sx of [-21.8, 21.8]) for (const sz of [-23.8, 23.8]) {
    addBox(b, st, ux + sx, 186, uz + sz, 1.9, 114.8, 1.9, frameLight, { emit: 0.22 });
  }

  // --- Harukas 300 Triple-Height Hollow Glass Observatory & 58F Tenku Teien Atrium (278–300 m) ---
  const obsY = 278, obsH = 21.6;
  addBox(b, st, ux, obsY, uz - 19.6, 44.8, obsH, 9.4, glassCrownCol, { topRgb: frameLight, emit: 0.88, glass: 0.96, style: 2 });
  addBox(b, st, ux, obsY, uz + 19.6, 44.8, obsH, 9.4, glassCrownCol, { topRgb: frameLight, emit: 0.88, glass: 0.96, style: 2 });
  addBox(b, st, ux - 17.6, obsY, uz, 9.4, obsH, 30.2, glassCrownCol, { topRgb: frameLight, emit: 0.88, glass: 0.96, style: 2 });
  addBox(b, st, ux + 17.6, obsY, uz, 9.4, obsH, 30.2, glassCrownCol, { topRgb: frameLight, emit: 0.88, glass: 0.96, style: 2 });
  // Open-air timber courtyard deck + stepped grand bleachers inside the 58F atrium
  addBox(b, st, ux, obsY, uz, 25.8, 1.2, 29.8, warmDeck, { topRgb: warmDeck, emit: 0.44, style: 4 });
  for (let step = 0; step < 4; step++) {
    addBox(b, st, ux - 6.5 - step * 1.4, obsY + 1.2 + step * 1.1, uz, 1.6, 1.1, 14, warmDeck, { style: 4, emit: 0.35 });
  }
  // Luminous white 300 m crown rim + structural bridge girders + helipad with bold yellow 'H'
  addBox(b, st, ux, 299.0, uz - 24.0, 46.4, 1.6, 2.2, frameLight, { emit: 0.82, style: 3 });
  addBox(b, st, ux, 299.0, uz + 24.0, 46.4, 1.6, 2.2, frameLight, { emit: 0.82, style: 3 });
  addBox(b, st, ux - 22.0, 299.0, uz, 2.2, 1.6, 48.0, frameLight, { emit: 0.82, style: 3 });
  addBox(b, st, ux + 22.0, 299.0, uz, 2.2, 1.6, 48.0, frameLight, { emit: 0.82, style: 3 });
  for (const bx of [-8, 8]) {
    addBox(b, st, ux + bx, 298.6, uz, 1.4, 1.4, 46, frameSilver, { includeBottom: true });
  }
  addBox(b, st, ux, 299.8, uz, 22, 0.9, 22, [0.24, 0.26, 0.29], { topRgb: [0.26, 0.28, 0.31] });
  addBox(b, st, ux - 4.2, 300.75, uz, 1.5, 0.15, 10.5, padYellow, { style: 4 });
  addBox(b, st, ux + 4.2, 300.75, uz, 1.5, 0.15, 10.5, padYellow, { style: 4 });
  addBox(b, st, ux, 300.75, uz, 8.4, 0.15, 1.5, padYellow, { style: 4 });
  for (const [bx, bz] of [[ux - 21.5, uz - 23.5], [ux + 21.5, uz + 23.5]] as const) {
    addBox(b, st, bx, 300.5, bz, 0.4, 3.2, 0.4, frameLight);
    addLight(b, sitePt(st, bx, 304.0, bz), [1.0, 0.10, 0.05], 4.4, 1.1);
  }
  addLight(b, sitePt(st, ux, 290, uz), [0.85, 0.94, 1.0], 5.6, 0);

  // --- Iconic White "a"-Shaped Abeno Pedestrian Overpass (阿倍野歩道橋) at NW Intersection ---
  const bridgeSite = makeSite(34.64682, 135.51278, ground, 0.28, 0.5);
  const bridgeWhite: RGB = [0.91, 0.92, 0.94];
  const deckGrey: RGB = [0.56, 0.58, 0.60];
  // Elevated circular central pedestrian ring (y = 7.2 m, outer R = 21 m, inner R = 14 m)
  addAnnulusRing(b, bridgeSite, 0, 7.0, 0, 14.5, 21.0, 1.3, 28, bridgeWhite, {
    topRgb: deckGrey, emit: 0.42, innerEmit: 0.55, style: 0, innerStyle: 3,
  });
  // Sculptural white arched canopy ribs hovering above the ring
  const archPts: Vec3[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 1.55 - 0.35;
    const h = 10.6 + Math.sin((i / 20) * Math.PI) * 3.8;
    archPts.push(sitePt(bridgeSite, Math.cos(a) * 18.2, h, Math.sin(a) * 18.2));
  }
  addTubeSpline(b, archPts, 0.65, 6, 1, bridgeWhite, { emit: 0.58, style: 3 });
  // 4 radiating elevated walkways + concrete support piers
  for (const ang of [0.15, 1.72, 3.30, 4.86]) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pIn = sitePt(bridgeSite, ca * 19.5, 7.6, sa * 19.5);
    const pOut = sitePt(bridgeSite, ca * 44, 7.6, sa * 44);
    addStrut(b, pIn, pOut, 2.2, 2.2, 4, bridgeWhite, 0.32);
    addFrustum(b, bridgeSite, ca * 20, 0, sa * 20, 1.2, 1.0, 7.2, 8, [0.68, 0.70, 0.72]);
  }
}

/** Build Umeda Sky Building (173 m) + 22F Sky Bridge + Space-Frame Truss + Chushizen-no-Mori. */
function buildUmedaSkyBuilding(b: LandmarkBuilder, ground: GroundFn) {
  const st = makeSite(
    OSAKA_SKYLINE_SITES.umedaSky.lat,
    OSAKA_SKYLINE_SITES.umedaSky.lon,
    ground,
    OSAKA_SKYLINE_SITES.umedaSky.rotY,
    2.0,
  );
  const skyGlass: RGB = [0.27, 0.42, 0.55];
  const deepGlass: RGB = [0.16, 0.28, 0.40];
  const silverMetal: RGB = [0.78, 0.82, 0.87];
  const brightSilver: RGB = [0.89, 0.92, 0.95];
  const darkSteel: RGB = [0.20, 0.24, 0.29];
  const atriumGlow: RGB = [0.64, 0.86, 1.0];
  const forestGreen: RGB = [0.14, 0.31, 0.13];
  const lushGreen: RGB = [0.19, 0.38, 0.16];
  const plazaStone: RGB = [0.50, 0.52, 0.55];

  // --- Shin-Umeda City Plaza & Chushizen-no-Mori (中自然の森) woodland + stream immediately South ---
  addBox(b, st, 0, 0, 0, 108, 2.4, 58, plazaStone, { topRgb: plazaStone, style: 4 });
  addBox(b, st, 0, 2.4, -22, 36, 1.2, 12, lushGreen, { topRgb: lushGreen, style: 4 });
  // Chushizen-no-Mori terraced woodland grove & water court on South side (z = +26..+54)
  addBox(b, st, 0, 0.5, 40, 88, 1.8, 26, forestGreen, { topRgb: forestGreen, style: 4 });
  addBox(b, st, 0, 2.35, 38, 52, 0.3, 9, [0.06, 0.22, 0.30], { topRgb: [0.06, 0.22, 0.30], style: 5, glass: 0.95, emit: 0.18 });
  for (const [gx, gz, r] of [[-28, 34, 6.5], [-16, 46, 7.2], [18, 45, 7.0], [30, 34, 6.0], [0, 48, 6.2]] as const) {
    addDome(b, st, gx, 2.0, gz, r, r * 0.72, r, 4, 10, lushGreen, { style: 4 });
  }

  // Glazed base lobby wings
  for (const side of [-1, 1]) {
    const tx = side * 34;
    addBox(b, st, tx, 2.4, 0, 36, 9.6, 44, deepGlass, { emit: 0.62, glass: 0.92, style: 2 });
    addBox(b, st, tx, 11.6, 0, 37.6, 1.4, 45.6, silverMetal, { emit: 0.18, includeBottom: true });
  }

  // --- Twin Articulated Stepped-Corner Towers (Tower East & Tower West, 12–152 m) ---
  for (const side of [-1, 1]) {
    const tx = side * 34;
    addBox(b, st, tx, 12, 0, 31, 140, 36, skyGlass, { topRgb: silverMetal, emit: 0.56, glass: 0.95, style: 1 });
    addBox(b, st, tx, 12, 0, 21, 140, 42, skyGlass, { topRgb: silverMetal, emit: 0.58, glass: 0.96, style: 1 });
    addBox(b, st, tx + side * 2.2, 12, 0, 33, 140, 23, skyGlass, { topRgb: silverMetal, emit: 0.54, glass: 0.94, style: 1 });
    for (const fx of [-15.6, 15.6]) for (const fz of [-18.2, 18.2]) {
      addBox(b, st, tx + fx, 12, fz, 1.7, 141, 1.7, brightSilver, { emit: 0.15 });
    }
    for (const fx of [-10.6, 10.6]) for (const fz of [-21.1, 21.1]) {
      addBox(b, st, tx + fx, 12, fz, 1.15, 141, 1.15, silverMetal, { emit: 0.12 });
    }
    for (const by of [46, 82, 118]) {
      addBox(b, st, tx, by, 0, 32.4, 3.2, 37.4, darkSteel, { emit: 0.06 });
      addBox(b, st, tx, by - 0.6, 0, 33.2, 0.8, 38.2, brightSilver, { emit: 0.14 });
      addBox(b, st, tx, by + 3.0, 0, 33.2, 0.8, 38.2, brightSilver, { emit: 0.14 });
    }
    addBox(b, st, tx, 145, 0, 33.5, 7, 39.5, darkSteel, { emit: 0.12 });
  }

  // --- Authentic 22F Mid-Air Connecting Sky Bridge (空中連絡橋, y = 89–95 m) ---
  addBox(b, st, 0, 89.2, 0, 38, 1.2, 10.5, brightSilver, { emit: 0.25, includeBottom: true });
  addBox(b, st, 0, 90.4, 0, 38, 4.2, 9.6, atriumGlow, { emit: 0.72, glass: 0.94, style: 2 });
  addBox(b, st, 0, 94.6, 0, 38, 1.0, 10.5, brightSilver, { emit: 0.25 });

  // --- Central 16-Sided Cylindrical Glass Elevator Shaft (2–154 m) ---
  addFrustum(b, st, 0, 2, 0, 6.2, 6.2, 151, 16, atriumGlow, { topRgb: silverMetal, emit: 0.68, glass: 0.94, style: 2 });
  for (let ry = 16; ry <= 144; ry += 14) {
    addFrustum(b, st, 0, ry, 0, 6.55, 6.55, 0.85, 16, brightSilver, { emit: 0.16, capTop: true, capBottom: true });
  }
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI * 0.5 + Math.PI * 0.25;
    addBox(b, st, Math.cos(a) * 6.3, 2, Math.sin(a) * 6.3, 0.8, 151, 0.8, silverMetal, { emit: 0.12 });
  }

  // --- Exposed 3D Diagonal Space-Frame Steel Trusses supporting the Floating Garden (142–152 m) ---
  for (const zSign of [-1, 1]) {
    const z = zSign * 19.5;
    addStrut(b, sitePt(st, -19, 142, z), sitePt(st, -10, 152.5, z), 0.78, 0.78, 6, darkSteel, 0.08);
    addStrut(b, sitePt(st, 19, 142, z), sitePt(st, 10, 152.5, z), 0.78, 0.78, 6, darkSteel, 0.08);
    addStrut(b, sitePt(st, -10, 152.5, z), sitePt(st, 0, 145, z), 0.55, 0.55, 6, darkSteel, 0.08);
    addStrut(b, sitePt(st, 10, 152.5, z), sitePt(st, 0, 145, z), 0.55, 0.55, 6, darkSteel, 0.08);
    addStrut(b, sitePt(st, -19, 152, z), sitePt(st, 19, 152, z), 0.88, 0.88, 6, silverMetal, 0.14);
  }
  // Cross-bracing ribs beneath the Floating Garden deck
  for (let gx = -18; gx <= 18; gx += 9) {
    addStrut(b, sitePt(st, gx, 151.8, -24), sitePt(st, gx, 151.8, 24), 0.45, 0.45, 4, darkSteel, 0.06);
  }

  // --- Iconic Floating Garden Observatory (空中庭園展望台, 152–173 m, smooth 32-segment Ø26 m aperture!) ---
  addRectWithCircularAperture(b, st, 152.0, 3.6, 51.0, 28.0, 13.6, 8, darkSteel, brightSilver, darkSteel, {
    emit: 0.18, innerEmit: 0.50, glass: 0.20, innerGlass: 0.42, style: 0, innerStyle: 3, bottomRgb: [0.18, 0.21, 0.25],
  });
  addRectWithCircularAperture(b, st, 155.6, 12.0, 51.2, 28.2, 13.4, 8, skyGlass, atriumGlow, [0.80, 0.84, 0.88], {
    emit: 0.62, innerEmit: 0.90, glass: 0.92, innerGlass: 0.95, style: 1, innerStyle: 2,
  });
  addRectWithCircularAperture(b, st, 167.6, 2.4, 52.2, 29.2, 13.2, 8, brightSilver, atriumGlow, [0.82, 0.86, 0.90], {
    emit: 0.36, innerEmit: 0.94, glass: 0.38, innerGlass: 0.62, style: 0, innerStyle: 3,
  });
  // Open-Air Rooftop "Lumi Sky Walk" Circular Starry Promenade & Glass Guardrails (170–173 m)
  addAnnulusRing(b, st, 0, 170.0, 0, 13.4, 21.8, 1.1, 32, brightSilver, {
    topRgb: [0.54, 0.74, 0.92], innerRgb: atriumGlow, emit: 0.48, innerEmit: 0.95, topEmit: 0.62, style: 0, innerStyle: 3,
  });
  addAnnulusRing(b, st, 0, 171.1, 0, 21.3, 21.8, 1.9, 32, glassCrown(atriumGlow), {
    topRgb: brightSilver, emit: 0.38, glass: 0.90, style: 2,
  });
  addAnnulusRing(b, st, 0, 171.1, 0, 13.2, 13.65, 1.8, 32, atriumGlow, {
    topRgb: brightSilver, emit: 0.74, innerEmit: 0.86, glass: 0.90, style: 2, innerStyle: 3,
  });

  // --- Crossed X-Shape Transparent Cylindrical Escalator Tubes with Underside Truss Girders (128 -> 153.5 m) ---
  const tubes: [Vec3, Vec3][] = [
    [sitePt(st, -19.0, 128, -4.4), sitePt(st, 19.0, 153.5, 4.4)],
    [sitePt(st, 19.0, 128, 4.4), sitePt(st, -19.0, 153.5, -4.4)],
  ];
  for (const [p0, p1] of tubes) {
    addStrut(b, p0, p1, 1.90, 1.90, 12, atriumGlow, 0.92, 0.94, 2);
    // Dark steel underside box girder supporting each floating escalator
    const g0: Vec3 = [p0[0], p0[1] - 1.95, p0[2]];
    const g1: Vec3 = [p1[0], p1[1] - 1.95, p1[2]];
    addStrut(b, g0, g1, 0.65, 0.65, 4, darkSteel, 0.14);
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const lerp = (u: number): Vec3 => [
        p0[0] + (p1[0] - p0[0]) * u,
        p0[1] + (p1[1] - p0[1]) * u,
        p0[2] + (p1[2] - p0[2]) * u,
      ];
      addStrut(b, lerp(Math.max(0, t - 0.01)), lerp(Math.min(1, t + 0.01)), 2.18, 2.18, 12, brightSilver, 0.28, 0.25, 0);
    }
  }

  for (const [bx, bz] of [[-49.5, -26.5], [49.5, 26.5]] as const) {
    addBox(b, st, bx, 170.0, bz, 0.4, 3.0, 0.4, brightSilver);
    addLight(b, sitePt(st, bx, 173.4, bz), [1.0, 0.10, 0.05], 4.2, 1.4);
  }
  addLight(b, sitePt(st, 0, 166, 0), [0.62, 0.88, 1.0], 5.6, 0);
}

/**
 * Build Tsutenkaku (108 m, Tachū Naitō) with authentic SQUARE 4-sided steel lattice shaft,
 * splayed legs & portal arches, Hitachi blue vertical neon panels, East circular clock face with hands,
 * helical stainless-steel TOWER SLIDER tube, Golden Observatory, cantilevered TIP THE TSUTENKAKU deck,
 * and glowing circular weather-forecast neon crown.
 */
function buildTsutenkaku(b: LandmarkBuilder, ground: GroundFn) {
  const st = makeSite(
    OSAKA_SKYLINE_SITES.tsutenkaku.lat,
    OSAKA_SKYLINE_SITES.tsutenkaku.lon,
    ground,
    OSAKA_SKYLINE_SITES.tsutenkaku.rotY,
    1.5,
  );
  const steelLight: RGB = [0.74, 0.77, 0.80];
  const steelMid: RGB = [0.56, 0.60, 0.65];
  const steelDark: RGB = [0.30, 0.34, 0.38];
  const stainless: RGB = [0.84, 0.87, 0.91];
  const neonBlue: RGB = [0.10, 0.46, 0.96];
  const neonGold: RGB = [1.0, 0.82, 0.28];
  const neonWhite: RGB = [0.95, 0.97, 1.0];
  const deckGlass: RGB = [0.15, 0.26, 0.38];
  const spireRed: RGB = [0.88, 0.20, 0.14];

  // --- 1. Four Inward-Leaning Tapered Steel Truss Legs & Semi-Circular Portal Arches (0–28 m) ---
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const footR = 11.8, kneeR = 5.6, kneeY = 28.0;
  for (const [sx, sz] of corners) {
    addBox(b, st, sx * footR, 0, sz * footR, 3.8, 3.6, 3.8, [0.46, 0.48, 0.51], { style: 4 });
    addStrut(b, sitePt(st, sx * footR, 2.5, sz * footR), sitePt(st, sx * kneeR, kneeY, sz * kneeR), 1.50, 1.02, 4, steelLight, 0.12);
    addStrut(b, sitePt(st, sx * (footR - 2.2), 2.5, sz * (footR - 2.2)), sitePt(st, sx * (kneeR - 1.2), kneeY, sz * (kneeR - 1.2)), 0.52, 0.40, 4, steelMid, 0.08);
  }
  const archSegs = 8;
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side];
    const [bx, bz] = corners[(side + 1) % 4];
    const legAtY = (sx: number, sz: number, y: number): Vec3 => {
      const r = footR + (kneeR - footR) * (y / kneeY);
      return sitePt(st, sx * r, y, sz * r);
    };
    let prevPt: Vec3 | null = null;
    for (let k = 0; k <= archSegs; k++) {
      const u = k / archSegs;
      const archY = 6.2 + Math.sin(u * Math.PI) * 9.8;
      const r = footR + (kneeR - footR) * (archY / kneeY);
      const cur = sitePt(st, (ax + (bx - ax) * u) * r, archY, (az + (bz - az) * u) * r);
      if (prevPt) addStrut(b, prevPt, cur, 0.64, 0.64, 6, steelLight, 0.24);
      prevPt = cur;
    }
    addStrut(b, legAtY(ax, az, 16), legAtY(bx, bz, 27), 0.42, 0.42, 4, steelMid, 0.10);
    addStrut(b, legAtY(bx, bz, 16), legAtY(ax, az, 27), 0.42, 0.42, 4, steelMid, 0.10);
  }

  // --- Square 2F–3F Exhibition Pavilion tucked inside the arched podium (16–29 m) ---
  addBox(b, st, 0, 16.5, 0, 19.2, 11.5, 19.2, deckGlass, { topRgb: steelLight, emit: 0.62, glass: 0.85, style: 2, includeBottom: true });
  addBox(b, st, 0, 28.0, 0, 20.6, 3.2, 20.6, steelLight, { emit: 0.26, includeBottom: true });
  addBox(b, st, 0, 31.2, 0, 18.8, 1.4, 18.8, neonWhite, { emit: 0.84, style: 3 });

  // --- Helical Stainless-Steel TOWER SLIDER Tube spiraling down from 3F (22 m -> 2.5 m) ---
  const sliderPts: Vec3[] = [];
  const sliderTurns = 1.65;
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const ang = -0.5 + t * Math.PI * 2 * sliderTurns;
    const r = 4.2 + t * 4.4;
    const y = 22.0 - t * 19.2;
    sliderPts.push(sitePt(st, 9.6 + Math.cos(ang) * r, y, 2.0 + Math.sin(ang) * r));
  }
  addTubeSpline(b, sliderPts, 0.85, 8, 1, stainless, { emit: 0.25, glass: 0.55, style: 0 });
  // Vertical stainless EV support pylon inside the Tower Slider helix
  addFrustum(b, st, 9.6, 1.5, 2.0, 1.6, 1.5, 23.0, 10, steelMid, { emit: 0.14 });

  // --- 2. Authentic SQUARE 4-Sided Tapered Steel Lattice Shaft (32.6–77 m) ---
  const shaftY0 = 32.6, shaftY1 = 77.0, half0 = 5.4, half1 = 3.55;
  // Tapered inner structural steel core (square 4-sided frustum rotated 45 deg so flats face N/S/E/W!)
  addFrustum(b, st, 0, shaftY0, 0, (half0 - 0.55) * Math.SQRT2, (half1 - 0.45) * Math.SQRT2, shaftY1 - shaftY0, 4, steelMid, {
    phase: Math.PI / 4, emit: 0.22,
  });
  const bays = 7;
  for (const [sx, sz] of corners) {
    addStrut(b, sitePt(st, sx * half0, shaftY0, sz * half0), sitePt(st, sx * half1, shaftY1, sz * half1), 0.44, 0.34, 4, steelLight, 0.18);
  }
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side];
    const [bx, bz] = corners[(side + 1) % 4];
    for (let k = 0; k < bays; k++) {
      const t0 = k / bays, t1 = (k + 1) / bays;
      const yA = shaftY0 + (shaftY1 - shaftY0) * t0;
      const yB = shaftY0 + (shaftY1 - shaftY0) * t1;
      const hA = half0 + (half1 - half0) * t0;
      const hB = half0 + (half1 - half0) * t1;
      const p00 = sitePt(st, ax * hA, yA, az * hA);
      const p10 = sitePt(st, bx * hA, yA, bz * hA);
      const p01 = sitePt(st, ax * hB, yB, az * hB);
      const p11 = sitePt(st, bx * hB, yB, bz * hB);
      addStrut(b, p00, p11, 0.20, 0.20, 4, steelDark, 0.08);
      addStrut(b, p10, p01, 0.20, 0.20, 4, steelDark, 0.08);
      if (k > 0) addStrut(b, p00, p10, 0.24, 0.24, 4, steelLight, 0.16);
    }
  }

  // --- Iconic Vertical Illuminated Hitachi-Blue & White Neon Signboards on the Square Shaft (35–74 m) ---
  // North & South faces: bold deep Hitachi blue panels with white horizontal lettering bars
  for (const sz of [-1, 1]) {
    addBox(b, st, 0, 35.5, sz * 5.05, 5.2, 38.5, 0.9, steelDark);
    addBox(b, st, 0, 36.2, sz * 5.45, 4.4, 37.0, 0.42, neonBlue, { emit: 0.98, style: 3 });
    // Crisp white neon kanji/letter bar accents down the blue signboard
    for (let ly = 40; ly <= 69; ly += 4.6) {
      addBox(b, st, 0, ly, sz * 5.72, 2.8, 1.15, 0.16, neonWhite, { emit: 1.0, style: 3 });
    }
  }
  // West face: classic vibrant blue/white neon panel; East face: blue neon column + large circular clock face!
  addBox(b, st, -5.05, 35.5, 0, 0.9, 38.5, 5.2, steelDark);
  addBox(b, st, -5.45, 36.2, 0, 0.42, 37.0, 4.4, neonBlue, { emit: 0.96, style: 3 });
  for (let ly = 40; ly <= 69; ly += 4.6) {
    addBox(b, st, -5.72, ly, 0, 0.16, 1.15, 2.8, neonWhite, { emit: 1.0, style: 3 });
  }
  addBox(b, st, 5.05, 35.5, 0, 0.9, 38.5, 5.2, steelDark);
  addBox(b, st, 5.45, 36.2, 0, 0.42, 37.0, 4.4, neonBlue, { emit: 0.96, style: 3 });

  // Large Illuminated Circular Clock Face on East Face (y = 56.5 m) with bezel & crisp dark clock hands!
  const clockY = 56.5, clockR = 3.2, clockX = 5.75;
  const clockCenter = sitePt(st, clockX + 0.15, clockY, 0);
  const eastNrm = siteNrm(st, 1, 0, 0);
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI * 2;
    const a1 = ((i + 1) / 20) * Math.PI * 2;
    const p0 = sitePt(st, clockX + 0.15, clockY + Math.sin(a0) * clockR, Math.cos(a0) * clockR);
    const p1 = sitePt(st, clockX + 0.15, clockY + Math.sin(a1) * clockR, Math.cos(a1) * clockR);
    pushTri(b, clockCenter, p1, p0, eastNrm, neonWhite, 0.96, 0.15, 3);
    const r0 = sitePt(st, clockX + 0.19, clockY + Math.sin(a0) * (clockR + 0.36), Math.cos(a0) * (clockR + 0.36));
    const r1 = sitePt(st, clockX + 0.19, clockY + Math.sin(a1) * (clockR + 0.36), Math.cos(a1) * (clockR + 0.36));
    pushQuad(b, p1, r1, r0, p0, eastNrm, steelDark, 0.10, 0, 0);
  }
  // Hour & minute clock hands (showing ~10:10 classic watch pose)
  addStrut(b, sitePt(st, clockX + 0.28, clockY, 0), sitePt(st, clockX + 0.28, clockY + 1.35, -1.55), 0.16, 0.10, 4, steelDark, 0);
  addStrut(b, sitePt(st, clockX + 0.28, clockY, 0), sitePt(st, clockX + 0.28, clockY + 1.95, 1.75), 0.12, 0.08, 4, steelDark, 0);

  // --- 3. Flared Square/Chamfered 4F–5F Golden Observatory & "TIP THE TSUTENKAKU" Deck (77–94 m) ---
  addFrustum(b, st, 0, 77.0, 0, 4.9, 10.2, 4.0, 8, steelLight, { phase: Math.PI / 8, emit: 0.30, capBottom: true });
  addFrustum(b, st, 0, 81.0, 0, 10.6, 10.6, 1.1, 8, neonGold, { phase: Math.PI / 8, emit: 0.96, style: 3 });
  addFrustum(b, st, 0, 82.1, 0, 10.2, 10.6, 8.2, 8, deckGlass, { phase: Math.PI / 8, topRgb: steelLight, emit: 0.88, glass: 0.94, style: 2 });
  addFrustum(b, st, 0, 86.0, 0, 10.65, 10.65, 0.65, 8, steelLight, { phase: Math.PI / 8, emit: 0.36 });
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    addStrut(b, sitePt(st, Math.cos(a) * 10.4, 81.8, Math.sin(a) * 10.4), sitePt(st, Math.cos(a) * 10.7, 90.6, Math.sin(a) * 10.7), 0.30, 0.30, 4, steelLight, 0.25);
  }
  // Cantilevered glass-floor thrill platform "TIP THE TSUTENKAKU" projecting 5.4 m on the South-East face!
  addBox(b, st, 11.8, 91.2, 0, 5.4, 0.55, 3.6, stainless, { emit: 0.50, includeBottom: true });
  addBox(b, st, 12.2, 91.75, 0, 4.8, 1.35, 3.4, [0.55, 0.84, 1.0], { emit: 0.55, glass: 0.92, style: 2 });
  addStrut(b, sitePt(st, 9.2, 87.2, -1.4), sitePt(st, 14.0, 91.2, -1.4), 0.24, 0.24, 4, steelLight, 0.16);
  addStrut(b, sitePt(st, 9.2, 87.2, 1.4), sitePt(st, 14.0, 91.2, 1.4), 0.24, 0.24, 4, steelLight, 0.16);

  // Upper illuminated neon cornice + Open-Air "Tenbo Paradise" Deck (90.3–94.3 m)
  addFrustum(b, st, 0, 90.3, 0, 11.1, 11.1, 1.3, 8, neonBlue, { phase: Math.PI / 8, emit: 0.96, style: 3, capBottom: true });
  addAnnulusRing(b, st, 0, 91.6, 0, 10.0, 10.7, 1.6, 16, steelLight, { topRgb: neonWhite, emit: 0.45, glass: 0.5, style: 0 });
  addFrustum(b, st, 0, 91.6, 0, 7.6, 7.2, 2.7, 8, steelMid, { phase: Math.PI / 8, emit: 0.35 });

  // --- 4. Glowing Two-Tone Circular Weather-Forecast Neon Crown & Lightning Spire (94.3–108 m) ---
  addFrustum(b, st, 0, 94.3, 0, 3.75, 3.75, 3.25, 20, neonWhite, { emit: 0.98, style: 3 });
  addFrustum(b, st, 0, 97.55, 0, 4.0, 4.0, 0.45, 20, steelLight, { emit: 0.25 });
  addFrustum(b, st, 0, 98.0, 0, 3.75, 3.75, 3.25, 20, neonGold, { emit: 1.0, style: 3 });
  addDome(b, st, 0, 101.25, 0, 3.85, 2.0, 3.85, 5, 20, steelLight, { emit: 0.45, style: 0 });
  addFrustum(b, st, 0, 103.1, 0, 1.0, 0.55, 1.6, 8, neonWhite, { emit: 0.65, style: 3 });
  addFrustum(b, st, 0, 104.7, 0, 0.42, 0.14, 3.3, 8, spireRed, { emit: 0.55, style: 3 });
  addLight(b, sitePt(st, 0, 108.4, 0), [1.0, 0.12, 0.06], 4.0, 1.7);
  addLight(b, sitePt(st, 0, 97.6, 0), [1.0, 0.86, 0.44], 5.6, 0);
}

/**
 * Build bespoke high-detail 3D models for Osaka's signature skyline icons
 * (Abeno Harukas, Umeda Sky Building, Tsutenkaku), plus optional extra Kansai ensembles
 * registered from sibling modules.
 */
export function buildOsakaLandmarks(
  env: Env,
  ground: GroundFn,
  extras: readonly ((b: LandmarkBuilder, ground: GroundFn) => void)[] = [],
): THREE.Group {
  const b = createLandmarkBuilder();
  buildAbenoHarukas(b, ground);
  buildUmedaSkyBuilding(b, ground);
  buildTsutenkaku(b, ground);
  buildOsakaUmeda(b, ground);
  for (const addEnsemble of extras) addEnsemble(b, ground);
  return finalizeLandmarkGroup(b, env, 'osaka-skyline-landmarks');
}
