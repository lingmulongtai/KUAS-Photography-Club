import {
  addBox,
  addDome,
  addFrustum,
  addLight,
  addStrut,
  addTubeSpline,
  makeObbMask,
  makeSite,
  pushQuad,
  siteNrm,
  sitePt,
  type GroundFn,
  type LandmarkBuilder,
  type MaskShape,
  type RGB,
  type Vec3,
} from './landmark-builder';

/** Exact oriented footprint masks for every bespoke Umeda district landmark (zero overlap with generic blocks). */
export const UMEDA_BUILDING_MASKS: readonly MaskShape[] = [
  // JR Osaka Station Great Roof + North Gate (LUCUA) + South Gate (Daimaru)
  makeObbMask(34.70240, 135.49595, -0.540, 95, 55),
  makeObbMask(34.702531, 135.494299, -0.540, 44, 32),
  makeObbMask(34.70165, 135.49665, -0.540, 62, 24),
  // HEP FIVE + Red Rooftop Ferris Wheel
  makeObbMask(34.70232, 135.50028, -0.05, 32, 28),
  // Grand Front Osaka South A, North B, North C + Umekita Plaza
  makeObbMask(34.704346, 135.494766, -0.133, 34, 30),
  makeObbMask(34.705350, 135.494623, -0.133, 36, 30),
  makeObbMask(34.706425, 135.494515, -0.133, 32, 26),
  makeObbMask(34.70372, 135.49482, -0.133, 36, 26),
  // Grand Green Osaka (Umekita Park SANAA Pavilion + South Park Tower)
  makeObbMask(34.70415, 135.49265, -0.10, 56, 72),
  makeObbMask(34.70232, 135.49226, -0.10, 32, 30),
  // JP Tower Osaka (KITTE Osaka + Old Central Post Office)
  makeObbMask(34.700688, 135.494187, -0.541, 44, 36),
  // Osaka Umeda Twin Towers South (Hanshin) & North (Hankyu)
  makeObbMask(34.701011, 135.497521, -0.540, 44, 32),
  makeObbMask(34.702320, 135.498793, -0.05, 40, 32),
  // Yodobashi / LINKS Umeda
  makeObbMask(34.704552, 135.496019, -0.05, 50, 36),
];

export const UMEDA_TREE_MASKS: readonly MaskShape[] = [
  makeObbMask(34.70415, 135.49265, -0.10, 58, 76),
  makeObbMask(34.70372, 135.49482, -0.133, 38, 28),
];

/**
 * Build the Osaka Umeda metropolitan core:
 * - JR Osaka Station "Osaka Station City" Great Sloped Glass Canopy + North/South Gate Buildings
 * - HEP FIVE crimson commercial block + iconic Ø75 m red rooftop Ferris wheel (24 spokes & gondolas)
 * - Grand Front Osaka (Towers A/B/C + Umekita Plaza reflecting water basin)
 * - Grand Green Osaka (Umekita Park + SANAA undulating white canopy pavilion + South Park Tower)
 * - JP Tower Osaka (KITTE Osaka with preserved historic white Osaka Central Post Office podium)
 * - Osaka Umeda Twin Towers South (Hanshin) & North (Hankyu) + Yodobashi / LINKS Umeda
 */
export function buildOsakaUmeda(b: LandmarkBuilder, ground: GroundFn) {
  const silver: RGB = [0.80, 0.83, 0.87];
  const brightWhite: RGB = [0.92, 0.94, 0.96];
  const steelDark: RGB = [0.20, 0.24, 0.29];
  const stoneCream: RGB = [0.80, 0.77, 0.71];
  const glassCool: RGB = [0.24, 0.38, 0.50];
  const glassBlue: RGB = [0.22, 0.40, 0.56];
  const glassWarm: RGB = [0.30, 0.42, 0.50];
  const atriumGlow: RGB = [0.68, 0.86, 1.0];
  const parkGreen: RGB = [0.18, 0.39, 0.16];
  const waterCol: RGB = [0.06, 0.22, 0.30];

  // =========================================================================
  // 1. JR Osaka Station "Osaka Station City" Great Roof (時空の広場 大屋根)
  // =========================================================================
  {
    const st = makeSite(34.70240, 135.49595, ground, -0.540, 1.0);
    // Trackbed concourse & platform piers (y = 0..16 m)
    addBox(b, st, 0, 0, 0, 176, 3.2, 86, [0.34, 0.36, 0.39], { style: 4 });
    // Elevated "Toki-no-Hiroba" bridge plaza spanning over the platforms (y = 18..21 m)
    addBox(b, st, 0, 18.0, 0, 56, 2.8, 92, [0.84, 0.84, 0.86], { emit: 0.52, includeBottom: true });
    addBox(b, st, 0, 20.8, 0, 54, 1.2, 88, [0.88, 0.86, 0.82], { style: 4, emit: 0.35 });

    // Iconic 180 m × 96 m Sloped Gleaming White Glass-and-Truss Canopy (y = 50 m North -> 35 m South)
    const roofW = 180, roofD = 96;
    const yNorth = 50.5, ySouth = 35.5;
    const slopeNrm = siteNrm(st, 0, roofD, yNorth - ySouth);
    const botNrm: Vec3 = [-slopeNrm[0], -slopeNrm[1], -slopeNrm[2]];
    const pNW = sitePt(st, -roofW * 0.5, yNorth, -roofD * 0.5);
    const pNE = sitePt(st, roofW * 0.5, yNorth, -roofD * 0.5);
    const pSE = sitePt(st, roofW * 0.5, ySouth, roofD * 0.5);
    const pSW = sitePt(st, -roofW * 0.5, ySouth, roofD * 0.5);
    // Main glazed roof plane + warm illuminated soffit underside
    pushQuad(b, pNW, pSW, pSE, pNE, slopeNrm, [0.84, 0.89, 0.94], 0.38, 0.84, 2);
    pushQuad(b, pNW, pNE, pSE, pSW, botNrm, [0.86, 0.84, 0.80], 0.65, 0.25, 2);

    // Sculptural white arched louver ribs & primary steel space-frame trusses across the 180 m span
    for (let x = -86; x <= 86; x += 14.33) {
      const nTop = sitePt(st, x, yNorth + 0.8, -roofD * 0.5);
      const sTop = sitePt(st, x, ySouth + 0.8, roofD * 0.5);
      const nBot = sitePt(st, x, yNorth - 3.6, -roofD * 0.5);
      const sBot = sitePt(st, x, ySouth - 3.6, roofD * 0.5);
      addStrut(b, nTop, sTop, 0.75, 0.75, 4, brightWhite, 0.42);
      addStrut(b, nBot, sBot, 0.58, 0.58, 4, silver, 0.32);
      // Heavy sloped support columns on North & South platform edges
      addStrut(b, sitePt(st, x, 2.5, -roofD * 0.46), nBot, 0.85, 0.72, 6, brightWhite, 0.16);
      addStrut(b, sitePt(st, x, 2.5, roofD * 0.46), sBot, 0.85, 0.72, 6, brightWhite, 0.16);
    }
    // Longitudinal bright white roof fascia beams & skylight purlins
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      const lz = -roofD * 0.5 + roofD * u;
      const ly = yNorth + (ySouth - yNorth) * u + 0.4;
      addStrut(b, sitePt(st, -roofW * 0.5, ly, lz), sitePt(st, roofW * 0.5, ly, lz), k === 0 || k === 6 ? 1.1 : 0.48, k === 0 || k === 6 ? 1.1 : 0.48, 4, brightWhite, 0.45);
    }
    addLight(b, sitePt(st, 0, 32, 0), [1.0, 0.90, 0.72], 5.2, 0);
  }

  // --- North Gate Building (LUCUA / LUCUA 1100, 150 m) ---
  {
    const st = makeSite(34.702531, 135.494299, ground, -0.540, 2.0);
    addBox(b, st, 0, 0, 0, 76, 54, 46, stoneCream, { topRgb: [0.64, 0.66, 0.68], emit: 0.48, glass: 0.72, style: 1 });
    addBox(b, st, 0, 54, -4, 58, 96, 36, glassCool, { topRgb: silver, emit: 0.56, glass: 0.94, style: 1 });
    // Crisp horizontal white architectural louvers & rooftop greenery terrace
    for (const y of [54, 86, 118, 148]) {
      addBox(b, st, 0, y, -4, 59.6, 1.4, 37.6, brightWhite, { emit: 0.24 });
    }
    addBox(b, st, 0, 54.4, 15, 58, 1.2, 12, parkGreen, { style: 4 });
    addLight(b, sitePt(st, 0, 152, -4), [1.0, 0.10, 0.05], 3.8, 2.1);
  }

  // --- South Gate Building (Daimaru Umeda / Hotel Granvia, 122 m) ---
  {
    const st = makeSite(34.70165, 135.49665, ground, -0.540, 2.0);
    addBox(b, st, 0, 0, 0, 116, 62, 34, [0.76, 0.78, 0.80], { emit: 0.52, glass: 0.78, style: 1 });
    addBox(b, st, 12, 62, 2, 76, 60, 28, glassWarm, { topRgb: silver, emit: 0.54, glass: 0.88, style: 1 });
    addBox(b, st, 12, 121, 2, 77.6, 1.8, 29.6, brightWhite, { emit: 0.34, style: 3 });
  }

  // =========================================================================
  // 2. HEP FIVE + Iconic Ø75 m Bright Crimson Rooftop Ferris Wheel (106 m apex!)
  // =========================================================================
  {
    const st = makeSite(34.70232, 135.50028, ground, -0.05, 2.0);
    const hepRed: RGB = [0.78, 0.14, 0.14];
    const wheelRed: RGB = [0.94, 0.14, 0.12];
    const wheelGlow: RGB = [1.0, 0.22, 0.16];
    const hepGlass: RGB = [0.22, 0.30, 0.40];

    // Stepped crimson & glass HEP FIVE flagship retail building (0–34 m)
    addBox(b, st, 0, 0, 0, 52, 34, 44, hepRed, { topRgb: [0.46, 0.48, 0.50], emit: 0.42, style: 0 });
    addBox(b, st, 0, 2, 22.1, 26, 26, 1.0, hepGlass, { emit: 0.72, glass: 0.92, style: 2 });
    addBox(b, st, 0, 34, 0, 53.2, 1.6, 45.2, brightWhite, { emit: 0.28 });

    // Iconic Ø75 m Bright Crimson Rooftop Ferris Wheel (center y = 68.5 m, R = 37.5 m -> apex 106 m!)
    const hubY = 68.5, wheelZ = 6.0, R = 37.5, rInner = 27.0, spokes = 24;
    const halfThick = 2.6;

    // Twin A-frame crimson steel support legs anchoring the hub to the 34 m roof
    for (const zOff of [-5.2, 5.2]) {
      addStrut(b, sitePt(st, -17, 33, wheelZ + zOff), sitePt(st, 0, hubY, wheelZ + zOff * 0.62), 1.45, 1.15, 6, wheelRed, 0.35);
      addStrut(b, sitePt(st, 17, 33, wheelZ + zOff), sitePt(st, 0, hubY, wheelZ + zOff * 0.62), 1.45, 1.15, 6, wheelRed, 0.35);
    }
    // Central illuminated axle hub
    addStrut(b, sitePt(st, 0, hubY, wheelZ - 4.2), sitePt(st, 0, hubY, wheelZ + 4.2), 3.4, 3.4, 12, wheelGlow, 0.85, 0.2, 3);

    // Dual parallel outer & inner crimson rims + 24 radial spokes + 24 bright red passenger gondolas!
    for (let i = 0; i < spokes; i++) {
      const a0 = (i / spokes) * Math.PI * 2;
      const a1 = ((i + 1) / spokes) * Math.PI * 2;
      const x0 = Math.cos(a0) * R, y0 = hubY + Math.sin(a0) * R;
      const x1 = Math.cos(a1) * R, y1 = hubY + Math.sin(a1) * R;
      const ix0 = Math.cos(a0) * rInner, iy0 = hubY + Math.sin(a0) * rInner;
      const ix1 = Math.cos(a1) * rInner, iy1 = hubY + Math.sin(a1) * rInner;

      for (const dz of [-halfThick, halfThick]) {
        // Outer luminous crimson rim chord
        addStrut(b, sitePt(st, x0, y0, wheelZ + dz), sitePt(st, x1, y1, wheelZ + dz), 0.72, 0.72, 6, wheelGlow, 0.96, 0.2, 3);
        // Inner stiffening ring chord
        addStrut(b, sitePt(st, ix0, iy0, wheelZ + dz * 0.85), sitePt(st, ix1, iy1, wheelZ + dz * 0.85), 0.42, 0.42, 4, wheelRed, 0.62, 0, 3);
        // Radial steel spoke from hub to rim
        addStrut(b, sitePt(st, 0, hubY, wheelZ + dz * 0.7), sitePt(st, x0, y0, wheelZ + dz), 0.34, 0.26, 4, wheelRed, 0.55, 0, 3);
      }
      // Transverse tie-bar + suspended bright red HEP FIVE gondola cabin hanging below the rim!
      addStrut(b, sitePt(st, x0, y0, wheelZ - halfThick), sitePt(st, x0, y0, wheelZ + halfThick), 0.30, 0.30, 4, wheelRed, 0.45);
      addBox(b, st, x0, y0 - 2.6, wheelZ, 2.5, 2.7, 2.3, wheelRed, { topRgb: brightWhite, emit: 0.78, glass: 0.65, style: 3 });
    }
    addLight(b, sitePt(st, 0, hubY, wheelZ), [1.0, 0.22, 0.14], 5.6, 0);
    addLight(b, sitePt(st, 0, hubY + R + 1.5, wheelZ), [1.0, 0.12, 0.08], 3.8, 1.9);
  }

  // =========================================================================
  // 3. Grand Front Osaka (Towers A/B/C + Umekita Plaza Reflecting Water Basin)
  // =========================================================================
  {
    // Umekita Plaza terraced water basin & sculptural floating silver pavilion
    const pz = makeSite(34.70372, 135.49482, ground, -0.133, 0.6);
    addBox(b, pz, 0, 0, 0, 62, 0.9, 42, [0.68, 0.70, 0.72], { style: 4 });
    addBox(b, pz, 0, 0.95, 2, 46, 0.35, 24, waterCol, { topRgb: waterCol, style: 5, glass: 0.96, emit: 0.22 });
    addBox(b, pz, -6, 1.2, -11, 24, 6.2, 14, atriumGlow, { emit: 0.70, glass: 0.94, style: 2 });
    addBox(b, pz, -6, 7.4, -11, 30, 1.2, 18, brightWhite, { emit: 0.38, includeBottom: true });

    const gfTowers = [
      { lat: 34.704346, lon: 135.494766, h: 166, w: 54, d: 42, podH: 36, glass: glassBlue, phase: 2.3 },
      { lat: 34.705350, lon: 135.494623, h: 174, w: 56, d: 44, podH: 38, glass: glassCool, phase: 2.6 },
      { lat: 34.706425, lon: 135.494515, h: 154, w: 48, d: 38, podH: 30, glass: glassWarm, phase: 2.9 },
    ];
    for (const t of gfTowers) {
      const st = makeSite(t.lat, t.lon, ground, -0.133, 2.0);
      addBox(b, st, 0, 0, 0, t.w + 8, t.podH, t.d + 8, [0.70, 0.73, 0.76], { emit: 0.48, glass: 0.78, style: 1 });
      addBox(b, st, 0, t.podH, 0, t.w, t.h - t.podH, t.d, t.glass, { topRgb: silver, emit: 0.56, glass: 0.94, style: 1 });
      // Crisp horizontal aluminum crown ribs & corner fins
      for (const sx of [-t.w * 0.5, t.w * 0.5]) for (const sz of [-t.d * 0.5, t.d * 0.5]) {
        addBox(b, st, sx, t.podH, sz, 1.6, t.h - t.podH + 3, 1.6, brightWhite, { emit: 0.16 });
      }
      addBox(b, st, 0, t.h - 2, 0, t.w + 1.4, 2.4, t.d + 1.4, brightWhite, { emit: 0.36, style: 3 });
      addLight(b, sitePt(st, 0, t.h + 3, 0), [1.0, 0.10, 0.05], 3.8, t.phase);
    }
  }

  // =========================================================================
  // 4. Grand Green Osaka (Umekita Park + SANAA Undulating White Roof + South Park Tower)
  // =========================================================================
  {
    const pk = makeSite(34.70415, 135.49265, ground, -0.10, 0.4);
    // Broad lush emerald event lawn & stepped water plaza
    addBox(b, pk, 0, 0, 0, 96, 0.7, 132, parkGreen, { topRgb: parkGreen, style: 4 });
    addBox(b, pk, 4, 0.72, 18, 48, 0.3, 42, [0.22, 0.45, 0.19], { style: 4 });
    addBox(b, pk, 14, 0.75, 42, 34, 0.28, 18, waterCol, { topRgb: waterCol, style: 5, glass: 0.96, emit: 0.24 });

    // SANAA's iconic undulating pure-white ribbon canopy ("Rohto Heart Square Umekita")!
    const roofNodes: [number, number, number, number, number][] = [
      [-14, 10.5, 24, 34, 24],
      [10, 12.2, 14, 32, 26],
      [20, 9.8, 34, 28, 22],
      [-4, 8.6, 44, 30, 18],
    ];
    for (const [rx, ry, rz, rw, rd] of roofNodes) {
      addBox(b, pk, rx, ry, rz, rw, 0.85, rd, brightWhite, { topRgb: brightWhite, emit: 0.42, includeBottom: true });
      // Ultra-slender white SANAA steel columns
      for (const sx of [-rw * 0.38, rw * 0.38]) for (const sz of [-rd * 0.36, rd * 0.36]) {
        addFrustum(b, pk, rx + sx, 0.6, rz + sz, 0.28, 0.28, ry - 0.5, 6, brightWhite, { emit: 0.20 });
      }
    }
    // Glazed event stage & cafe pavilion tucked beneath the white SANAA canopy
    addBox(b, pk, -6, 0.7, 26, 22, 7.2, 14, atriumGlow, { emit: 0.72, glass: 0.94, style: 2 });

    // Sculptural curved white pedestrian overpass ("Hirameki-no-Michi") bridging North & South parks
    const bridgePts: Vec3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const z = -42 + t * 56;
      const x = -22 + Math.sin(t * Math.PI) * 16;
      const y = 7.4 + Math.sin(t * Math.PI) * 1.8;
      bridgePts.push(sitePt(pk, x, y, z));
    }
    addTubeSpline(b, bridgePts, 2.2, 6, 1, brightWhite, { emit: 0.34, style: 0 });
    // Scattered landscaped green canopy mounds along Umekita Park edges
    for (const [tx, tz, r] of [[-32, -32, 7.5], [-26, -12, 8.0], [28, -36, 7.0], [32, -14, 6.8], [-34, 46, 7.2]] as const) {
      addDome(b, pk, tx, 0.6, tz, r, r * 0.75, r, 4, 10, [0.16, 0.36, 0.14], { style: 4 });
    }

    // Grand Green Osaka South Park Tower (182 m)
    const st = makeSite(34.70232, 135.49226, ground, -0.10, 2.0);
    addBox(b, st, 0, 0, 0, 56, 36, 52, [0.76, 0.79, 0.82], { emit: 0.48, glass: 0.80, style: 1 });
    addBox(b, st, 0, 36, 0, 48, 146, 44, glassBlue, { topRgb: silver, emit: 0.58, glass: 0.95, style: 1 });
    addBox(b, st, 0, 36.6, 24, 44, 1.4, 8, parkGreen, { style: 4 });
    addBox(b, st, 0, 180, 0, 49.4, 2.4, 45.4, brightWhite, { emit: 0.36, style: 3 });
    addLight(b, sitePt(st, 0, 185, 0), [1.0, 0.10, 0.05], 3.8, 3.2);
  }

  // =========================================================================
  // 5. JP Tower Osaka (KITTE Osaka, 188 m) with Preserved Historic Post Office Podium!
  // =========================================================================
  {
    const st = makeSite(34.700688, 135.494187, ground, -0.541, 2.0);
    // Historic preserved Old Osaka Central Post Office corner wing (warm white stone + tall rhythmic piers)
    const historicWhite: RGB = [0.89, 0.87, 0.82];
    addBox(b, st, 18, 0, -14, 42, 26, 28, historicWhite, { topRgb: [0.68, 0.69, 0.71], emit: 0.38, style: 0 });
    for (let x = -18; x <= 18; x += 4.5) {
      addBox(b, st, 18 + x, 2, -28.2, 1.1, 23, 0.8, brightWhite, { emit: 0.16 });
    }
    // Glazed 6-story KITTE commercial podium
    addBox(b, st, -6, 0, 2, 62, 34, 52, [0.72, 0.75, 0.79], { emit: 0.52, glass: 0.84, style: 1 });
    // Sleek stepped 188 m vertical-ribbed silver glass skyscraper
    addBox(b, st, -6, 34, 4, 52, 154, 44, glassCool, { topRgb: silver, emit: 0.58, glass: 0.95, style: 1 });
    for (let x = -22; x <= 22; x += 6.3) {
      addBox(b, st, -6 + x, 34, 26.2, 0.75, 154, 0.95, brightWhite, { emit: 0.15 });
      addBox(b, st, -6 + x, 34, -18.2, 0.75, 154, 0.95, brightWhite, { emit: 0.15 });
    }
    addBox(b, st, -6, 186.5, 4, 53.6, 2.4, 45.6, brightWhite, { emit: 0.42, style: 3 });
    addLight(b, sitePt(st, -6, 191, 4), [1.0, 0.10, 0.05], 4.0, 3.6);
  }

  // =========================================================================
  // 6. Osaka Umeda Twin Towers South (Hanshin, 189 m) & North (Hankyu, 187 m) + Yodobashi
  // =========================================================================
  {
    // Twin Towers South (Hanshin Dept. Store, 189 m)
    const s = makeSite(34.701011, 135.497521, ground, -0.540, 2.0);
    addBox(b, s, 0, 0, 0, 78, 52, 52, stoneCream, { topRgb: [0.64, 0.66, 0.68], emit: 0.46, glass: 0.65, style: 1 });
    addBox(b, s, 0, 52, 0, 58, 12, 42, steelDark, { emit: 0.25, glass: 0.85, style: 2 });
    addBox(b, s, 0, 64, 0, 54, 125, 44, glassBlue, { topRgb: silver, emit: 0.58, glass: 0.95, style: 1 });
    for (let x = -24; x <= 24; x += 8) {
      addBox(b, s, x, 64, 22.2, 0.9, 125, 1.0, brightWhite, { emit: 0.14 });
      addBox(b, s, x, 64, -22.2, 0.9, 125, 1.0, brightWhite, { emit: 0.14 });
    }
    addBox(b, s, 0, 187.5, 0, 55.6, 2.5, 45.6, brightWhite, { emit: 0.40, style: 3 });
    addLight(b, sitePt(s, 0, 192, 0), [1.0, 0.10, 0.05], 4.0, 4.0);

    // Twin Towers North (Hankyu Dept. Store, 187 m)
    const n = makeSite(34.702320, 135.498793, ground, -0.05, 2.0);
    addBox(b, n, 0, 0, 0, 70, 56, 54, [0.82, 0.79, 0.74], { topRgb: [0.64, 0.66, 0.68], emit: 0.46, glass: 0.60, style: 1 });
    addBox(b, n, 0, 56, 0, 52, 14, 42, atriumGlow, { emit: 0.62, glass: 0.92, style: 2 });
    addBox(b, n, 0, 70, 0, 50, 117, 42, glassWarm, { topRgb: silver, emit: 0.56, glass: 0.94, style: 1 });
    addBox(b, n, 0, 185.5, 0, 51.6, 2.5, 43.6, brightWhite, { emit: 0.38, style: 3 });
    addLight(b, sitePt(n, 0, 190, 0), [1.0, 0.10, 0.05], 4.0, 4.4);

    // Yodobashi / LINKS Umeda (150 m)
    const y = makeSite(34.704552, 135.496019, ground, -0.05, 2.0);
    addBox(b, y, 0, 0, 0, 92, 42, 62, [0.74, 0.76, 0.80], { emit: 0.56, glass: 0.72, style: 1 });
    addBox(b, y, -10, 42, 4, 52, 108, 38, glassCool, { topRgb: silver, emit: 0.54, glass: 0.92, style: 1 });
    addBox(b, y, -10, 148.5, 4, 53.2, 2.0, 39.2, brightWhite, { emit: 0.32, style: 3 });
    addLight(b, sitePt(y, -10, 153, 4), [1.0, 0.10, 0.05], 3.8, 4.8);
  }
}
