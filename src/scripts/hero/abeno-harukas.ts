import { addLight, type GroundFn, type LandmarkBuilder, type RGB } from './landmark-builder';
import { OUTLINES } from './landmark-outlines';
import { at, block, centroid, frame, localBounds, prism, ringOf } from './landmark-kit';

/**
 * Abeno Harukas (300 m, 2014). The tower stacks three blocks — department store, offices and
 * hotel with the Harukas 300 observatory — aligned on their south-east corner and stepping back
 * to the north-west, with three-storey glazed voids at each step. Massing follows the OSM tower
 * outline; storey heights and setbacks are approximations from published elevations.
 */
const GLASS: RGB = [.30, .40, .50];
const FIN: RGB = [.70, .72, .73];
const FRAME: RGB = [.72, .73, .72];
const VOID: RGB = [.18, .23, .27];
const ROOF: RGB = [.40, .41, .40];
const GREEN: RGB = [.28, .40, .22];

export function buildAbenoHarukas(b: LandmarkBuilder, ground: GroundFn) {
  const towerRing = ringOf(OUTLINES.harukasTower);
  const c = centroid(towerRing);
  // The tower is set square to the Abenosuji grid, about 16° from east.
  const f = frame(c.x, c.z, ground(c.x, c.z), .279);
  const box = localBounds(f, towerRing);
  const x1 = box.x1 - 1, z1 = box.z1 - 1, x0 = box.x0 + 2, z0 = box.z0 + 2;
  // Blocks share the south-east corner (x1, z1).
  const blocks = [
    { x0, z0, y0: 0, y1: 61, glow: .55 },
    { x0: x0 + 17, z0: z0 + 15, y0: 61, y1: 157, glow: .75 },
    { x0: x0 + 34, z0: z0 + 31, y0: 157, y1: 288, glow: .9 },
  ];
  for (const [i, k] of blocks.entries()) {
    // Curtain wall, recessed behind the fins.
    const wall0 = i ? k.y0 + 12 : k.y0;
    block(b, f, k.x0 + .5, x1 - .5, wall0, k.y1, k.z0 + .5, z1 - .5, GLASS,
      { glass: .85, style: 1, emit: k.glow, topRgb: ROOF, topStyle: 0 });
    fins(b, f, k.x0, x1, k.z0, z1, k.y0 + (i ? 12 : 6), k.y1, 3.6);
    // Spandrel bands at every plant floor.
    for (const y of i === 0 ? [k.y0 + 6, 31, k.y1 - 1.5] : [k.y0 + 12, k.y1 - 1.5]) {
      frameBand(b, f, k.x0, x1, k.z0, z1, y, 1.5);
    }
    if (i > 0) {
      // Three-storey voids at the setback: the floors above appear to float over dark glass.
      block(b, f, k.x0 + 3, x1 - 3, k.y0, k.y0 + 12, k.z0 + 3, z1 - 3, VOID, { glass: .5, style: 2, emit: .55 });
      // Sky gardens on the terrace left by the block below.
      const below = blocks[i - 1];
      block(b, f, below.x0 + 1.5, x1 - 1.5, k.y0, k.y0 + .8, below.z0 + 1.5, k.z0 - .2, GREEN, { style: 4 });
      block(b, f, below.x0 + 1.5, k.x0 - .2, k.y0, k.y0 + .8, k.z0 - .2, z1 - 1.5, GREEN, { style: 4 });
      parapet(b, f, below.x0, x1, below.z0, z1, k.y0 + .8, 1.4);
    }
  }
  // Harukas 300: three glazed observatory floors around an open-air courtyard, under a deep roof frame.
  const top = blocks[2];
  block(b, f, top.x0 + 1, x1 - 1, 288, 297, top.z0 + 1, z1 - 1, [.62, .72, .80], { glass: .9, style: 2, emit: 1.05 });
  block(b, f, top.x0, x1, 297, 300, top.z0, z1, FRAME, { topRgb: ROOF });
  // The courtyard opens to the sky in the middle of the roof.
  const cx = (top.x0 + x1) / 2, cz = (top.z0 + z1) / 2;
  block(b, f, cx - 9, cx + 9, 299.2, 300.2, cz - 7, cz + 7, [.10, .13, .16], { glass: .6, style: 2, emit: .6, topRgb: [.12, .15, .18] });
  // Rooftop plant screens and the helipad.
  block(b, f, x1 - 12, x1 - 3, 300, 303.5, top.z0 + 4, top.z0 + 12, FRAME);
  block(b, f, top.x0 + 4, top.x0 + 13, 300, 303.5, z1 - 12, z1 - 3, FRAME);
  // Aviation lights at every outer corner of each block's roof.
  for (const k of blocks) {
    for (const [x, z] of [[k.x0, k.z0], [x1, k.z0], [x1, z1], [k.x0, z1]]) {
      addLight(b, at(f, x, k === top ? 303.8 : k.y1 + .5, z), [1, .12, .06], 1.6, 1 + x * .01 + z * .013);
    }
  }
  // Street-level entrance canopies along the north face.
  block(b, f, x0 + 6, x1 - 6, 7, 7.6, z0 - 4, z0, FRAME, { emit: .3 });

  // Kintetsu Wing building (OSM ウイング館), nine floors of stone and glass.
  const wing = ringOf(OUTLINES.harukasWing);
  const wy = ground(centroid(wing).x, centroid(wing).z);
  prism(b, wing, wy, wy + 44, [.70, .67, .61], { topRgb: ROOF, style: 0, emit: .3 });
  for (let y = 6; y < 44; y += 4.6) prism(b, wing, wy + y, wy + y + 1.6, [.32, .38, .44], { glass: .7, style: 1, emit: .55, top: false });
}

/** Vertical aluminium fins proud of the glass on all four faces. */
function fins(b: LandmarkBuilder, f: ReturnType<typeof frame>, x0: number, x1: number, z0: number, z1: number,
  y0: number, y1: number, pitch: number) {
  const depth = .55, width = .2;
  for (let x = x0 + pitch / 2; x < x1; x += pitch) {
    block(b, f, x - width / 2, x + width / 2, y0, y1, z0 - depth + .5, z0 + .5, FIN, { style: 0 });
    block(b, f, x - width / 2, x + width / 2, y0, y1, z1 - .5, z1 + depth - .5, FIN, { style: 0 });
  }
  for (let z = z0 + pitch / 2; z < z1; z += pitch) {
    block(b, f, x0 - depth + .5, x0 + .5, y0, y1, z - width / 2, z + width / 2, FIN, { style: 0 });
    block(b, f, x1 - .5, x1 + depth - .5, y0, y1, z - width / 2, z + width / 2, FIN, { style: 0 });
  }
}

/** A solid horizontal band around a block's perimeter. */
function frameBand(b: LandmarkBuilder, f: ReturnType<typeof frame>, x0: number, x1: number, z0: number, z1: number, y: number, h: number) {
  const t = .9;
  block(b, f, x0 - .3, x1 + .3, y, y + h, z0 - .3, z0 - .3 + t, FRAME, { top: false });
  block(b, f, x0 - .3, x1 + .3, y, y + h, z1 + .3 - t, z1 + .3, FRAME, { top: false });
  block(b, f, x0 - .3, x0 - .3 + t, y, y + h, z0, z1, FRAME, { top: false });
  block(b, f, x1 + .3 - t, x1 + .3, y, y + h, z0, z1, FRAME, { top: false });
}

/** Glass balustrade along the exposed terrace edges (north and west of the step). */
function parapet(b: LandmarkBuilder, f: ReturnType<typeof frame>, x0: number, x1: number, z0: number, z1: number, y: number, h: number) {
  block(b, f, x0, x1, y, y + h, z0, z0 + .25, [.70, .78, .82], { glass: .7, style: 0 });
  block(b, f, x0, x0 + .25, y, y + h, z0, z1, [.70, .78, .82], { glass: .7, style: 0 });
}
