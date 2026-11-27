import * as THREE from 'three';
import { addLight, pushTri, type GroundFn, type LandmarkBuilder, type LocalSite, type RGB, type Vec3 } from './landmark-builder';
import type { Part } from './landmarks';
import { OUTLINES } from './landmark-outlines';
import { at, block, centroid, dominantAngle, frame, inRing, inset, localBounds, ringOf, type XZ } from './landmark-kit';
import { water } from './landmark-streets';
import { roof } from './temple-models';

/**
 * Heijo Palace site, Nara: the First Imperial Audience Hall (Daigokuden, 2010) on its stone
 * terrace, the Daigokumon gate (2022) with the East Tower and the West Tower works, Suzakumon
 * (1998) with the earthen walls either side, the Kentoshi ship replica, and the East Palace
 * garden ponds. Footprints from OSM; elevations are approximations of the published
 * reconstructions: vermilion posts, white walls, green lattice windows and grey tile.
 */
type Color = Part['color'];
const VERMILION: Color = [.50, .095, .035], WHITE: Color = [.62, .60, .55], LATTICE: Color = [.045, .16, .10];
const TILE: Color = [.034, .038, .044], GOLD: Color = [.67, .45, .09], STONE: Color = [.30, .29, .26], DARK: Color = [.03, .025, .02];
const box = (parts: Part[], w: number, h: number, d: number, x: number, y: number, z: number, color: Color, glow = .25) => {
  const geo = new THREE.BoxGeometry(w, h, d); geo.translate(x, y, z); parts.push({ geo, color, glow });
};

const outline = (key: keyof typeof OUTLINES) => {
  const ring = ringOf(OUTLINES[key]);
  const c = centroid(ring);
  // Fold the long-edge direction so local x runs east–west and +z south.
  let angle = dominantAngle(ring);
  if (angle > Math.PI / 4) angle -= Math.PI / 2;
  return { ring, c, angle };
};
const HALL = outline('daigokuden'), GATE = outline('daigokumon'), EAST = outline('toro'), WEST = outline('seiro');
const COURT = outline('daigokudenIn'), SUZAKU = outline('suzakumon'), SHIP = outline('kentoshiShip');
const PONDS = (['toinPond1', 'toinPond2', 'toinPond3', 'toinPond4'] as const).map(k => ringOf(OUTLINES[k]));

const BUILT = [HALL, GATE, EAST, WEST, SUZAKU, SHIP].map(o => inset(o.ring, -4));
// The earthen walls run 120 m either side of Suzakumon.
const WALL_HALF = 120;

/** Generic survey buildings give way to the reconstructions and the walls. */
export function inHeijoModel(x: number, z: number) {
  if (Math.abs(x - 3400) > 1200 || Math.abs(z - 34800) > 800) return false;
  if (BUILT.some(r => inRing(r, x, z))) return true;
  const d = toLocal2(SUZAKU, x, z);
  return Math.abs(d.x) < WALL_HALF + 4 && Math.abs(d.z) < 6;
}

/** The gravel court, the garden ponds and the Suzakumon plaza stay clear of trees. */
export function inHeijoClearing(x: number, z: number) {
  if (Math.abs(x - 3400) > 1200 || Math.abs(z - 34800) > 800) return false;
  if (inHeijoModel(x, z) || inRing(COURT.ring, x, z) || PONDS.some(r => inRing(inset(r, -2), x, z))) return true;
  const d = toLocal2(SUZAKU, x, z);
  return Math.abs(d.x) < 60 && d.z > -60 && d.z < 0;
}

function toLocal2(o: { c: XZ; angle: number }, x: number, z: number) {
  const dx = x - o.c.x, dz = z - o.c.z, c = Math.cos(o.angle), s = Math.sin(o.angle);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

/** Bays of posts with white upper walls, lattice windows and central doors on all four sides. */
function body(parts: Part[], w: number, d: number, y: number, h: number, bays: number, depthBays: number, open = false) {
  for (const side of [-1, 1]) {
    for (let i = 0; i <= bays; i++) {
      const x = (i / bays - .5) * w;
      box(parts, .62, h, .62, x, y + h / 2, side * d / 2, VERMILION, .6);
      if (i === bays) continue;
      const cx = x + w / bays / 2, bw = w / bays - .62;
      const centre = Math.abs(i - (bays - 1) / 2) < 1.01;
      if (open) continue;
      // Upper white wall, then a green lattice window or vermilion double doors.
      box(parts, bw, h * .26, .3, cx, y + h * .84, side * d / 2, WHITE, .5);
      if (centre) box(parts, bw * .9, h * .68, .26, cx, y + h * .37, side * d / 2, VERMILION, .7);
      else {
        box(parts, bw, h * .22, .3, cx, y + h * .11, side * d / 2, WHITE, .4);
        box(parts, bw * .92, h * .44, .22, cx, y + h * .46, side * d / 2, LATTICE, .9);
        for (let k = 1; k < 8; k++) box(parts, .08, h * .44, .26, cx - bw * .46 + k * bw * .115, y + h * .46, side * d / 2, VERMILION, .3);
      }
    }
    for (let i = 0; i <= depthBays; i++) {
      const z = (i / depthBays - .5) * d;
      box(parts, .62, h, .62, side * w / 2, y + h / 2, z, VERMILION, .6);
      if (i < depthBays && !open) {
        const cz = z + d / depthBays / 2, bd = d / depthBays - .62;
        box(parts, .3, h * .26, bd, side * w / 2, y + h * .84, cz, WHITE, .5);
        box(parts, .22, h * .44, bd * .92, side * w / 2, y + h * .46, cz, LATTICE, .9);
        box(parts, .3, h * .22, bd, side * w / 2, y + h * .11, cz, WHITE, .4);
      }
    }
  }
  // Head beams and the bracket course carrying the eaves.
  box(parts, w + .8, .45, d + .8, 0, y + h + .2, 0, VERMILION, .5);
  box(parts, w + 2.2, .5, d + 2.2, 0, y + h + .7, 0, [.42, .40, .34], .35);
  if (!open) box(parts, w - .4, h, d - .4, 0, y + h / 2, 0, [.20, .17, .13], .2);
}

/** Irimoya: hipped eaves with a gable in the upper roof and gilded shibi on the ridge ends. */
function irimoya(parts: Part[], w: number, d: number, y: number, h: number, shibi = 0) {
  roof(parts, w, d, h, y, 0, TILE);
  const gy = y + h * .62;
  for (const side of [-1, 1]) {
    const geo = new THREE.BufferGeometry();
    const x = side * w * .27, half = d * .2;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([x, gy, -half, x, gy, half, x, y + h, 0], 3));
    geo.computeVertexNormals();
    parts.push({ geo, color: WHITE, glow: .4 });
    if (shibi) {
      box(parts, shibi * .5, shibi, shibi * .35, side * w * .15, y + h + shibi * .5, 0, GOLD, .9);
      box(parts, shibi * .3, shibi * .45, shibi * .3, side * (w * .15 - shibi * .3), y + h + shibi * .85, 0, GOLD, .9);
    }
  }
  box(parts, w * .32, .55, .7, 0, y + h + .1, 0, TILE, .3);
}

function terrace(parts: Part[], w: number, d: number, h: number, stairs: number[]) {
  box(parts, w, h, d, 0, h / 2, 0, STONE, .35);
  box(parts, w + .4, .3, d + .4, 0, h - .15, 0, [.36, .35, .32], .3);
  for (const x of stairs) for (let i = 0; i < 6; i++) {
    box(parts, 5, h * (6 - i) / 6, 1, x, h * (6 - i) / 12, d / 2 + .5 + i, STONE, .3);
  }
}

/** Two-storey gate: an open lower storey with doors, a skirt roof, a balcony and the main roof. */
function gate(parts: Part[], w: number, d: number, height: number) {
  terrace(parts, w + 3, d + 3, 1.3, [0]);
  const lower = height * .3;
  body(parts, w, d, 1.3, lower, 5, 2, true);
  for (const x of [-w * .2, 0, w * .2]) box(parts, w / 5 - .8, lower * .85, .25, x, 1.3 + lower * .42, 0, VERMILION, .7);
  for (const side of [-1, 1]) box(parts, w * .2 - .6, lower * .8, .3, side * w * .4, 1.3 + lower * .4, 0, WHITE, .5);
  const skirtY = 1.3 + lower + 1;
  roof(parts, w * 1.42, d * 1.62, height * .1, skirtY, 0, TILE);
  const upperY = skirtY + height * .1;
  box(parts, w * 1.04, .35, d * 1.08, 0, upperY + .9, 0, VERMILION, .5);
  for (let i = 0; i <= 10; i++) box(parts, .14, .9, .14, (i / 10 - .5) * w * 1.04, upperY + .45, d * .54, VERMILION, .4);
  body(parts, w * .92, d * .9, upperY, height * .24, 5, 2);
  irimoya(parts, w * 1.5, d * 1.7, upperY + height * .24 + 1.2, height - (upperY + height * .24 + 1.2), 1.9);
}

/** Convert Kyoto-style parts (linear colours, local metres) into the landmark builder. */
function addParts(b: LandmarkBuilder, parts: Part[], f: LocalSite, style = 0) {
  const a = new THREE.Vector3(), c = new THREE.Vector3(), e = new THREE.Vector3();
  for (const { geo, color, glow } of parts) {
    const rgb = color.map(v => Math.pow(v, 1 / 2.2)) as RGB;
    const roofTone = color === TILE;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia); c.fromBufferAttribute(pos, ib); e.fromBufferAttribute(pos, ic);
      const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(e, a)).normalize();
      if (!Number.isFinite(n.x)) continue;
      const world: Vec3 = [n.x * f.c - n.z * f.s, n.y, n.x * f.s + n.z * f.c];
      pushTri(b, at(f, a.x, a.y, a.z), at(f, c.x, c.y, c.z), at(f, e.x, e.y, e.z), world, rgb,
        (glow ?? .2) * .35, 0, roofTone ? 4 : style);
    }
    geo.dispose();
  }
}

function site(o: { c: XZ; angle: number }, ground: GroundFn, lift = 0): LocalSite {
  return frame(o.c.x, o.c.z, ground(o.c.x, o.c.z) - .4 + lift, o.angle);
}

export function buildHeijoPalace(b: LandmarkBuilder, ground: GroundFn) {
  // Daigokuden: a double-roofed hall of 9 × 4 bays on a stone terrace.
  {
    const f = site(HALL, ground), box2 = localBounds(f, HALL.ring);
    const W = box2.x1 - box2.x0, D = box2.z1 - box2.z0, parts: Part[] = [];
    terrace(parts, W, D, 2.4, [-W * .25, 0, W * .25]);
    const w = W * .78, d = D * .62, h = 7.4;
    body(parts, w, d, 2.4, h, 9, 4);
    roof(parts, w * 1.28, d * 1.5, 2.6, 2.4 + h + .9, 0, TILE);
    body(parts, w * .72, d * .62, 2.4 + h + 3.4, 4.2, 7, 2);
    irimoya(parts, w * 1.22, d * 1.36, 2.4 + h + 7.9, 9.6, 2.6);
    addParts(b, parts, f);
    for (const x of [-W * .45, W * .45]) addLight(b, at(f, x, 1, -D * .55), [1, .78, .5], 2.2);
  }
  // Daigokumon with its corridor wings and the East Tower; the West Tower is still under a works shed.
  {
    const f = site(GATE, ground), g = localBounds(f, GATE.ring), parts: Part[] = [];
    gate(parts, (g.x1 - g.x0) * .8, (g.z1 - g.z0) * .55, 22);
    addParts(b, parts, f);
    const court = site(COURT, ground), cb = localBounds(court, COURT.ring);
    const southZ = cb.z1 - 4;
    // Roofed south cloister from the gate to each tower.
    for (const side of [-1, 1]) {
      const x0 = side * 9, x1 = side * 34, cl: Part[] = [];
      const len = Math.abs(x1 - x0), mid = (x0 + x1) / 2;
      for (let i = 0; i <= 8; i++) {
        const x = mid - len / 2 + i * len / 8;
        for (const z of [-2.2, 2.2]) box(cl, .45, 4.2, .45, x, 2.1, z, VERMILION, .5);
      }
      box(cl, len, 3.2, .35, mid, 2.6, 0, WHITE, .4);
      roof(cl, len + 1, 7.4, 2.2, 4.3, 0, TILE);
      const south = at(court, 0, 0, southZ);
      addParts(b, cl, frame(south[0], south[2], f.oy, COURT.angle));
    }
    const e = site(EAST, ground), eb = localBounds(e, EAST.ring), tower: Part[] = [];
    const tw = Math.min(18, (eb.x1 - eb.x0) * .6), td = Math.min(11, (eb.z1 - eb.z0) * .6);
    terrace(tower, tw + 3, td + 3, 1.2, []);
    body(tower, tw, td, 1.2, 5.5, 5, 3);
    roof(tower, tw * 1.4, td * 1.6, 1.8, 8, 0, TILE);
    body(tower, tw * .86, td * .8, 9.8, 4.2, 5, 3);
    irimoya(tower, tw * 1.45, td * 1.7, 14.5, 6.2, 1.4);
    addParts(b, tower, e);
    const w = site(WEST, ground), wb = localBounds(w, WEST.ring);
    block(b, w, wb.x0 + 3, wb.x1 - 3, 0, 24, wb.z0 + 3, wb.z1 - 3, [.74, .75, .74], { style: 0, topRgb: [.62, .64, .66] });
  }
  // Suzakumon and the earthen walls with their tiled copings.
  {
    const f = site(SUZAKU, ground), s = localBounds(f, SUZAKU.ring), parts: Part[] = [];
    gate(parts, (s.x1 - s.x0) * .74, (s.z1 - s.z0) * .55, 22);
    for (const side of [-1, 1]) {
      const x = side * (WALL_HALF / 2 + 14);
      box(parts, WALL_HALF - 12, 5.2, 2.6, x, 2.6, 0, [.44, .37, .26], .3);
      roof(parts, WALL_HALF - 10, 4, 1.1, 5.2, 0, TILE);
    }
    addParts(b, parts, f);
    for (const x of [-9, 9]) addLight(b, at(f, x, 1, -8), [1, .8, .55], 2);
  }
  // Kentoshi ship: a flat-bottomed hull, deckhouse, two masts with matting sails.
  {
    const f = site(SHIP, ground, 1.2), parts: Part[] = [];
    const L = 26, B = 8.6;
    for (let i = 0; i < 12; i++) {
      const t = (i + .5) / 12, beam = B * Math.sqrt(Math.max(.08, 1 - Math.pow(2 * t - 1, 6)));
      box(parts, L / 12 + .02, 2.6 - .8 * Math.abs(2 * t - 1), beam, -L / 2 + t * L, 1.3, 0, [.26, .15, .08], .3);
    }
    box(parts, L * .96, .3, B * .9, 0, 2.7, 0, [.42, .28, .16], .3);
    box(parts, L * .98, .5, .25, 0, 3.1, B * .46, VERMILION, .5);
    box(parts, L * .98, .5, .25, 0, 3.1, -B * .46, VERMILION, .5);
    box(parts, 7, 2.6, 5.4, -3, 4.1, 0, VERMILION, .6);
    roof(parts, 8.6, 6.6, 1.4, 5.4, 0, [.28, .2, .14]);
    box(parts, 4.5, 2, 4, L * .36, 3.9, 0, VERMILION, .6);
    for (const [x, h, sw] of [[3.5, 15, 7.5], [-8.5, 11, 5.5]] as const) {
      const mast = new THREE.CylinderGeometry(.18, .28, h, 8); mast.translate(x, 2.8 + h / 2, 0);
      parts.push({ geo: mast, color: [.30, .20, .12], glow: .3 });
      box(parts, .18, h * .6, sw, x + .3, 2.8 + h * .58, 0, [.52, .40, .24], .3);
    }
    addParts(b, parts, f);
  }
  // East Palace garden: the ponds and a vermilion bridge.
  for (const pond of PONDS) {
    const c = centroid(pond);
    water(b, pond, ground(c.x, c.z) - .25, [.06, .22, .24]);
  }
  {
    const p = centroid(PONDS[0]), f = frame(p.x, p.z, ground(p.x, p.z) - .2, 1.1), parts: Part[] = [];
    box(parts, 10, .3, 2.2, 0, .9, 0, VERMILION, .5);
    for (const z of [-1, 1]) for (let i = 0; i <= 5; i++) box(parts, .12, .8, .12, -5 + i * 2, 1.45, z, VERMILION, .4);
    addParts(b, parts, f);
  }
}
