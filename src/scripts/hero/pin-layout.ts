export interface ScreenRect { x: number; y: number; w: number; h: number; }
export type PinSlot = 'top' | 'right' | 'left' | 'bottom';

export const DEFAULT_SLOTS: readonly PinSlot[] = ['top', 'right', 'left', 'bottom'];
export const ACTION_SLOTS: readonly PinSlot[] = ['top', 'bottom'];

const TAP_HALF = 22;
const VERTICAL_STEM = 12;
const HORIZONTAL_STEM = 14;

/** Exact two-part footprint: the 44 px tap button around the anchor dot plus the label rect in its slot. */
export function pinFootprint(
  x: number,
  y: number,
  labelWidth: number,
  labelHeight: number,
  slot: PinSlot = 'top',
  gap = 6,
): [ScreenRect, ScreenRect] {
  const dotGap = Math.min(2, gap);
  const dot: ScreenRect = {
    x: x - TAP_HALF - dotGap,
    y: y - TAP_HALF - dotGap,
    w: (TAP_HALF + dotGap) * 2,
    h: (TAP_HALF + dotGap) * 2,
  };
  let lx: number;
  let ly: number;
  if (slot === 'top') {
    lx = x - labelWidth / 2;
    ly = y - VERTICAL_STEM - labelHeight;
  } else if (slot === 'bottom') {
    lx = x - labelWidth / 2;
    ly = y + VERTICAL_STEM;
  } else if (slot === 'right') {
    lx = x + HORIZONTAL_STEM;
    ly = y - labelHeight / 2;
  } else {
    lx = x - HORIZONTAL_STEM - labelWidth;
    ly = y - labelHeight / 2;
  }
  const label: ScreenRect = {
    x: lx - gap,
    y: ly - gap,
    w: labelWidth + gap * 2,
    h: labelHeight + gap * 2,
  };
  return [dot, label];
}

/** Include the 44 px tap target and the full label anchored in the given cardinal slot. */
export function pinBounds(
  x: number,
  y: number,
  labelWidth: number,
  labelHeight: number,
  slot: PinSlot = 'top',
  gap = 6,
): ScreenRect {
  const [dot, label] = pinFootprint(x, y, labelWidth, labelHeight, slot, gap);
  const minX = Math.min(dot.x, label.x);
  const minY = Math.min(dot.y, label.y);
  const maxX = Math.max(dot.x + dot.w, label.x + label.w);
  const maxY = Math.max(dot.y + dot.h, label.y + label.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function overlaps(a: ScreenRect, b: ScreenRect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function fitsViewport(rects: readonly ScreenRect[], width: number, height: number, margin: number) {
  return rects.every((r) => r.x >= margin && r.x + r.w <= width - margin && r.y >= margin && r.y + r.h <= height - margin);
}

function clearOfObstacles(rects: readonly ScreenRect[], placed: readonly ScreenRect[], blocks: readonly ScreenRect[], blockPad: number) {
  for (const r of rects) {
    if (placed.some((p) => overlaps(r, p))) return false;
    if (blocks.some((b) => overlaps(r, { x: b.x - blockPad, y: b.y - blockPad, w: b.w + blockPad * 2, h: b.h + blockPad * 2 }))) return false;
  }
  return true;
}

export interface SlotChoice {
  slot: PinSlot;
  rects: [ScreenRect, ScreenRect];
  box: ScreenRect;
}

/**
 * Pick the cleanest non-overlapping slot around (x, y).
 * Prefers 'top' (with extra comfort margin before switching back from a fallback slot to avoid jitter),
 * then tries to keep the previous frame's slot, then tests the remaining cardinal directions.
 */
export function choosePinSlot(
  x: number,
  y: number,
  labelWidth: number,
  labelHeight: number,
  width: number,
  height: number,
  placed: readonly ScreenRect[],
  blocks: readonly ScreenRect[],
  preferredSlot?: PinSlot | null,
  allowedSlots: readonly PinSlot[] = DEFAULT_SLOTS,
): SlotChoice | null {
  const margin = 8;
  const blockPad = 8;
  const canPlace = (slot: PinSlot, extraGap = 0): SlotChoice | null => {
    const testRects = pinFootprint(x, y, labelWidth, labelHeight, slot, 6 + extraGap);
    if (!fitsViewport(testRects, width, height, margin)) return null;
    if (!clearOfObstacles(testRects, placed, blocks, blockPad)) return null;
    const rects = extraGap === 0 ? testRects : pinFootprint(x, y, labelWidth, labelHeight, slot, 6);
    const [d, l] = rects;
    const minX = Math.min(d.x, l.x);
    const minY = Math.min(d.y, l.y);
    const box: ScreenRect = {
      x: minX,
      y: minY,
      w: Math.max(d.x + d.w, l.x + l.w) - minX,
      h: Math.max(d.y + d.h, l.y + l.h) - minY,
    };
    return { slot, rects, box };
  };

  if (allowedSlots.includes('top')) {
    const comfort = preferredSlot && preferredSlot !== 'top' ? 6 : 0;
    const choice = canPlace('top', comfort);
    if (choice) return choice;
  }

  if (preferredSlot && preferredSlot !== 'top' && allowedSlots.includes(preferredSlot)) {
    const choice = canPlace(preferredSlot);
    if (choice) return choice;
  }

  for (const slot of allowedSlots) {
    if (slot === 'top' || slot === preferredSlot) continue;
    const choice = canPlace(slot);
    if (choice) return choice;
  }
  return null;
}

/** Maximum display distance (metres) by visual hierarchy rank so distant local spots do not clutter horizons. */
export function maxPinDistance(rank: number): number {
  if (rank <= 0) return 55000;
  if (rank === 1) return 48000;
  if (rank === 2) return 26000;
  if (rank === 3) return 18500;
  return 16500;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Lower score wins screen space.
 * Nearby pins (< 2.2 km) receive a strong foreground boost so close landmarks beat far-away pins,
 * while panoramic views (> 2.2 km) preserve the curated rank hierarchy.
 */
export function effectivePinPriority(rank: number, distance: number, wasShown = false): number {
  const nearBoost = 4.5 * smoothstep(2200, 300, distance);
  const farPenalty = Math.min(2.6, Math.max(0, (distance - 8000) / 8000));
  return rank - nearBoost + farPenalty - (wasShown ? 0.35 : 0);
}
