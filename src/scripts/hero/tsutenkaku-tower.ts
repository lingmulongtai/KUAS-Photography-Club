import {
  addDome, addFrustum, addLight, addStrut, type GroundFn, type LandmarkBuilder, type RGB,
} from './landmark-builder';
import { OUTLINES } from './landmark-outlines';
import { at, block, centroid, dominantAngle, frame, localBounds, prism, ringOf } from './landmark-kit';

/**
 * Tsutenkaku (1956, 108 m): a gateway base on four legs over the Shinsekai crossing, a tapering
 * steel lattice with the HITACHI sign, a three-storey observatory at 84–94.5 m with the open-air
 * Tenbo Paradise deck and its projecting "TIP" balcony, and the weather-forecast neon crown.
 * Outline from OSM; member sizes and levels approximated from published photographs.
 */
const STEEL: RGB = [.80, .81, .80];
const BASE: RGB = [.84, .83, .79];
const DECK: RGB = [.90, .90, .88];
const BAND: RGB = [.25, .42, .62];
const NEON: RGB = [.95, .95, 1];

export function buildTsutenkaku(b: LandmarkBuilder, ground: GroundFn) {
  const ring = ringOf(OUTLINES.tsutenkaku);
  const c = centroid(ring);
  const f = frame(c.x, c.z, ground(c.x, c.z), dominantAngle(ring));
  const bounds = localBounds(f, ring);
  const half = Math.min(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 - .5;

  // Gateway base: four battered legs, arched openings on every side and a deep frieze.
  const leg = 3.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (half - leg / 2), z = sz * (half - leg / 2);
    block(b, f, x - leg / 2, x + leg / 2, 0, 15, z - leg / 2, z + leg / 2, BASE, { style: 0, emit: .25 });
  }
  // Arched openings on all four sides: a semicircular soffit built from stepped voussoirs.
  const span = half * 2 - leg * 2, steps = 16;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const u0 = -span / 2 + span * t0, u1 = -span / 2 + span * t1;
    const y = 8.5 + 3.8 * Math.min(Math.sin(Math.PI * t0), Math.sin(Math.PI * t1));
    for (const s of [-1, 1]) {
      const near = s < 0 ? -half : half - leg;
      block(b, f, u0, u1, y, 15, near, near + leg, BASE, { style: 0, top: false });
      block(b, f, near, near + leg, y, 15, u0, u1, BASE, { style: 0, top: false });
    }
  }
  block(b, f, -half, half, 15, 21, -half, half, BASE, { topRgb: [.5, .5, .48], emit: .35 });
  // Gilded name band and the painted soffit glow under the arches.
  block(b, f, -half - .25, half + .25, 16.2, 17.8, -half - .25, half + .25, [.82, .66, .30], { style: 3, emit: .7, top: false });
  block(b, f, -half + leg, half - leg, 11.5, 12, -half + leg, half - leg, [.9, .78, .55], { style: 3, emit: .5 });

  // Lattice shaft from the base to the observatory, tapering from 9 m to 6 m half-width.
  const y0 = 21, y1 = 84, h0 = 8.6, h1 = 5.6, panels = 9;
  const hw = (y: number) => h0 + (h1 - h0) * (y - y0) / (y1 - y0);
  const corner = (sx: number, sz: number, y: number) => at(f, sx * hw(y), y, sz * hw(y));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addStrut(b, corner(sx, sz, y0), corner(sx, sz, y1), .55, .42, 6, STEEL);
  for (let p = 0; p <= panels; p++) {
    const y = y0 + (y1 - y0) * p / panels, yn = y0 + (y1 - y0) * (p + 1) / panels;
    const faces: [number, number, number, number][] = [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]];
    for (const [ax, az, cx, cz] of faces) {
      addStrut(b, corner(ax, az, y), corner(cx, cz, y), .26, .26, 4, STEEL);
      if (p < panels) {
        addStrut(b, corner(ax, az, y), corner(cx, cz, yn), .17, .17, 4, STEEL);
        addStrut(b, corner(cx, cz, y), corner(ax, az, yn), .17, .17, 4, STEEL);
      }
    }
  }
  // Enclosed elevator core inside the lattice.
  block(b, f, -2.4, 2.4, y0, y1, -2.4, 2.4, [.70, .70, .68], { style: 0, emit: .2 });
  // HITACHI sign panels on two opposite faces, lit at night.
  for (const s of [-1, 1]) {
    // One letter per panel, stacked tight on a continuous backing board.
    const w = hw(52) - .2;
    block(b, f, s > 0 ? w : -w - .3, s > 0 ? w + .3 : -w, 30, 74, -3.3, 3.3, [.70, .72, .74], { style: 0 });
    for (let k = 0; k < 7; k++) {
      const y = 31 + k * 6.2;
      block(b, f, s > 0 ? w + .3 : -w - .6, s > 0 ? w + .6 : -w - .3, y, y + 5.4, -3.0, 3.0, [.92, .94, .98], { style: 3, emit: 1.0 });
    }
  }

  // Observatory: chamfered three-storey body with a blue window band and the clock.
  const ox = 8.8;
  octagon(b, f, ox, 84, 87, DECK, { emit: .3 });
  octagon(b, f, ox + .2, 87, 91, [.52, .62, .70], { glass: .85, style: 2, emit: .9 });
  octagon(b, f, ox, 91, 93, BAND, { emit: .35 });
  octagon(b, f, ox + .6, 93, 94.5, DECK, { emit: .2 });
  // The clock faces below the observatory on the two sign-free sides.
  for (const s of [-1, 1]) {
    const w = hw(76) + .3;
    block(b, f, -3.1, 3.1, 73.5, 79.7, s > 0 ? w : -w - .35, s > 0 ? w + .35 : -w, [.97, .96, .90], { style: 3, emit: .8 });
    block(b, f, -.15, .15, 76.6, 79.2, s > 0 ? w + .35 : -w - .45, s > 0 ? w + .45 : -w - .35, [.1, .1, .1]);
  }
  // Tenbo Paradise open-air deck with its railing and the TIP THE TSUTENKAKU balcony.
  rail(b, f, ox + .6, 94.5, 1.2);
  block(b, f, ox, ox + 5.5, 94.2, 94.6, -2, 2, [.75, .85, .9], { glass: .7, style: 2, emit: .5 });
  block(b, f, ox + 5.3, ox + 5.5, 94.6, 95.8, -2, 2, [.75, .85, .9], { glass: .7 });

  // Crown: plant room, the weather neon drum and the spire.
  block(b, f, -4.6, 4.6, 94.5, 98.5, -4.6, 4.6, DECK, { emit: .25 });
  const crown = frame(f.ox, f.oz, f.oy, Math.atan2(f.s, f.c));
  addFrustum(b, crown, 0, 98.5, 0, 3.4, 3.4, 4.5, 24, NEON, { style: 3, emit: 1.3, topRgb: STEEL });
  addFrustum(b, crown, 0, 103, 0, 2.1, 1.2, 1.6, 16, STEEL);
  addDome(b, crown, 0, 104.6, 0, 1.2, .9, 1.2, 4, 12, STEEL, { style: 0 });
  addStrut(b, at(f, 0, 105, 0), at(f, 0, 108, 0), .18, .06, 5, STEEL);
  addLight(b, at(f, 0, 108.2, 0), [1, .1, .05], 1.8, 1.4);
  for (const [x, z] of [[-ox, 0], [ox, 0], [0, -ox], [0, ox]]) addLight(b, at(f, x, 95.2, z), [1, .12, .06], 1.2, 1.2);
  // Shaft floodlights: warm points up the corner posts.
  for (let y = y0 + 4; y < y1; y += 9) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addLight(b, corner(sx * 1.04, sz * 1.04, y), [1, .86, .6], .8);
  }
}

/** A square body with 45° chamfered corners. */
function octagon(b: LandmarkBuilder, f: ReturnType<typeof frame>, r: number, y0: number, y1: number, rgb: RGB,
  opts: { emit?: number; glass?: number; style?: number } = {}) {
  const k = r * .42;
  const pts = [[-r + k, -r], [r - k, -r], [r, -r + k], [r, r - k], [r - k, r], [-r + k, r], [-r, r - k], [-r, -r + k]];
  const ring = pts.map(([x, z]) => ({ x: f.ox + x * f.c - z * f.s, z: f.oz + x * f.s + z * f.c }));
  prism(b, ring, f.oy + y0, f.oy + y1, rgb, opts);
}

function rail(b: LandmarkBuilder, f: ReturnType<typeof frame>, r: number, y: number, h: number) {
  const t = .12;
  block(b, f, -r, r, y, y + h, -r, -r + t, [.85, .88, .9], { glass: .6 });
  block(b, f, -r, r, y, y + h, r - t, r, [.85, .88, .9], { glass: .6 });
  block(b, f, -r, -r + t, y, y + h, -r, r, [.85, .88, .9], { glass: .6 });
  block(b, f, r - t, r, y, y + h, -r, r, [.85, .88, .9], { glass: .6 });
}

