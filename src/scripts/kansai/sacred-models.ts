import * as THREE from 'three';
import {ENV_GLSL,SHADOW_GLSL,type Env} from '../hero/env.ts';
import {HOME_BOUNDARY,type boundaryUniforms} from '../hero/regional-boundary.ts';

/** Dedicated reusable architectural models for Japanese shrines, temples, pagodas, gates and torii. */
export const SACRED = {
  temple: 0,
  shrine: 1,
  shrineVermilion: 2,
  pagoda: 3,
  gate: 4,
  torii: 5,
  toriiStone: 6,
} as const;
export type SacredKind = (typeof SACRED)[keyof typeof SACRED];

export interface SacredBuilding {
  /** Local metres in Kyoto tangent plane (+x east, +z south). */
  x: number;
  z: number;
  /** Long axis width and short axis depth in metres. */
  w: number;
  d: number;
  /** Orientation of the w axis in the x/z plane, radians (same convention as BoxBuilding). */
  angle: number;
  /** Total height from ground to ridge/spire in metres. */
  h: number;
  kind: SacredKind;
  /** Optional variant seed 0..1 for subtle natural roof/timber variation. */
  seed?: number;
}

type Color = readonly [number, number, number];
const WOOD_DARK: Color = [0.11, 0.06, 0.028];
const WOOD_HINOKI: Color = [0.23, 0.145, 0.075];
const PLASTER: Color = [0.56, 0.53, 0.45];
const PLASTER_WARM: Color = [0.47, 0.43, 0.35];
const STONE: Color = [0.24, 0.23, 0.2];
const STONE_PALE: Color = [0.36, 0.35, 0.32];
const SHUTTER: Color = [0.032, 0.026, 0.02];
const VERMILION: Color = [0.56, 0.072, 0.026];
const KAWARA_DARK: Color = [0.048, 0.052, 0.056];
const KAWARA_SLATE: Color = [0.065, 0.068, 0.072];
const BARK_ROOF: Color = [0.088, 0.065, 0.046];
const COPPER_GREEN: Color = [0.065, 0.145, 0.105];
const BRONZE: Color = [0.075, 0.068, 0.045];
const GOLD: Color = [0.58, 0.4, 0.09];

/** Skirt depth below the centre ground sample so hillside shrines and temples never float. */
const SKIRT = 3.2;

class SacredBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  glows: number[] = [];

  private ox = 0;
  private oy = 0;
  private oz = 0;
  private cos = 1;
  private sin = 0;

  setFrame(x: number, y: number, z: number, angle: number) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
  }

  private world(lx: number, ly: number, lz: number): [number, number, number] {
    return [
      this.ox + this.cos * lx - this.sin * lz,
      this.oy + ly,
      this.oz + this.sin * lx + this.cos * lz,
    ];
  }

  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number], color: Color, glow = 0.16) {
    const wa = this.world(a[0], a[1], a[2]);
    const wb = this.world(b[0], b[1], b[2]);
    const wc = this.world(c[0], c[1], c[2]);
    const ux = wb[0] - wa[0], uy = wb[1] - wa[1], uz = wb[2] - wa[2];
    const vx = wc[0] - wa[0], vy = wc[1] - wa[1], vz = wc[2] - wa[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return;
    const inv = 1 / len;
    this.positions.push(wa[0], wa[1], wa[2], wb[0], wb[1], wb[2], wc[0], wc[1], wc[2]);
    for (let i = 0; i < 3; i++) {
      this.normals.push(nx * inv, ny * inv, nz * inv);
      this.colors.push(color[0], color[1], color[2]);
      this.glows.push(glow);
    }
  }

  quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], color: Color, glow = 0.16) {
    this.tri(a, b, c, color, glow);
    this.tri(a, c, d, color, glow);
  }

  box(w: number, h: number, d: number, cx: number, cy: number, cz: number, color: Color, glow = 0.16) {
    const x0 = cx - w * 0.5, x1 = cx + w * 0.5;
    const y0 = cy - h * 0.5, y1 = cy + h * 0.5;
    const z0 = cz - d * 0.5, z1 = cz + d * 0.5;
    // +Z front, -Z back, +X right, -X left, +Y top, -Y bottom
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, glow);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, glow);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, glow);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, glow);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color, glow);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, glow);
  }

  /** Curved Japanese sweeping roof (irimoya/yosemune/pyramidal) with upturned eaves and ridge beam. */
  curvedRoof(w: number, d: number, h: number, y: number, color: Color, pyramidal = false, glow = 0.18) {
    const outline: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    const profile: [number, number][] = [[1, 0], [0.92, 0.045], [0.78, 0.19], [0.58, 0.46], [0.36, 0.78], [0.22, 1]];
    const rings: [number, number, number][][] = [];
    const cornerTurn = Math.min(0.45, Math.max(0.12, h * 0.085));
    for (const [scale, t] of profile) {
      const ring: [number, number, number][] = [];
      for (const [ox, oz] of outline) {
        const turn = ox !== 0 && oz !== 0 ? cornerTurn * Math.max(0, (scale - 0.78) / 0.22) : 0;
        const sx = t === 1 && pyramidal ? 0.02 : scale;
        const sz = t === 1 ? 0.02 : scale;
        ring.push([ox * w * 0.5 * sx, y + h * t + turn, oz * d * 0.5 * sz]);
      }
      rings.push(ring);
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        this.tri(rings[r][i], rings[r + 1][i], rings[r][next], color, glow);
        this.tri(rings[r][next], rings[r + 1][i], rings[r + 1][next], color, glow);
      }
    }
    const top = rings[rings.length - 1];
    const apex: [number, number, number] = [0, y + h, 0];
    for (let i = 0; i < 8; i++) {
      const next = (i + 1) % 8;
      this.tri(apex, top[next], top[i], color, glow);
    }
    // Overhanging eave fascia underside + main ridge beam (mune) + end caps (onigawara)
    this.box(w * 0.98, Math.max(0.16, h * 0.05), d * 0.98, 0, y - Math.max(0.08, h * 0.025), 0, color, glow);
    const ridgeLen = pyramidal ? Math.max(0.35, w * 0.06) : Math.max(0.5, w * 0.36);
    const ridgeH = Math.min(0.48, Math.max(0.22, h * 0.1));
    this.box(ridgeLen, ridgeH, Math.min(0.45, Math.max(0.24, d * 0.04)), 0, y + h + ridgeH * 0.35, 0, color, glow + 0.08);
    if (!pyramidal) {
      const cap = Math.min(0.55, Math.max(0.26, ridgeH * 1.15));
      for (const side of [-1, 1]) {
        this.box(cap * 0.55, cap * 1.3, cap * 0.85, side * ridgeLen * 0.5, y + h + cap * 0.55, 0, color, glow + 0.12);
      }
    }
  }

  /** Curved gabled shrine roof (nagare-zukuri / shinmei-zukuri) with chigi finials and katsuogi billets. */
  shrineRoof(w: number, d: number, h: number, y: number, roofColor: Color, trimColor: Color, glow = 0.2) {
    const profile: [number, number][] = [[1.0, 0], [0.85, 0.1], [0.62, 0.34], [0.34, 0.68], [0, 1.0]];
    const halfW = w * 0.52;
    const halfD = d * 0.54;
    const ridgeY = y + h;
    // Left and right curved roof slopes along the x ridge
    for (const side of [-1, 1]) {
      for (let i = 0; i < profile.length - 1; i++) {
        const [s0, t0] = profile[i], [s1, t1] = profile[i + 1];
        const z0 = side * halfD * s0, z1 = side * halfD * s1;
        const y0 = y + h * t0, y1 = y + h * t1;
        const a: [number, number, number] = [-halfW, y0, z0];
        const b: [number, number, number] = [halfW, y0, z0];
        const c: [number, number, number] = [halfW, y1, z1];
        const e: [number, number, number] = [-halfW, y1, z1];
        if (side > 0) this.quad(a, b, c, e, roofColor, glow);
        else this.quad(b, a, e, c, roofColor, glow);
      }
    }
    // Gable wall triangles on both x ends
    for (const end of [-1, 1]) {
      const x = end * halfW * 0.92;
      const l: [number, number, number] = [x, y, -halfD * 0.82];
      const r: [number, number, number] = [x, y, halfD * 0.82];
      const apex: [number, number, number] = [x, ridgeY, 0];
      if (end > 0) this.tri(r, l, apex, trimColor, glow);
      else this.tri(l, r, apex, trimColor, glow);
    }
    // Eave underside & prominent ridge log (munagi)
    this.box(w * 1.02, Math.max(0.14, h * 0.045), d * 1.04, 0, y - 0.08, 0, roofColor, glow);
    const ridgeW = Math.min(0.46, Math.max(0.22, d * 0.055));
    this.box(w * 1.06, ridgeW * 1.15, ridgeW, 0, ridgeY + ridgeW * 0.38, 0, trimColor, glow + 0.12);

    // Katsuogi (鰹木): horizontal billets spaced along the ridge
    const billetCount = Math.min(7, Math.max(3, Math.round(w / 2.8) | 1));
    const billetLen = Math.min(2.1, Math.max(0.85, d * 0.2));
    const billetThick = Math.min(0.32, Math.max(0.16, ridgeW * 0.78));
    for (let i = 0; i < billetCount; i++) {
      const lx = billetCount === 1 ? 0 : ((i / (billetCount - 1)) - 0.5) * w * 0.62;
      this.box(billetThick, billetThick, billetLen, lx, ridgeY + ridgeW * 0.95, 0, trimColor, glow + 0.15);
    }
    // Chigi (千木): crossed V-shaped gable finials at both ends of the ridge
    const chigiRise = Math.min(1.85, Math.max(0.65, h * 0.42));
    const chigiSpan = Math.min(1.4, Math.max(0.5, d * 0.16));
    const chigiThick = Math.min(0.22, Math.max(0.11, ridgeW * 0.5));
    for (const end of [-1, 1]) {
      const x = end * (halfW * 0.82);
      for (const side of [-1, 1]) {
        const steps = 2;
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          this.box(
            chigiThick,
            chigiRise / steps + 0.08,
            chigiThick,
            x,
            ridgeY + chigiRise * t,
            side * chigiSpan * t,
            trimColor,
            glow + 0.18,
          );
        }
      }
    }
  }

  /** Build a Buddhist temple hall (本堂・仏殿), single- or double-tiered depending on scale. */
  templeHall(b: SacredBuilding) {
    const w = Math.max(4.5, b.w), d = Math.max(4.0, b.d), h = Math.max(4.5, b.h);
    const seed = b.seed ?? 0.5;
    const doubleRoof = h >= 13 && w * d >= 300;
    const roofColor = seed < 0.7 ? KAWARA_DARK : KAWARA_SLATE;
    const base = Math.min(1.4, Math.max(0.55, h * 0.08));
    const wallH = h * (doubleRoof ? 0.52 : 0.58);

    // Stone plinth (kidan) extending below ground so hillside sites never float
    this.box(w * 0.88, base + SKIRT, d * 0.88, 0, (base - SKIRT) * 0.5, 0, STONE, 0.08);
    // Sanctuary core walls (lime plaster)
    this.box(w * 0.72, Math.max(1.5, wallH - base), d * 0.68, 0, (wallH + base) * 0.5, 0, PLASTER_WARM, 0.14);
    // Timber veranda (engawa)
    this.box(w * 0.84, 0.24, d * 0.84, 0, base + 0.12, 0, WOOD_DARK, 0.14);
    // Front & rear bay colonnade + lattice shutters
    const bays = Math.min(9, Math.max(3, Math.round(w / 3.8)));
    const colThick = Math.min(0.42, Math.max(0.22, w * 0.02));
    for (const side of [-1, 1]) {
      for (let i = 0; i <= bays; i++) {
        const x = (i / bays - 0.5) * w * 0.78;
        this.box(colThick, wallH - base, colThick, x, (wallH + base) * 0.5, side * d * 0.37, WOOD_DARK, 0.18);
        if (i < bays) {
          this.box(w * 0.78 / bays - colThick * 1.15, (wallH - base) * 0.56, 0.18,
            x + w * 0.39 / bays, base + (wallH - base) * 0.44, side * d * 0.35, SHUTTER, 0.08);
        }
      }
      this.box(w * 0.82, Math.min(0.38, wallH * 0.07), colThick * 1.15, 0, wallH - 0.25, side * d * 0.375, WOOD_DARK, 0.16);
      const sideCols = Math.min(5, Math.max(2, Math.round(d / 4.2)));
      for (let i = 1; i < sideCols; i++) {
        const z = (i / sideCols - 0.5) * d * 0.74;
        this.box(colThick, wallH - base, colThick, side * w * 0.38, (wallH + base) * 0.5, z, WOOD_DARK, 0.18);
      }
    }
    // Front entrance stone steps
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const sh = base * (i + 1) / steps;
      this.box(Math.min(w * 0.32, 8), sh, 0.9, 0, sh * 0.5, d * 0.44 + (steps - 1 - i) * 0.75, STONE_PALE, 0.1);
    }
    if (doubleRoof) {
      this.curvedRoof(w * 1.06, d * 1.06, h * 0.18, wallH, roofColor, false, 0.18);
      this.box(w * 0.56, h * 0.14, d * 0.48, 0, wallH + h * 0.16, 0, PLASTER_WARM, 0.16);
      this.curvedRoof(w * 0.84, d * 0.84, h * 0.24, wallH + h * 0.23, roofColor, false, 0.2);
    } else {
      this.curvedRoof(w * 1.08, d * 1.08, Math.max(1.5, h - wallH), wallH, roofColor, w / d < 1.15 && w < 10, 0.18);
    }
  }

  /** Build a Shinto shrine hall (本殿・拝殿), either vermilion or natural hinoki timber. */
  shrineHall(b: SacredBuilding, vermilion: boolean) {
    const w = Math.max(3.6, b.w), d = Math.max(3.2, b.d), h = Math.max(4.2, b.h);
    const seed = b.seed ?? 0.5;
    const pillar = vermilion ? VERMILION : WOOD_HINOKI;
    const wall = vermilion ? PLASTER : (seed < 0.5 ? PLASTER_WARM : WOOD_HINOKI);
    const roofTone = vermilion
      ? (seed < 0.45 ? COPPER_GREEN : KAWARA_DARK)
      : (seed < 0.55 ? BARK_ROOF : COPPER_GREEN);
    const trim = vermilion ? VERMILION : WOOD_HINOKI;
    const base = Math.min(1.2, Math.max(0.5, h * 0.1));
    const wallH = h * 0.54;
    const glow = vermilion ? 0.38 : 0.2;

    // Stone base with slope skirt
    this.box(w * 0.88, base + SKIRT, d * 0.88, 0, (base - SKIRT) * 0.5, 0, STONE, 0.08);
    // Veranda deck & low balustrade (kouran)
    this.box(w * 0.86, 0.24, d * 0.86, 0, base + 0.12, 0, pillar, glow * 0.7);
    const railY = base + 0.75;
    for (const side of [-1, 1]) {
      this.box(w * 0.86, 0.12, 0.12, 0, railY, side * d * 0.42, pillar, glow * 0.8);
      this.box(0.12, 0.12, d * 0.86, side * w * 0.42, railY, 0, pillar, glow * 0.8);
    }
    // Inner sanctuary box
    this.box(w * 0.68, Math.max(1.2, wallH - base), d * 0.62, 0, (wallH + base) * 0.5, 0, wall, glow * 0.65);
    // Front & rear shrine columns and horizontal lintel
    const bays = Math.min(7, Math.max(2, Math.round(w / 3.2)));
    const colThick = Math.min(0.36, Math.max(0.18, w * 0.022));
    for (const side of [-1, 1]) {
      for (let i = 0; i <= bays; i++) {
        const x = (i / bays - 0.5) * w * 0.76;
        this.box(colThick, wallH - base, colThick, x, (wallH + base) * 0.5, side * d * 0.34, pillar, glow);
        if (i < bays) {
          this.box(w * 0.76 / bays - colThick * 1.2, (wallH - base) * 0.48, 0.14,
            x + w * 0.38 / bays, base + (wallH - base) * 0.42, side * d * 0.32, SHUTTER, 0.08);
        }
      }
      this.box(w * 0.8, 0.26, colThick * 1.15, 0, wallH - 0.2, side * d * 0.345, pillar, glow);
    }
    // Front steps & gold accent crest on front beam
    for (let i = 0; i < 3; i++) {
      const sh = base * (i + 1) / 3;
      this.box(Math.min(w * 0.3, 6), sh, 0.75, 0, sh * 0.5, d * 0.44 + (2 - i) * 0.65, pillar, glow * 0.7);
    }
    this.box(Math.min(0.9, w * 0.08), Math.min(0.9, h * 0.08), 0.14, 0, wallH - 0.2, d * 0.37, GOLD, 0.45);
    this.shrineRoof(w * 1.1, d * 1.12, Math.max(1.6, h - wallH), wallH, roofTone, trim, glow * 0.6);
  }

  /** Build a 3- or 5-storey pagoda (三重塔 / 五重塔) with curved eaves and bronze finial spire. */
  pagoda(b: SacredBuilding) {
    const side = Math.max(4.5, Math.min(16, (b.w + b.d) * 0.5));
    const h = Math.max(14, b.h);
    const storeys = h >= 24 ? 5 : 3;
    const spire = h * 0.23;
    const base = 1.1;
    const step = (h - spire - base) / storeys;
    const body = (b.seed ?? 0) > 0.55 ? VERMILION : WOOD_DARK;

    this.box(side * 1.35, base + SKIRT, side * 1.35, 0, (base - SKIRT) * 0.5, 0, STONE, 0.15);
    let y = base;
    for (let i = 0; i < storeys; i++) {
      const t = i / Math.max(1, storeys - 1);
      const s = side * (0.64 - 0.18 * t);
      const bodyH = step * 0.56, roofH = step * 0.44;
      this.box(s, bodyH, s, 0, y + bodyH * 0.5, 0, body, 0.42);
      this.box(s * 0.9, bodyH * 0.48, s * 1.03, 0, y + bodyH * 0.5, 0, body === VERMILION ? PLASTER : PLASTER_WARM, 0.35);
      this.box(s * 1.03, bodyH * 0.48, s * 0.9, 0, y + bodyH * 0.5, 0, body === VERMILION ? PLASTER : PLASTER_WARM, 0.35);
      this.curvedRoof(s * 2.02, s * 2.02, roofH, y + bodyH, KAWARA_DARK, true, 0.25);
      y += step;
    }
    // Bronze sorin spire
    const mastW = Math.max(0.24, side * 0.04);
    this.box(mastW, spire, mastW, 0, y + spire * 0.5, 0, BRONZE, 0.5);
    for (let k = 0; k < 5; k++) {
      const rw = mastW * (2.6 - k * 0.22);
      this.box(rw, 0.16, rw, 0, y + spire * (0.28 + k * 0.11), 0, BRONZE, 0.5);
    }
  }

  /** Build an open-bay temple Sanmon or shrine Romon gate (山門 / 楼門). */
  gate(b: SacredBuilding) {
    const w = Math.max(4.5, b.w), d = Math.max(3.2, b.d), h = Math.max(5.0, b.h);
    const vermilion = (b.seed ?? 0) > 0.62;
    const twoStorey = h >= 8.5;
    const pillar = vermilion ? VERMILION : WOOD_DARK;
    const glow = vermilion ? 0.42 : 0.22;
    const deck = twoStorey ? h * 0.44 : h * 0.58;
    const col = Math.min(0.55, Math.max(0.26, w * 0.04));

    // Low footing skirt under outer side walls, keeping central passage visually open
    for (const end of [-1, 1]) {
      this.box(w * 0.22, 0.45 + SKIRT, d * 0.85, end * w * 0.37, (0.45 - SKIRT) * 0.5, 0, STONE, 0.08);
      this.box(w * 0.2, deck * 0.88, d * 0.55, end * w * 0.36, deck * 0.44, 0, vermilion ? PLASTER : WOOD_DARK, glow * 0.8);
    }
    // Four front + four rear timber pillars framing the open central passage
    for (const side of [-1, 1]) {
      for (const fx of [-0.42, -0.15, 0.15, 0.42]) {
        this.box(col, deck, col, fx * w, deck * 0.5, side * d * 0.35, pillar, glow);
      }
      this.box(w * 0.9, 0.34, col * 1.15, 0, deck - 0.22, side * d * 0.35, pillar, glow);
    }
    if (twoStorey) {
      // Lower eave canopy + upper gallery + sweeping main roof
      this.curvedRoof(w * 1.12, d * 1.12, h * 0.14, deck - 0.35, KAWARA_DARK, false, 0.2);
      const upperBase = deck + h * 0.06;
      const upperH = h * 0.22;
      this.box(w * 0.82, 0.28, d * 0.72, 0, upperBase, 0, pillar, glow);
      this.box(w * 0.74, upperH, d * 0.58, 0, upperBase + upperH * 0.5, 0, vermilion ? PLASTER : PLASTER_WARM, glow * 0.8);
      this.curvedRoof(w * 1.05, d * 1.05, Math.max(1.5, h - upperBase - upperH), upperBase + upperH, KAWARA_DARK, false, 0.22);
    } else {
      this.curvedRoof(w * 1.14, d * 1.14, Math.max(1.4, h - deck), deck, KAWARA_DARK, false, 0.2);
    }
  }

  /** Build a Shinto Torii gate (鳥居), either vermilion or granite stone. */
  torii(b: SacredBuilding, stone: boolean) {
    const w = Math.max(2.6, Math.min(26, b.w));
    const h = Math.max(3.0, Math.min(24, b.h || w * 0.95));
    const main = stone ? STONE_PALE : VERMILION;
    const cap = stone ? STONE : KAWARA_DARK;
    const glow = stone ? 0.18 : 0.45;
    const r = Math.min(0.85, Math.max(0.14, w * 0.055));
    const span = w * 0.34;
    for (const side of [-1, 1]) {
      this.box(r * 2.1, h * 0.9 + SKIRT, r * 2.1, side * span, (h * 0.9 - SKIRT) * 0.5, 0, main, glow);
      this.box(r * 2.9, Math.min(1.2, h * 0.13), r * 2.9, side * span, Math.min(0.6, h * 0.065), 0, cap, 0.15);
    }
    // Lower tie-beam (nuki)
    this.box(w * 0.92, Math.max(0.18, h * 0.065), r * 1.7, 0, h * 0.68, 0, main, glow);
    // Upper shimaki + wider upturned kasagi cap
    this.box(w * 1.02, Math.max(0.2, h * 0.075), r * 2.4, 0, h * 0.9, 0, main, glow);
    this.box(w * 1.1, Math.max(0.16, h * 0.06), r * 2.8, 0, h * 0.97, 0, cap, 0.22);
    // Upturned kasagi tips
    for (const side of [-1, 1]) {
      this.box(w * 0.12, Math.max(0.16, h * 0.055), r * 2.8, side * w * 0.53, h * 1.01, 0, cap, 0.22);
    }
    // Central name plaque (gakuzuka)
    this.box(Math.max(0.28, w * 0.11), Math.max(0.45, h * 0.16), r * 1.1, 0, h * 0.79, 0, stone ? STONE : SHUTTER, 0.28);
  }

  build(records: readonly SacredBuilding[], ground: (x: number, z: number) => number): THREE.BufferGeometry | null {
    for (const b of records) {
      const y = ground(b.x, b.z);
      this.setFrame(b.x, y, b.z, b.angle);
      switch (b.kind) {
        case SACRED.temple: this.templeHall(b); break;
        case SACRED.shrine: this.shrineHall(b, false); break;
        case SACRED.shrineVermilion: this.shrineHall(b, true); break;
        case SACRED.pagoda: this.pagoda(b); break;
        case SACRED.gate: this.gate(b); break;
        case SACRED.torii: this.torii(b, false); break;
        case SACRED.toriiStone: this.torii(b, true); break;
      }
    }
    if (!this.positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glows, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export function buildSacredGeometry(records: readonly SacredBuilding[], ground: (x: number, z: number) => number) {
  return new SacredBuilder().build(records, ground);
}

type Boundary = Awaited<ReturnType<typeof boundaryUniforms>>;

/** Shared lighting & shadow material for procedural shrine and temple architecture. */
export function sacredMaterial(env: Env, boundary?: Boundary) {
  return new THREE.ShaderMaterial({
    uniforms: boundary ? { ...env, ...boundary } : env,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aGlow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vGlow;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vGlow = aGlow;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      ${boundary ? HOME_BOUNDARY : ''}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vGlow;
      void main(){
        ${boundary ? 'if(owner(vWorld.xz)==0)discard;' : ''}
        vec3 n = normalize(vNormal);
        float sh = sunShadow(vWorld, n);
        vec3 col = shade(seasonalSurface(vColor, n, vWorld), n, vWorld, sh);
        float up = clamp(n.y * -.5 + .75, .35, 1.);
        vec3 flood = vColor * vec3(1., .86, .66) * vGlow * up * 1.45;
        gl_FragColor = vec4(applyHaze(col, flood * uCity, vWorld), 1.);
      }
    `,
  });
}
