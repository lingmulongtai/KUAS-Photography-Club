import {
  addDome, addFrustum, addLight, addStrut, type GroundFn, type LandmarkBuilder, type RGB,
} from './landmark-builder';
import { toLocal } from './geo';
import { rng } from './util';
import { COASTERS, OUTLINES, STREETS, USJ_WATER } from './landmark-outlines';
import { at, battlements, block, centroid, coaster, dominantAngle, frame, inRing, inset, localBounds, prism, ringOf, type XZ } from './landmark-kit';
import { facadeRow, gable, lineDistance, water, type Facade } from './landmark-streets';

/**
 * Universal Studios Japan. Water bodies, coaster centrelines, streets and the Hogwarts outline
 * come from OpenStreetMap; attraction positions from their mapped nodes. Show buildings and
 * sound stages stay with the regional survey layer; this model adds the themed architecture.
 */
const site = (lat: number, lon: number) => toLocal(lat, lon);
const P = {
  globe: site(34.66745, 135.43520), gate: site(34.66698, 135.43482),
  bowser: site(34.66805, 135.42992), yoshi: site(34.66802, 135.4303), peach: site(34.66822, 135.43042),
  donkeyKong: site(34.66874, 135.43064), jpGate: site(34.66553, 135.43047), discovery: site(34.66509, 135.43085),
  shark: site(34.66603, 135.43189), minion: site(34.66306, 135.43237),
  snoopy: site(34.66675, 135.43258),
};
const lines = Object.fromEntries(Object.entries(STREETS).map(([k, ways]) => [k, ways.map(w => ringOfLine(w))])) as
  Record<keyof typeof STREETS, XZ[][]>;
const waters = USJ_WATER.map(w => ringOf(w)).filter(r => centroid(r).z < 37840);
const castle = ringOf(OUTLINES.hogwarts);
const castleCentre = centroid(castle);

function ringOfLine(flat: readonly number[]): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(toLocal(flat[i], flat[i + 1]));
  return out;
}

const MODELLED: { p: XZ; r: number }[] = [
  { p: castleCentre, r: 58 }, { p: P.bowser, r: 34 }, { p: P.peach, r: 30 }, { p: P.globe, r: 14 },
  { p: P.gate, r: 22 }, { p: P.jpGate, r: 12 }, { p: P.shark, r: 10 },
  // A narrow survey extrusion beside the Minion Park lagoon front, taller than anything in the park.
  { p: { x: -29821, z: 37694 }, r: 16 },
];
const streetLines = Object.values(lines).flat();

/** Generic survey buildings under the themed streets and modelled attractions give way. */
export function inUsjModel(x: number, z: number) {
  if (Math.abs(x - -29860) > 330 || Math.abs(z - 37480) > 380) return false;
  return MODELLED.some(m => Math.hypot(x - m.p.x, z - m.p.z) < m.r) || streetLines.some(l => lineDistance(l, x, z) < 18);
}

/** Trees stay off the water, the castle crag and the street fronts. */
export function inUsjClearing(x: number, z: number) {
  if (Math.abs(x - -29860) > 330 || Math.abs(z - 37480) > 380) return false;
  return waters.some(r => inRing(r, x, z)) || inUsjModel(x, z);
}

const STONE: RGB = [.58, .56, .52];
const SLATE: RGB = [.20, .25, .31];
const ROCK: RGB = [.34, .31, .28];
const WARM: RGB = [.95, .72, .42];

export function buildUsj(b: LandmarkBuilder, ground: GroundFn) {
  const random = rng(20011);
  const lagoonY = ground(-29890, 37565) + .35;
  for (const ring of waters) water(b, ring, Math.min(lagoonY, ground(centroid(ring).x, centroid(ring).z) + .35));

  hogwarts(b, ground, random);
  nintendo(b, ground);
  globeAndGate(b, ground);
  jurassic(b, ground);
  amity(b, ground);

  const skip = (x: number, z: number) => waters.some(r => inRing(inset(r, -3), x, z)) ||
    Math.hypot(x - castleCentre.x, z - castleCentre.z) < 45;
  const styles: Record<string, Facade> = {
    hollywood: { width: [8, 16], height: [7, 12], depth: 12, roof: 'flat', glow: .5, storey: 3.6,
      walls: [[.86, .80, .70], [.80, .66, .58], [.70, .78, .76], [.90, .86, .78], [.78, .70, .80]], trim: [.95, .93, .88] },
    newYork: { width: [9, 15], height: [14, 24], depth: 14, roof: 'flat', glow: .45, storey: 3.4,
      walls: [[.50, .27, .20], [.58, .35, .26], [.70, .64, .54], [.44, .30, .26], [.62, .56, .48]] },
    sanFrancisco: { width: [6, 9], height: [9, 13], depth: 10, roof: 'flat', glow: .4,
      walls: [[.82, .74, .58], [.70, .78, .80], [.86, .70, .62], [.76, .80, .66]] },
    amity: { width: [7, 11], height: [6, 9], depth: 10, roof: 'gable', roofRgb: [.30, .30, .32], glow: .35,
      walls: [[.88, .88, .84], [.60, .68, .74], [.76, .70, .60], [.66, .52, .44]], trim: [.95, .95, .92] },
    hogsmeade: { width: [6, 9], height: [6, 9], depth: 9, roof: 'snow', glow: .55,
      walls: [[.52, .44, .36], [.62, .56, .46], [.40, .36, .32], [.70, .64, .52]], trim: [.28, .22, .18], roofRgb: [.30, .28, .27] },
  };
  const rows: [keyof typeof lines, Facade, number][] = [
    ['hollywood', styles.hollywood, 9], ['brighton', styles.hollywood, 8], ['newYork', styles.newYork, 9],
    ['waterfront', styles.newYork, 8], ['sanFrancisco', styles.sanFrancisco, 7], ['amity', styles.amity, 7],
    ['hogsmeade', styles.hogsmeade, 5],
  ];
  for (const [name, style, setback] of rows) {
    for (const line of lines[name]) for (const side of [-1, 1]) facadeRow(b, ground, line, side, setback, style, random, skip);
  }

  const glow = (r: number, g: number, bl: number): RGB => [r, g, bl];
  coaster(b, ground, COASTERS.hollywoodDream, { peak: 43, rail: [.92, .92, .95], spine: [.80, .80, .84], support: [.82, .82, .85],
    glow: glow(1, .45, .85) });
  coaster(b, ground, COASTERS.flyingDinosaur, { peak: 37, rail: [.22, .42, .26], spine: [.20, .38, .24], support: [.30, .42, .30], gauge: .7 });
  coaster(b, ground, COASTERS.hippogriff, { peak: 12, rail: [.40, .30, .22], spine: [.32, .26, .20], support: [.36, .30, .24] });
  coaster(b, ground, COASTERS.mineCart, { peak: 9, rail: [.55, .38, .20], spine: [.42, .28, .16], support: [.50, .36, .22] });
}

/** Hogwarts: a crag of stacked rock, a curtain wall on the mapped outline and spired towers. */
function hogwarts(b: LandmarkBuilder, ground: GroundFn, random: () => number) {
  const angle = dominantAngle(castle);
  const g = ground(castleCentre.x, castleCentre.z);
  const f = frame(castleCentre.x, castleCentre.z, g - .5, angle);
  const box = localBounds(f, castle);
  const w = box.x1 - box.x0, d = box.z1 - box.z0;
  // Crag: irregular stacked frustums wider than the castle, falling towards the Black Lake.
  for (let i = 0; i < 9; i++) {
    const r = Math.max(w, d) * (.75 - i * .055) + random() * 3;
    const ox = (random() - .5) * 10, oz = (random() - .5) * 8;
    addFrustum(b, f, ox, i * 1.6, oz, r, r * .9, 1.9, 9 + (i % 3), [ROCK[0] + random() * .05, ROCK[1] + random() * .04, ROCK[2] + random() * .03],
      { style: 4, phase: random() * 3, topRgb: [.30, .34, .26] });
  }
  const base = 14;
  const wall = inset(castle, 2).map(p => ({ x: p.x, z: p.z }));
  prism(b, wall, g + base, g + base + 11, STONE, { style: 4, emit: .25, topRgb: SLATE });
  // Lancet windows warm at night all round the wall.
  prism(b, inset(wall, -.05), g + base + 4, g + base + 7, [.26, .22, .18], { glass: .4, style: 2, emit: .9, top: false });
  // Great Hall and the main keep with steep slate roofs.
  block(b, f, box.x0 + 8, box.x0 + 8 + w * .48, base + 11, base + 21, -d * .18, d * .18, STONE, { style: 4, emit: .3 });
  gable(b, f, box.x0 + 8, box.x0 + 8 + w * .48, -d * .18, d * .18, base + 21, 8, SLATE, STONE, .4);
  block(b, f, box.x0 + w * .55, box.x1 - 10, base + 11, base + 26, -d * .26, d * .08, STONE, { style: 4, emit: .3 });
  gable(b, f, box.x0 + w * .55, box.x1 - 10, -d * .26, d * .08, base + 26, 9, SLATE, STONE, .4);
  // Towers: round and octagonal, of different heights, each under a tall conical spire.
  const towers: [number, number, number, number, number][] = [
    // local x, z, radius, shaft top above the crag, spire height
    [box.x0 + w * .78, -d * .05, 4.2, 34, 16], [box.x0 + w * .62, d * .30, 3.2, 26, 12], [box.x0 + w * .30, -d * .32, 3.0, 24, 11],
    [box.x0 + w * .18, d * .26, 2.6, 22, 10], [box.x1 - 4, d * .22, 2.8, 27, 12], [box.x1 - 6, -d * .34, 2.4, 22, 9],
    [box.x0 + 5, -d * .05, 3.4, 25, 12], [box.x0 + w * .45, -d * .40, 2.2, 21, 8], [box.x0 + w * .42, d * .38, 2.4, 23, 10],
    [box.x0 + w * .86, d * .36, 2.0, 20, 8], [box.x0 + w * .70, -d * .40, 1.8, 30, 9],
  ];
  for (const [x, z, r, top, spire] of towers) {
    const sides = r > 3 ? 12 : 8;
    addFrustum(b, f, x, base, z, r, r * .96, top, sides, STONE, { style: 4, emit: .3, capTop: false });
    // A corbelled ring below the spire, and slit windows lit at night.
    addFrustum(b, f, x, base + top - 1.2, z, r * 1.12, r * 1.12, 1.2, sides, [.50, .48, .45], { style: 4 });
    addFrustum(b, f, x, base + top * .55, z, r * 1.005, r * 1.005, 1.1, sides, [.30, .28, .26], { style: 2, emit: .9, capTop: false });
    addFrustum(b, f, x, base + top, z, r * 1.18, 0, spire, sides, SLATE, { style: 4, topRgb: SLATE });
    addStrut(b, at(f, x, base + top + spire, z), at(f, x, base + top + spire + 2.2, z), .08, .03, 4, [.75, .68, .40]);
    addLight(b, at(f, x, base + top * .55 + 1.2, z + r), WARM, 1.1);
  }
  battlements(b, f, box.x0 + 6, box.x1 - 6, -d * .45, d * .45, base + 11, STONE, 1, 1.1);
}

/** Super Nintendo World: Bowser's Castle over Mario Kart, and Peach's Castle on Mount Beanpole. */
function nintendo(b: LandmarkBuilder, ground: GroundFn) {
  const red: RGB = [.78, .16, .12], dark: RGB = [.24, .22, .22], lava: RGB = [1, .42, .08];
  const k = frame(P.bowser.x, P.bowser.z, ground(P.bowser.x, P.bowser.z) - .3, .15);
  block(b, k, -24, 24, 0, 20, -16, 16, dark, { style: 4, emit: .2, topRgb: [.20, .19, .19] });
  battlements(b, k, -24, 24, -16, 16, 20, dark, 1.6, 2.2);
  // The central keep rises over the gate, with lava-lit windows on every floor.
  block(b, k, -10, 10, 20, 32, -10, 6, dark, { style: 4, emit: .2 });
  battlements(b, k, -10, 10, -10, 6, 32, dark, 1.4, 1.8);
  for (let y = 4; y < 30; y += 6) for (const x of [-20, -12, 12, 20]) block(b, k, x - .9, x + .9, y, y + 2.6, -16.3, -16, lava, { style: 3, emit: .9 });
  for (const [x, z, r, h] of [[-24, -16, 5, 30], [24, -16, 5, 30], [-24, 16, 4.5, 27], [24, 16, 4.5, 27], [0, -16, 6.5, 34]] as const) {
    addFrustum(b, k, x, 0, z, r, r * .82, h, 8, dark, { style: 4, emit: .2 });
    addFrustum(b, k, x, h, z, r * 1.15, r * .2, 6, 8, red, { style: 4 });
    for (let s = 0; s < 6; s++) {
      const a = s / 6 * Math.PI * 2;
      addStrut(b, at(k, x + Math.cos(a) * r * .9, h - 1, z + Math.sin(a) * r * .9),
        at(k, x + Math.cos(a) * r * 1.5, h + .5, z + Math.sin(a) * r * 1.5), .35, .02, 4, [.86, .84, .78]);
    }
  }
  // Bowser's face and the glowing lava moat at the gate.
  block(b, k, -7, 7, 8, 18, -17.4, -16, [.32, .52, .22], { style: 4 });
  block(b, k, -4.5, -1.5, 13, 15, -17.6, -17.3, lava, { style: 3, emit: 1.2 });
  block(b, k, 1.5, 4.5, 13, 15, -17.6, -17.3, lava, { style: 3, emit: 1.2 });
  block(b, k, -6, 6, 0, 7, -16.6, -16, [.10, .08, .07], { style: 2, emit: .4 });
  block(b, k, -26, 26, -.2, .3, -24, -17, lava, { style: 3, emit: 1.1 });
  for (let i = 0; i < 6; i++) addLight(b, at(k, -22 + i * 8.8, 1, -20), [1, .5, .15], 1.4);

  // Mount Beanpole: a stepped green hill with Peach's Castle on top and warp pipes around it.
  const m = frame(P.peach.x, P.peach.z, ground(P.peach.x, P.peach.z) - .3, .15);
  const green: RGB = [.32, .62, .24];
  for (let i = 0; i < 6; i++) {
    const r = 22 - i * 3;
    addFrustum(b, m, (i % 2) * 2 - 1, i * 3.2, (i % 3) - 1, r, r - 2.5, 3.2, 16, i % 2 ? green : [.38, .70, .28], { style: 4 });
  }
  const top = 19.2, white: RGB = [.93, .90, .84], pink: RGB = [.92, .52, .58];
  block(b, m, -7, 7, top, top + 8, -5, 5, white, { style: 4, emit: .35, topRgb: red });
  gable(b, m, -7, 7, -5, 5, top + 8, 4, red, white, .4);
  for (const [x, z, h] of [[-7, -5, 13], [7, -5, 13], [-7, 5, 11], [7, 5, 11], [0, -1, 17]] as const) {
    addFrustum(b, m, x, top, z, 1.8, 1.8, h, 12, white, { style: 4, emit: .35 });
    addFrustum(b, m, x, top + h, z, 2.3, 0, 4.5, 12, red, { style: 4 });
    addLight(b, at(m, x, top + h - 2, z - 1.9), [1, .85, .6], .9);
  }
  block(b, m, -1.6, 1.6, top + 3, top + 6.5, -5.2, -5, pink, { style: 3, emit: .6 });
  // Warp pipes and floating question blocks.
  for (const [x, z, h] of [[-26, -10, 4], [-22, 14, 6], [24, -12, 5], [20, 18, 3.5], [0, 26, 7]] as const) {
    addFrustum(b, m, x, 0, z, 2, 2, h, 14, [.14, .62, .18], { style: 4, capTop: false });
    addFrustum(b, m, x, h, z, 2.5, 2.5, 1.4, 14, [.16, .70, .20], { style: 4, topRgb: [.04, .10, .05] });
  }
  for (const [x, y, z] of [[-14, 12, -18], [-10, 12, -18], [12, 15, -15], [16, 9, 20]] as const) {
    block(b, m, x - 1.1, x + 1.1, y, y + 2.2, z - 1.1, z + 1.1, [.98, .76, .10], { style: 3, emit: .7 });
  }
}

/** The Universal Globe in its fountain, and the entrance arch. */
function globeAndGate(b: LandmarkBuilder, ground: GroundFn) {
  const g = frame(P.globe.x, P.globe.z, ground(P.globe.x, P.globe.z) - .2, 0);
  addFrustum(b, g, 0, 0, 0, 10, 10, .8, 32, [.72, .72, .70], { style: 0, topRgb: [.60, .60, .58] });
  water(b, Array.from({ length: 32 }, (_, i) => ({ x: g.ox + Math.cos(i / 32 * Math.PI * 2) * 9.2, z: g.oz + Math.sin(i / 32 * Math.PI * 2) * 9.2 })),
    g.oy + .85, [.08, .28, .42]);
  addFrustum(b, g, 0, .8, 0, 1.4, 1.1, 2.2, 12, [.62, .62, .60]);
  const r = 5.6, cy = 3 + r;
  addDome(b, g, 0, cy, 0, r, r, r, 14, 28, [.10, .32, .72], { latMin: -Math.PI / 2, latMax: Math.PI / 2, glass: .8, style: 2, emit: .55 });
  // Meridians and parallels in polished metal, and the orbiting UNIVERSAL ring.
  for (let m = 0; m < 6; m++) {
    const a = m / 6 * Math.PI;
    let prev = at(g, 0, cy - r * 1.01, 0);
    for (let i = 1; i <= 16; i++) {
      const t = -Math.PI / 2 + i / 16 * Math.PI;
      const next = at(g, Math.cos(a) * Math.cos(t) * r * 1.01, cy + Math.sin(t) * r * 1.01, Math.sin(a) * Math.cos(t) * r * 1.01);
      addStrut(b, prev, next, .07, .07, 4, [.86, .82, .62], .3, .2, 3);
      prev = next;
    }
  }
  const tilt = .38;
  let prev = at(g, r * 1.32, cy, 0);
  for (let i = 1; i <= 40; i++) {
    const a = i / 40 * Math.PI * 2;
    const next = at(g, Math.cos(a) * r * 1.32, cy + Math.sin(a) * r * 1.32 * Math.sin(tilt), Math.sin(a) * r * 1.32 * Math.cos(tilt));
    addStrut(b, prev, next, .34, .34, 5, [.90, .84, .52], .6, .3, 3);
    prev = next;
  }
  for (let i = 0; i < 8; i++) addLight(b, at(g, Math.cos(i / 8 * 6.28) * 9.5, .9, Math.sin(i / 8 * 6.28) * 9.5), [.8, .9, 1], 1.3);

  // Entrance arch: two pylons and a lit sign beam over the turnstiles.
  const e = frame(P.gate.x, P.gate.z, ground(P.gate.x, P.gate.z) - .2, .14 + Math.PI / 2);
  for (const x of [-17, 17]) block(b, e, x - 2.5, x + 2.5, 0, 14, -2.5, 2.5, [.92, .90, .86], { style: 0, emit: .3 });
  block(b, e, -19.5, 19.5, 14, 17.5, -2.8, 2.8, [.94, .92, .88], { style: 0 });
  block(b, e, -15, 15, 14.6, 16.8, -3, -2.8, [.14, .32, .66], { style: 3, emit: 1.1 });
  block(b, e, -15, 15, 14.6, 16.8, 2.8, 3, [.14, .32, .66], { style: 3, emit: 1.1 });
  for (let x = -12; x <= 12; x += 3) block(b, e, x - .6, x + .6, 0, 2.6, -1, 1, [.55, .56, .58]);
}

/** Jurassic Park's timber gate with its torches, and the Discovery Restaurant's visitor centre. */
function jurassic(b: LandmarkBuilder, ground: GroundFn) {
  const j = frame(P.jpGate.x, P.jpGate.z, ground(P.jpGate.x, P.jpGate.z) - .3, -.2);
  const log: RGB = [.36, .26, .17];
  for (const x of [-8, 8]) {
    addFrustum(b, j, x, 0, 0, 1.6, 1.3, 15, 10, log, { style: 4 });
    addFrustum(b, j, x, 15, 0, 1.8, .2, 2.5, 10, log, { style: 4 });
    addFrustum(b, j, x, 12.5, -1.8, .4, .55, 1.2, 8, [.2, .16, .1], { style: 3, emit: .8 });
    addLight(b, at(j, x, 14.2, -1.8), [1, .55, .2], 1.6);
  }
  block(b, j, -10, 10, 11.5, 13.2, -.9, .9, log, { style: 4 });
  block(b, j, -4.5, 4.5, 12.5, 16.5, -1.1, -.9, [.86, .20, .08], { style: 3, emit: .7 });
  block(b, j, -3.2, 3.2, 13.2, 15.8, -1.25, -1.1, [.98, .78, .12], { style: 3, emit: .9 });
  const v = frame(P.discovery.x, P.discovery.z, ground(P.discovery.x, P.discovery.z) - .3, -.2);
  block(b, v, -14, 14, 0, 9, -9, 9, [.82, .76, .62], { style: 4, emit: .4, topRgb: [.42, .38, .32] });
  block(b, v, -6, 6, 9, 15, -6, 6, [.80, .74, .60], { style: 4, emit: .3 });
  gable(b, v, -6, 6, -6, 6, 15, 4.5, [.36, .26, .18], [.80, .74, .60], .6);
  block(b, v, -12, 12, 1, 7.5, -9.2, -9, [.30, .34, .32], { glass: .6, style: 2, emit: .9 });
}

/** Amity Village's harbour: the trophy shark hanging from its gantry above the quay. */
function amity(b: LandmarkBuilder, ground: GroundFn) {
  const s = frame(P.shark.x, P.shark.z, ground(P.shark.x, P.shark.z) - .2, .8);
  const timber: RGB = [.40, .32, .24];
  for (const x of [-3.5, 3.5]) addStrut(b, at(s, x, 0, 0), at(s, x * .3, 9, 0), .25, .2, 6, timber);
  addStrut(b, at(s, -1.2, 9, 0), at(s, 1.2, 9, 0), .25, .25, 6, timber);
  addStrut(b, at(s, 0, 9, 0), at(s, 0, 7.2, 0), .04, .04, 4, [.2, .2, .2]);
  // The shark, head down: a tapering body with fins.
  const grey: RGB = [.46, .50, .54];
  addFrustum(b, s, 0, 1.2, 0, .45, 1.1, 2.2, 10, grey, { style: 4 });
  addFrustum(b, s, 0, 3.4, 0, 1.1, .5, 3.4, 10, grey, { style: 4 });
  addFrustum(b, s, 0, 6.8, 0, .5, .2, .5, 8, grey, { style: 4 });
  block(b, s, -.08, .08, 4, 5.6, -1.6, 0, grey, { style: 4 });
  block(b, s, -1.6, 1.6, 3.6, 4, -.08, .08, grey, { style: 4 });
  addLight(b, at(s, 0, 10, 0), WARM, 1.2);
}
