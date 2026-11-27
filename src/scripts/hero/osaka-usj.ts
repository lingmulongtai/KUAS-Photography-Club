import {
  addAnnulusRing,
  addBox,
  addDome,
  addFrustum,
  addLight,
  addStrut,
  addTubeSpline,
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

/** Surveyed z15 USJ water polygons (Central Lagoon, Amity/Black Lake, Jurassic River, Hogwarts Lake) in local home metres. */
const USJ_WATER_POLYGONS: readonly { outer: readonly number[]; holes: readonly (readonly number[])[] }[] = [
  {
    outer: [-29912.8, 37511.9, -29920.9, 37504.4, -29922.3, 37505.1, -29920.1, 37511.9, -29927.5, 37514.4, -29924.5, 37522.7, -29928.2, 37523.9, -29930.9, 37515.6, -29935.1, 37517.1, -29935.8, 37514.1, -29951.7, 37518.6, -29954.2, 37516.8, -29959.8, 37517.6, -29960.3, 37513.4, -29963.7, 37513.9, -29963.0, 37519.5, -29965.9, 37520.0, -29966.6, 37515.6, -29977.7, 37520.8, -29977.7, 37524.4, -29972.0, 37531.3, -29971.3, 37533.7, -29973.0, 37533.5, -29967.1, 37542.0, -29964.9, 37555.5, -29962.5, 37555.5, -29963.5, 37564.6, -29963.9, 37566.0, -29966.1, 37565.3, -29971.3, 37576.8, -29976.7, 37582.9, -29983.5, 37584.9, -29984.8, 37589.8, -29981.3, 37603.7, -29986.0, 37607.2, -29985.2, 37610.1, -29992.1, 37614.5, -29989.4, 37617.4, -29986.7, 37626.2, -29989.4, 37634.8, -29986.7, 37639.5, -29987.0, 37643.4, -29991.1, 37646.1, -29994.8, 37652.4, -29994.8, 37660.8, -29999.2, 37667.1, -30000.4, 37670.5, -29999.0, 37671.3, -30004.8, 37686.2, -30006.8, 37687.4, -30022.5, 37773.8, -30036.2, 37780.9, -30031.3, 37791.0, -30035.4, 37792.9, -30033.7, 37796.1, -30026.4, 37792.4, -30017.6, 37809.1, -29991.1, 37795.6, -30006.3, 37765.5, -29992.8, 37695.0, -29994.3, 37690.4, -29988.4, 37675.4, -29977.2, 37673.2, -29969.6, 37661.5, -29970.8, 37637.5, -29967.9, 37637.5, -29968.6, 37622.1, -29926.2, 37620.6, -29924.8, 37649.7, -29931.6, 37650.2, -29931.1, 37660.3, -29937.7, 37660.5, -29937.0, 37674.9, -29925.5, 37674.5, -29925.5, 37676.7, -29908.1, 37675.7, -29907.6, 37666.9, -29910.1, 37663.9, -29909.8, 37660.5, -29906.9, 37657.8, -29906.2, 37645.3, -29904.9, 37645.6, -29904.7, 37642.4, -29902.7, 37642.6, -29902.2, 37633.1, -29851.6, 37636.0, -29853.0, 37658.1, -29846.2, 37658.3, -29842.3, 37633.6, -29839.8, 37631.6, -29842.3, 37628.2, -29839.1, 37626.0, -29841.3, 37622.8, -29787.4, 37583.7, -29780.3, 37539.1, -29786.4, 37535.7, -29792.3, 37527.1, -29793.5, 37516.8, -29790.8, 37509.0, -29806.0, 37516.1, -29807.2, 37521.7, -29810.2, 37522.2, -29809.9, 37524.4, -29813.9, 37529.6, -29822.2, 37531.8, -29824.9, 37534.7, -29837.4, 37535.2, -29838.8, 37532.3, -29846.2, 37534.7, -29852.3, 37533.7, -29860.1, 37526.9, -29866.0, 37531.8, -29869.9, 37531.5, -29874.1, 37534.2, -29877.8, 37532.3, -29875.6, 37524.4, -29877.3, 37522.0, -29875.8, 37515.4, -29877.5, 37512.9, -29875.6, 37511.7, -29878.0, 37506.3, -29877.0, 37504.6, -29884.1, 37503.9, -29888.8, 37497.3, -29885.3, 37491.4, -29880.9, 37489.9, -29882.9, 37484.0, -29881.9, 37481.1, -29886.3, 37477.7, -29895.4, 37480.9, -29895.6, 37484.5, -29891.2, 37490.4, -29895.9, 37494.6, -29894.7, 37496.0, -29908.1, 37507.8, -29905.9, 37510.7, -29907.9, 37512.4, -29910.3, 37510.0],
    holes: [],
  },
  {
    outer: [-30046.9, 37394.7, -30053.1, 37424.6, -30046.9, 37448.6, -30040.6, 37454.7, -30030.1, 37447.1, -30025.9, 37453.2, -30027.6, 37454.4, -30030.5, 37450.0, -30032.7, 37451.5, -30030.3, 37454.9, -30032.0, 37456.1, -30034.5, 37452.7, -30039.4, 37456.1, -30034.5, 37460.8, -30025.6, 37464.5, -30014.1, 37465.2, -30008.8, 37468.4, -29999.2, 37467.2, -29995.0, 37464.2, -29976.7, 37462.0, -29976.4, 37464.0, -29962.7, 37462.5, -29961.3, 37459.8, -29957.3, 37459.1, -29950.7, 37447.8, -29953.4, 37446.1, -29946.3, 37434.6, -29943.4, 37436.3, -29936.0, 37424.3, -29926.2, 37418.0, -29931.6, 37410.6, -29930.6, 37408.7, -29934.8, 37406.2, -29939.9, 37415.3, -29941.7, 37414.5, -29937.5, 37407.2, -29941.2, 37401.8, -29937.3, 37398.9, -29937.3, 37393.7, -29940.4, 37393.2, -29940.9, 37387.4, -29943.4, 37384.4, -29940.4, 37382.2, -29937.3, 37383.5, -29940.7, 37378.6, -29939.5, 37374.4, -29931.9, 37366.8, -29935.1, 37351.9, -29942.6, 37340.1, -29985.5, 37327.2, -29996.8, 37326.9, -29997.7, 37336.5, -29995.3, 37341.4, -29999.4, 37344.5, -30001.2, 37341.6, -29998.7, 37339.4, -29997.7, 37326.9, -30006.5, 37325.0, -30010.5, 37347.7, -30023.0, 37364.6, -30027.4, 37383.2, -30035.9, 37389.8],
    holes: [[-29999.9, 37352.6, -29990.9, 37357.8, -29988.2, 37352.9, -29986.5, 37354.1, -29990.9, 37361.7, -29990.1, 37363.9, -29987.4, 37364.1, -29979.9, 37371.0, -29975.0, 37372.2, -29964.2, 37373.4, -29960.3, 37371.7, -29950.2, 37359.2, -29945.8, 37360.4, -29945.6, 37363.1, -29950.0, 37369.3, -29949.5, 37375.9, -29959.5, 37380.8, -29965.7, 37389.8, -29968.1, 37398.1, -29963.9, 37404.0, -29964.9, 37415.8, -29961.0, 37419.4, -29963.0, 37419.2, -29963.2, 37422.1, -29965.7, 37423.1, -29967.1, 37434.9, -29971.0, 37434.1, -29972.0, 37437.3, -29968.6, 37438.5, -29973.0, 37448.1, -29981.1, 37453.7, -29998.0, 37453.7, -30005.1, 37459.1, -30009.0, 37456.9, -30001.2, 37448.1, -29998.7, 37441.0, -30005.1, 37439.5, -30004.6, 37438.3, -29998.7, 37439.5, -29999.9, 37432.4, -30011.2, 37422.9, -30025.6, 37423.1, -30027.1, 37421.1, -30024.4, 37417.0, -30020.7, 37418.2, -30019.8, 37415.0, -30016.1, 37413.8, -30011.9, 37416.5, -30005.3, 37412.6, -30007.3, 37409.6, -30004.6, 37411.6, -30001.9, 37410.6, -30003.1, 37410.1, -30002.1, 37406.0, -30000.7, 37406.2, -30001.7, 37403.5, -30007.0, 37406.0, -30007.8, 37404.7, -30000.9, 37401.3, -29999.9, 37403.8, -29998.2, 37403.0, -29999.2, 37400.6, -29997.5, 37399.9, -29997.0, 37401.3, -29992.8, 37394.5, -29991.9, 37388.6, -29994.1, 37385.4, -30012.9, 37385.4, -30012.7, 37382.2, -30014.6, 37382.2, -30014.1, 37373.9, -30017.8, 37373.9, -30017.6, 37360.9, -30013.4, 37361.2, -30013.4, 37364.4, -30008.0, 37364.4]],
  },
  {
    outer: [-30119.9, 37567.5, -30116.7, 37569.7, -30114.0, 37569.2, -30111.8, 37573.1, -30104.7, 37578.3, -30104.0, 37575.6, -30098.6, 37578.8, -30096.2, 37577.5, -30091.8, 37579.3, -30085.6, 37575.6, -30077.1, 37578.3, -30075.8, 37585.1, -30078.5, 37586.8, -30074.4, 37593.7, -30076.1, 37601.3, -30073.1, 37604.2, -30073.1, 37614.2, -30070.0, 37614.7, -30069.7, 37619.4, -30066.5, 37619.6, -30062.1, 37626.0, -30063.1, 37634.6, -30059.7, 37637.7, -30058.7, 37642.2, -30052.3, 37694.0, -30055.0, 37709.5, -30062.9, 37711.9, -30067.3, 37710.9, -30068.7, 37708.7, -30069.7, 37704.1, -30067.0, 37697.2, -30072.9, 37690.6, -30075.3, 37681.1, -30071.7, 37675.7, -30073.4, 37667.1, -30084.2, 37662.7, -30088.1, 37668.1, -30092.0, 37667.4, -30089.1, 37655.6, -30087.1, 37652.4, -30082.9, 37651.5, -30079.8, 37637.7, -30090.8, 37626.0, -30095.9, 37623.8, -30110.4, 37625.8, -30112.8, 37623.5, -30112.3, 37618.9, -30110.1, 37616.7, -30101.8, 37614.2, -30094.2, 37616.2, -30094.0, 37614.0, -30090.5, 37612.5, -30092.0, 37608.4, -30094.7, 37608.4, -30094.9, 37601.0, -30097.1, 37596.1, -30108.4, 37588.1, -30111.1, 37592.0, -30100.8, 37599.1, -30099.6, 37602.0, -30100.8, 37607.4, -30103.3, 37609.6, -30109.4, 37609.8, -30133.1, 37592.5, -30141.0, 37591.5, -30145.6, 37593.9, -30151.7, 37602.5, -30153.0, 37605.9, -30151.2, 37613.5, -30148.1, 37617.9, -30138.8, 37623.5, -30137.5, 37631.4, -30131.7, 37635.1, -30128.0, 37640.2, -30115.5, 37636.5, -30113.8, 37638.7, -30104.5, 37639.5, -30104.0, 37634.6, -30098.1, 37632.4, -30095.4, 37633.1, -30092.5, 37639.0, -30088.3, 37638.5, -30086.6, 37642.6, -30089.3, 37646.1, -30095.4, 37649.0, -30101.1, 37657.6, -30101.5, 37662.0, -30098.1, 37673.5, -30102.8, 37673.5, -30105.7, 37678.1, -30113.8, 37673.5, -30117.2, 37677.6, -30101.3, 37688.2, -30092.0, 37687.7, -30089.8, 37691.1, -30086.1, 37709.0, -30082.0, 37713.1, -30074.9, 37710.9, -30067.0, 37717.5, -30059.2, 37718.0, -30050.1, 37712.4, -30047.7, 37704.8, -30063.8, 37572.2, -30069.0, 37563.3, -30067.0, 37556.7, -30071.7, 37547.7, -30079.8, 37538.1, -30079.3, 37540.8, -30091.5, 37531.8, -30098.9, 37531.5, -30117.2, 37539.8, -30116.2, 37542.0, -30118.9, 37542.8, -30127.0, 37557.5, -30120.4, 37564.1],
    holes: [[-30118.7, 37615.0, -30118.9, 37626.5, -30117.0, 37629.7, -30126.0, 37630.6, -30137.8, 37618.4, -30132.9, 37611.6, -30144.6, 37603.2, -30146.8, 37606.4, -30148.1, 37605.7, -30142.7, 37598.1, -30141.5, 37599.1, -30143.9, 37602.3, -30132.2, 37610.3, -30128.7, 37605.4, -30128.2, 37601.3, -30116.2, 37610.6]],
  },
  {
    outer: [-30086.6, 37309.8, -30089.5, 37310.8, -30090.0, 37313.9, -30093.7, 37314.9, -30096.4, 37313.5, -30100.1, 37317.4, -30100.3, 37319.8, -30098.4, 37318.8, -30097.1, 37321.0, -30098.4, 37321.8, -30093.5, 37327.2, -30087.3, 37324.7, -30086.9, 37328.9, -30092.2, 37331.3, -30091.3, 37333.8, -30094.2, 37337.2, -30099.6, 37332.3, -30097.1, 37329.1, -30099.1, 37324.5, -30103.3, 37323.7, -30100.6, 37321.8, -30102.8, 37318.6, -30107.7, 37320.8, -30113.8, 37320.3, -30114.5, 37323.0, -30119.9, 37325.0, -30120.2, 37330.6, -30124.8, 37331.8, -30130.9, 37330.3, -30131.7, 37332.1, -30123.6, 37338.2, -30124.6, 37340.4, -30120.2, 37342.8, -30118.9, 37340.6, -30113.8, 37342.3, -30114.8, 37347.2, -30117.5, 37347.7, -30113.5, 37352.6, -30086.9, 37352.1, -30086.1, 37347.2, -30087.8, 37345.0, -30085.9, 37343.1, -30083.9, 37345.0, -30078.5, 37339.4, -30073.1, 37318.6, -30076.1, 37314.9, -30078.8, 37305.9, -30063.1, 37303.2, -30061.9, 37299.3, -30103.7, 37291.7, -30110.9, 37296.1, -30111.3, 37298.5, -30100.8, 37307.6, -30097.4, 37303.7, -30086.6, 37303.9],
    holes: [],
  },
];

/** Surgical per-land masks so bespoke USJ icons replace generic blocks without leaving bare backlot gaps. */
export const USJ_BUILDING_MASKS: readonly MaskShape[] = [
  // Universal Globe Plaza + Entrance Arch + Hollywood Cruciform Glass Canopy & Coaster
  makeObbMask(34.66665, 135.43475, 0.14, 96, 130),
  // Wizarding World of Harry Potter (Hogwarts Castle + Hogsmeade + Forbidden Journey show building)
  makeObbMask(34.66855, 135.43145, 0.12, 92, 118),
  // Super Nintendo World (Mt. Beanpole, Peach's Castle, Bowser's Castle + Mario Kart block)
  makeObbMask(34.66835, 135.43315, 0.14, 78, 86),
  // Universal Wonderland pastel carnival zone
  makeObbMask(34.66705, 135.43255, 0.14, 62, 68),
  // WaterWorld curved amphitheater & Jurassic Park (Discovery Restaurant + Flying Dinosaur)
  makeObbMask(34.66685, 135.42965, 0.12, 62, 56),
  makeObbMask(34.66525, 135.43015, 0.12, 110, 92),
  // Central Lagoon + New York / San Francisco / Minion Park waterfront facades
  makeObbMask(34.66445, 135.43255, 0.12, 175, 108),
];

export const USJ_TREE_MASKS: readonly MaskShape[] = [
  makeObbMask(34.6663, 135.4325, 0.16, 345, 345),
];

/**
 * Build Universal Studios Japan (USJ) aligned 1:1 to GSI z17 orthophoto:
 * - Surveyed Central Lagoon, Amity Harbor / Black Lake, Jurassic River & Hogwarts Lake
 * - Universal Globe Plaza (sapphire globe + golden orbital ring) & Entrance Arch (34.6675, 135.4352)
 * - Hollywood Grand Cruciform Glass Canopy (34.66635, 135.43475) + Art-Deco storefronts + white Hollywood Dream coaster
 * - The Wizarding World of Harry Potter (34.66878, 135.43145): rocky crag + Hogwarts Castle + snowy Hogsmeade Village
 * - Super Nintendo World (34.66835, 135.43310): Mt. Beanpole, Peach's Castle, Bowser's Castle, Warp Pipes, Question Blocks
 * - Universal Wonderland pastel carousel & pavilions (34.66705, 135.43255)
 * - WaterWorld curved amphitheater (34.66685, 135.42965) + Jurassic Park Discovery dome & emerald Flying Dinosaur coaster
 * - Architectural New York / San Francisco / Minion Park waterfront streetscapes with warm nighttime windows
 */
export function buildUsj(b: LandmarkBuilder, ground: GroundFn) {
  // 1. Surveyed park water surfaces (Central Lagoon, Amity/Black Lake, Jurassic River, Hogwarts Lake)
  const lagoonY = ground(-29890, 37565) + 0.42;
  for (const poly of USJ_WATER_POLYGONS) {
    addWaterPolygon(b, poly.outer, lagoonY, [0.05, 0.22, 0.34], poly.holes);
  }

  const white: RGB = [0.92, 0.93, 0.95];
  const cream: RGB = [0.89, 0.84, 0.75];
  const gold: RGB = [0.98, 0.80, 0.28];
  const castleStone: RGB = [0.66, 0.61, 0.54];
  const spireBlue: RGB = [0.20, 0.29, 0.42];
  const rockGrey: RGB = [0.34, 0.33, 0.31];
  const lushGreen: RGB = [0.16, 0.38, 0.14];

  // =========================================================================
  // 2. Universal Globe Plaza & Entrance Archway (34.66745, 135.43520)
  // =========================================================================
  {
    const g = makeSite(34.66745, 135.43520, ground, 0.65, 0.4);
    addFrustum(b, g, 0, 0, 0, 14.0, 13.4, 1.5, 24, [0.78, 0.76, 0.72], { style: 4 });
    addFrustum(b, g, 0, 1.5, 0, 11.8, 11.8, 0.35, 24, [0.08, 0.32, 0.52], { style: 5, glass: 0.96, emit: 0.42 });
    addFrustum(b, g, 0, 1.6, 0, 3.8, 2.4, 4.6, 16, [0.72, 0.74, 0.78], { emit: 0.30 });
    // Iconic deep-sapphire Universal Globe (Ø12.8 m glowing sphere + golden equatorial ring)
    addDome(b, g, 0, 12.6, 0, 6.4, 6.4, 6.4, 8, 20, [0.08, 0.34, 0.84], { latMin: -Math.PI * 0.5, latMax: Math.PI * 0.5, emit: 0.72, glass: 0.84, style: 2 });
    const ringPts: Vec3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ringPts.push(sitePt(g, Math.cos(a) * 8.8, 12.6 + Math.sin(a) * 2.7, Math.sin(a) * 8.8));
    }
    addTubeSpline(b, ringPts, 0.62, 6, 1, gold, { emit: 0.98, style: 3, closed: true });
    addLight(b, sitePt(g, 0, 12.6, 0), [0.38, 0.76, 1.0], 6.0, 0);

    // Grand White Universal Studios Entrance Arch Gate just SW of the Globe
    const arch = makeSite(34.66698, 135.43482, ground, 0.14, 0.4);
    for (const sx of [-20, -10, 10, 20]) {
      addBox(b, arch, sx, 0, 0, 3.4, 15.0, 3.8, white, { style: 0, emit: 0.52 });
    }
    addBox(b, arch, 0, 14.2, 0, 46, 4.4, 4.4, white, { emit: 0.68, style: 0 });
    addBox(b, arch, 0, 18.4, 0, 28, 2.2, 4.8, gold, { emit: 0.90, style: 3 });
    addDome(b, arch, 0, 18.6, 0, 9.0, 5.8, 2.8, 5, 16, white, { emit: 0.62, style: 0 });
  }

  // =========================================================================
  // 3. Hollywood Grand Cruciform Glass Canopy & Art-Deco Streetscape (34.66635, 135.43475)
  // =========================================================================
  {
    const hw = makeSite(34.66635, 135.43475, ground, 0.14, 0.5);
    const roofH = 16.8;
    addBox(b, hw, 0, roofH, 0, 24, 1.2, 92, [0.88, 0.92, 0.97], { emit: 0.58, glass: 0.80, style: 2, includeBottom: true });
    addBox(b, hw, 0, roofH, 6, 62, 1.2, 22, [0.88, 0.92, 0.97], { emit: 0.58, glass: 0.80, style: 2, includeBottom: true });
    addDome(b, hw, 0, roofH + 1.0, 6, 13.5, 6.2, 13.5, 5, 16, [0.88, 0.94, 1.0], { emit: 0.74, glass: 0.90, style: 2 });
    for (let z = -42; z <= 42; z += 12) {
      addBox(b, hw, 0, roofH + 1.1, z, 25, 0.7, 0.85, white, { emit: 0.52 });
    }
    const storefronts: [number, number, number, number, number, RGB][] = [
      [-20, -26, 16, 15, 28, [0.92, 0.82, 0.68]],
      [-20, 30, 16, 14, 28, [0.88, 0.66, 0.64]],
      [20, -24, 16, 16, 30, [0.76, 0.84, 0.88]],
      [20, 30, 16, 15, 28, [0.94, 0.86, 0.64]],
      [-38, 6, 18, 14, 22, [0.82, 0.78, 0.72]],
      [38, 6, 18, 15, 22, [0.88, 0.76, 0.66]],
    ];
    for (const [lx, lz, w, h, d, col] of storefronts) {
      addBox(b, hw, lx, 0, lz, w, h, d, col, { topRgb: [0.56, 0.54, 0.50], emit: 0.58, glass: 0.35, style: 1 });
      addBox(b, hw, lx, h - 0.6, lz, w + 0.8, 0.85, d + 0.8, gold, { emit: 0.85, style: 3 });
    }
    // Hollywood Dream – The Ride: flowing pure-white 3D spline roller coaster (43 m lift hill!)
    const hdCtrl: [number, number, number][] = [
      [34.66605, 135.43495, 14],
      [34.66670, 135.43540, 29],
      [34.66735, 135.43578, 44],
      [34.66752, 135.43538, 36],
      [34.66698, 135.43500, 15],
      [34.66640, 135.43525, 34],
      [34.66575, 135.43530, 16],
      [34.66518, 135.43505, 30],
      [34.66502, 135.43440, 22],
      [34.66548, 135.43420, 12],
      [34.66595, 135.43455, 25],
      [34.66625, 135.43485, 14],
    ];
    const hdPts: Vec3[] = hdCtrl.map(([la, lo, h]) => {
      const s = makeSite(la, lo, ground, 0, 0);
      return [s.ox, s.oy + h, s.oz];
    });
    addTubeSpline(b, hdPts, 0.95, 8, 5, [0.95, 0.96, 0.99], { emit: 0.78, style: 3, closed: true });
    for (const p of hdPts) {
      const gy = ground(p[0], p[2]) - 0.5;
      addStrut(b, [p[0], gy, p[2]], [p[0], p[1] - 0.6, p[2]], 0.58, 0.42, 6, [0.84, 0.86, 0.89], 0.14);
    }
  }

  // =========================================================================
  // 4. The Wizarding World of Harry Potter (Hogwarts Castle at exact 34.66878, 135.43145!)
  // =========================================================================
  {
    const hc = makeSite(34.66878, 135.43145, ground, -0.22, 1.5);
    // Dramatic dark-grey sculpted rocky cliff crag overlooking Hogwarts Lake (0–18 m)
    addFrustum(b, hc, 0, 0, 0, 38, 26, 16, 10, rockGrey, { topRgb: [0.26, 0.29, 0.23], style: 4 });
    addFrustum(b, hc, -16, 0, 8, 24, 16, 13, 8, rockGrey, { style: 4 });
    addFrustum(b, hc, 18, 0, -6, 22, 14, 14, 8, rockGrey, { style: 4 });

    // Hogwarts Great Hall & Stone Wings with warm golden glowing gothic windows!
    addBox(b, hc, -11, 15, 5, 28, 14, 16, castleStone, { topRgb: spireBlue, emit: 0.62, style: 4 });
    addBox(b, hc, -11, 19, 13.2, 20, 7.2, 0.5, [1.0, 0.82, 0.44], { emit: 0.95, glass: 0.75, style: 2 });
    addBox(b, hc, 7, 15, -3, 28, 16, 20, castleStone, { topRgb: spireBlue, emit: 0.56, style: 4 });
    addBox(b, hc, 7, 20, 7.2, 18, 6.0, 0.5, [1.0, 0.80, 0.40], { emit: 0.90, glass: 0.7, style: 2 });
    addFrustum(b, hc, -11, 29, 5, 12.2, 0.5, 10.5, 4, spireBlue, { phase: Math.PI / 4, style: 4, emit: 0.18 });

    // Cluster of Iconic Hogwarts Stone Towers & Sharp Slate-Blue Conical Spires!
    const towers: [number, number, number, number, number, number][] = [
      [8, -5, 16, 6.8, 24, 16],    // Grand Astronomy / Main Keep Tower (~56 m!)
      [-3, -10, 16, 4.8, 19, 12.5], // Gryffindor / Defence Tower
      [20, 4, 14, 4.4, 17, 11],    // Clock / Bell Tower
      [-20, -3, 14, 4.0, 15, 10],  // West Turret
      [15, -14, 14, 3.6, 14, 9.5], // North Turret
      [-6, 14, 15, 3.4, 12, 8.5],  // Great Hall Entry Turret
    ];
    for (const [tx, tz, y0, r, sh, sph] of towers) {
      addFrustum(b, hc, tx, y0, tz, r, r * 0.94, sh, 12, castleStone, { emit: 0.60, style: 4 });
      addFrustum(b, hc, tx, y0 + sh - 1.2, tz, r * 1.07, r * 1.09, 1.5, 12, [0.58, 0.54, 0.48], { style: 4, emit: 0.48 });
      addFrustum(b, hc, tx, y0 + sh, tz, r * 1.14, 0.16, sph, 12, spireBlue, { style: 4, emit: 0.22 });
    }
    // Misty dark-slate Forbidden Forest hills screening the northern backlot behind Hogwarts
    for (const [fx, fz, r, h] of [[-22, -30, 16, 18], [0, -36, 20, 22], [24, -30, 18, 19]] as const) {
      addDome(b, hc, fx, 0, fz, r, h, r * 0.85, 4, 10, [0.12, 0.26, 0.14], { style: 4 });
    }
    addLight(b, sitePt(hc, 6, 42, 0), [1.0, 0.82, 0.48], 6.4, 0);
    addLight(b, sitePt(hc, -10, 24, 12), [1.0, 0.78, 0.38], 5.2, 0);

    // Hogsmeade Village: snow-capped steep Tudor cottages lining the South approach lane (34.66785, 135.43135)
    const hm = makeSite(34.66785, 135.43135, ground, 0.15, 0.8);
    const snowRoof: RGB = [0.91, 0.94, 0.98];
    const timberWall: RGB = [0.60, 0.51, 0.42];
    for (const [hx, hz, w, d, h] of [
      [-14, -24, 13, 15, 8.5], [-16, -4, 14, 16, 9.5], [-15, 16, 13, 15, 8.5],
      [14, -22, 14, 15, 9.0], [15, -2, 14, 16, 9.5], [14, 18, 14, 15, 8.5],
    ] as const) {
      addBox(b, hm, hx, 0, hz, w, h, d, timberWall, { emit: 0.68, glass: 0.3, style: 1 });
      addFrustum(b, hm, hx, h, hz, Math.max(w, d) * 0.64, 0.4, 6.4, 4, snowRoof, { phase: Math.PI / 4, emit: 0.28, style: 4 });
    }
  }

  // =========================================================================
  // 5. Super Nintendo World (exact NE terrace at 34.66835, 135.43310!)
  // =========================================================================
  {
    const nw = makeSite(34.66835, 135.43310, ground, 0.14, 0.8);
    const beanGreen: RGB = [0.18, 0.68, 0.22];
    const beanTop: RGB = [0.30, 0.80, 0.24];
    const pipeGreen: RGB = [0.10, 0.70, 0.24];
    const qYellow: RGB = [0.98, 0.84, 0.14];
    const peachRed: RGB = [0.90, 0.18, 0.22];
    const bowserDark: RGB = [0.22, 0.20, 0.25];

    // Iconic tiered emerald-green Mt. Beanpole terraced hills + yellow victory flagpole!
    const tiers: [number, number, number, number, number][] = [
      [-10, -8, 0, 28, 12],
      [-12, -10, 12, 20, 11],
      [-14, -12, 23, 14, 10],
      [14, -6, 0, 22, 11],
      [16, -8, 11, 15, 10],
      [-28, 10, 0, 16, 10],
    ];
    for (const [mx, mz, y0, r, h] of tiers) {
      addFrustum(b, nw, mx, y0, mz, r, r * 0.94, h, 14, beanGreen, { topRgb: beanTop, style: 4, emit: 0.34 });
    }
    // Tall victory Flagpole atop Mt. Beanpole!
    addFrustum(b, nw, -14, 33, -12, 0.38, 0.28, 12, 8, [0.94, 0.95, 0.97], { emit: 0.70, style: 3 });
    addDome(b, nw, -14, 45.4, -12, 1.25, 1.25, 1.25, 4, 10, qYellow, { latMin: -Math.PI * 0.5, latMax: Math.PI * 0.5, emit: 0.95, style: 3 });
    addBox(b, nw, -11.2, 41.2, -12, 5.2, 3.0, 0.35, peachRed, { emit: 0.85, style: 3 });

    // Fairytale Peach's Castle (white walls + bright crimson spires + golden stained-glass medallion)
    addBox(b, nw, -24, 0, 24, 20, 13, 15, white, { topRgb: peachRed, emit: 0.68, style: 4 });
    addFrustum(b, nw, -24, 13, 24, 5.6, 5.2, 10, 12, white, { emit: 0.68, style: 4 });
    addFrustum(b, nw, -24, 23, 24, 6.2, 0.2, 11.5, 12, peachRed, { emit: 0.56, style: 3 });
    for (const sx of [-10, 10]) {
      addFrustum(b, nw, -24 + sx, 0, 24, 3.5, 3.2, 16, 10, white, { emit: 0.62, style: 4 });
      addFrustum(b, nw, -24 + sx, 16, 24, 3.9, 0.2, 7.5, 10, peachRed, { emit: 0.56, style: 3 });
    }
    addDome(b, nw, -24, 17.0, 31.8, 2.4, 2.8, 0.5, 4, 12, qYellow, { emit: 0.95, style: 3 });

    // Volcanic dark-stone Bowser's Castle with fiery amber glow on the East rampart!
    addBox(b, nw, 28, 0, -14, 30, 24, 26, bowserDark, { topRgb: [0.16, 0.14, 0.17], emit: 0.42, style: 4 });
    for (const [bx, bz] of [[15, -25], [41, -25], [15, -3], [41, -3]] as const) {
      addFrustum(b, nw, bx, 0, bz, 4.6, 4.0, 29, 8, bowserDark, { emit: 0.36, style: 4 });
      addFrustum(b, nw, bx, 29, bz, 4.6, 0.3, 7.0, 8, [0.64, 0.16, 0.12], { emit: 0.78, style: 3 });
    }
    addBox(b, nw, 28, 13, -0.8, 11, 7.0, 0.6, [1.0, 0.45, 0.10], { emit: 1.0, style: 3 });

    // Giant iconic green Warp Pipes & yellow Question Blocks!
    for (const [px, pz, ph] of [[-12, 20, 6.8], [4, 16, 5.8], [18, 14, 7.4]] as const) {
      addFrustum(b, nw, px, 0, pz, 2.4, 2.4, ph, 12, pipeGreen, { emit: 0.52, style: 4 });
      addFrustum(b, nw, px, ph - 1.2, pz, 2.9, 2.9, 1.5, 12, pipeGreen, { topRgb: [0.04, 0.12, 0.06], emit: 0.55, style: 4 });
    }
    for (const [qx, qy, qz] of [[-4, 12, 8], [2, 14, 6], [8, 12, 10]] as const) {
      addBox(b, nw, qx, qy, qz, 3.2, 3.2, 3.2, qYellow, { emit: 0.94, style: 3 });
    }
    addLight(b, sitePt(nw, 0, 28, 0), [1.0, 0.88, 0.38], 5.8, 0);
  }

  // =========================================================================
  // 6. Universal Wonderland Pastel Carnival (34.66705, 135.43255) & WaterWorld (34.66685, 135.42965)
  // =========================================================================
  {
    // Universal Wonderland: bright pastel carousel dome & whimsical Snoopy/Hello Kitty pavilions
    const wl = makeSite(34.66705, 135.43255, ground, 0.14, 0.5);
    addFrustum(b, wl, 0, 0, 0, 14.5, 14.5, 4.5, 16, [0.96, 0.84, 0.88], { emit: 0.62, style: 4 });
    addFrustum(b, wl, 0, 4.5, 0, 15.5, 0.8, 7.5, 16, [0.95, 0.52, 0.62], { emit: 0.72, style: 3 });
    addBox(b, wl, -26, 0, -14, 22, 12, 18, [0.84, 0.90, 0.96], { topRgb: [0.92, 0.72, 0.78], emit: 0.56, glass: 0.3, style: 1 });
    addBox(b, wl, 24, 0, 12, 20, 11, 16, [0.96, 0.90, 0.72], { topRgb: [0.70, 0.86, 0.80], emit: 0.56, glass: 0.3, style: 1 });
    addLight(b, sitePt(wl, 0, 13, 0), [1.0, 0.74, 0.86], 4.8, 0);

    // WaterWorld Curved Stadium Grandstand & Rusty Steel Atoll (exact z17 yellow curve at 34.66685, 135.42965)
    const ww = makeSite(34.66685, 135.42965, ground, 0.18, 0.6);
    for (let i = 0; i < 10; i++) {
      const a0 = -Math.PI * 0.15 + (i / 10) * Math.PI * 1.15;
      const a1 = -Math.PI * 0.15 + ((i + 1) / 10) * Math.PI * 1.15;
      const am = (a0 + a1) * 0.5;
      addBox(b, ww, Math.cos(am) * 28, 0, Math.sin(am) * 28, 12, 13, 12, [0.82, 0.78, 0.68], { topRgb: [0.88, 0.84, 0.70], style: 4, emit: 0.25 });
    }
    addFrustum(b, ww, 0, 0, -4, 18, 18, 0.8, 18, [0.06, 0.26, 0.38], { style: 5, glass: 0.96, emit: 0.22 });
    addFrustum(b, ww, 2, 0.8, -14, 5.0, 2.4, 13.5, 8, [0.56, 0.36, 0.24], { style: 4, emit: 0.20 });
  }

  // =========================================================================
  // 7. Jurassic Park (Discovery Restaurant Dome + The Flying Dinosaur Coaster!)
  // =========================================================================
  {
    const jp = makeSite(34.66525, 135.43072, ground, 0.12, 0.8);
    // Iconic Discovery Restaurant with ribbed verdigris-green copper dome overlooking the Central Lagoon
    addBox(b, jp, 0, 0, 0, 34, 10.5, 28, [0.78, 0.68, 0.52], { style: 1, glass: 0.35, emit: 0.56 });
    addDome(b, jp, 0, 10.5, 0, 14.0, 9.8, 14.0, 6, 16, [0.22, 0.58, 0.48], { style: 4, emit: 0.42 });
    const ride = makeSite(34.66525, 135.42925, ground, 0.12, 0.8);
    addBox(b, ride, 0, 0, 0, 48, 22, 42, [0.26, 0.34, 0.22], { topRgb: lushGreen, style: 4, emit: 0.16 });
    addFrustum(b, ride, 14, 0, 16, 19, 9.5, 26, 8, [0.36, 0.34, 0.28], { topRgb: lushGreen, style: 4 });

    // The Flying Dinosaur: soaring dark-emerald tubular coaster track (46 m crest + pretzel loop!)
    const fdCtrl: [number, number, number][] = [
      [34.66565, 135.43045, 12],
      [34.66595, 135.42995, 32],
      [34.66605, 135.42965, 46],
      [34.66545, 135.42975, 16],
      [34.66495, 135.43025, 34],
      [34.66475, 135.43085, 12],
      [34.66510, 135.43135, 29],
      [34.66555, 135.43110, 18],
      [34.66570, 135.43070, 14],
    ];
    const fdPts: Vec3[] = fdCtrl.map(([la, lo, h]) => {
      const s = makeSite(la, lo, ground, 0, 0);
      return [s.ox, s.oy + h, s.oz];
    });
    addTubeSpline(b, fdPts, 0.95, 8, 5, [0.12, 0.46, 0.26], { emit: 0.34, style: 0, closed: true });
    for (const p of fdPts) {
      const gy = ground(p[0], p[2]) - 0.5;
      addStrut(b, [p[0], gy, p[2]], [p[0], p[1] - 0.6, p[2]], 0.62, 0.45, 6, [0.26, 0.32, 0.22], 0.08);
    }
  }

  // =========================================================================
  // 8. Architectural New York / San Francisco / Minion Park Waterfront (with lit windows!)
  // =========================================================================
  {
    const ny = makeSite(34.66415, 135.43255, ground, 0.14, 0.8);
    const waterfront: [number, number, number, number, number, RGB, RGB][] = [
      // San Francisco Wharf red-brick warehouses & peaked clerestories
      [-86, -16, 32, 15, 22, [0.64, 0.34, 0.26], [0.42, 0.38, 0.36]],
      [-48, -12, 28, 17, 22, [0.70, 0.46, 0.34], [0.48, 0.44, 0.42]],
      // New York Brownstones, Delancey Street & Grand Library Theater
      [-14, -8, 30, 21, 24, [0.76, 0.58, 0.46], [0.50, 0.48, 0.46]],
      [22, -10, 34, 24, 26, [0.78, 0.72, 0.64], [0.54, 0.52, 0.50]],
      [-28, 28, 38, 19, 26, [0.66, 0.46, 0.38], [0.46, 0.44, 0.42]],
      [18, 30, 44, 20, 28, [0.68, 0.62, 0.56], [0.48, 0.46, 0.44]],
      // Minion Park vibrant yellow & sky-blue Art-Deco pavilions (East waterfront)
      [68, -28, 32, 17, 24, [0.96, 0.84, 0.28], [0.84, 0.66, 0.24]],
      [74, 4, 34, 16, 24, [0.34, 0.60, 0.86], [0.52, 0.62, 0.72]],
      [108, -14, 30, 15, 22, [0.92, 0.74, 0.56], [0.54, 0.50, 0.48]],
    ];
    for (const [lx, lz, w, h, d, col, top] of waterfront) {
      // Curtain-wall / architectural window style=1 so every facade has rich daytime depth & lively warm night windows!
      addBox(b, ny, lx, 0, lz, w, h, d, col, { topRgb: top, emit: 0.58, glass: 0.42, style: 1 });
      // Stepped classical cornice crown & rooftop parapet penthouse
      addBox(b, ny, lx, h - 0.8, lz, w + 1.2, 1.1, d + 1.2, cream, { emit: 0.42 });
      addBox(b, ny, lx, h + 0.3, lz, w * 0.58, 2.6, d * 0.52, top, { emit: 0.22, style: 4 });
    }
    // Floating Lagoon Night Show Stage Ring & luminous beacon fountain!
    const stg = makeSite(34.66478, 135.43195, ground, 0, 0);
    addAnnulusRing(b, stg, 0, 0.45, 0, 7.2, 12.0, 1.5, 20, [0.26, 0.34, 0.48], { topRgb: gold, emit: 0.92, style: 3 });
    addLight(b, sitePt(stg, 0, 9, 0), [0.46, 0.84, 1.0], 5.8, 0);
  }
}
