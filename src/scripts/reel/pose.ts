/**
 * Poses for the photo reel on the trips page: a ring of portrait photo cards that is first dealt
 * out like a loader, seen from outside like a tilted coin, then opens until the viewer stands
 * inside it and it turns as a carousel. Everything is a pure function of two progress values
 * (formation, expansion) and the spin, so the motion can be tested without a browser.
 *
 * Ring space: x to the right, y down (as in CSS), z toward the viewer. A card at angle a sits at
 * (R sin a, 0, -R cos a) and faces the centre, so a = 0 is straight ahead and a = ±π is behind.
 */

export const TAU = Math.PI * 2;

export interface ReelLayout {
  /** cards on the ring */
  count: number;
  /** card width in px; cards are 9:16 */
  width: number;
  /** radius and perspective once the ring is open */
  radius: number;
  perspective: number;
}

export interface ReelScene {
  /** 0..1: how far the deal has gone */
  formation: number;
  /** 0..1: how far the ring has opened (already eased) */
  expansion: number;
  /** turn of the carousel, radians */
  spin: number;
}

export interface RingPose {
  radius: number;
  /** degrees */
  tilt: number;
  roll: number;
  /** card scale */
  scale: number;
  perspective: number;
}

export interface CardPose {
  /** where on the ring, radians, wrapped to (-π, π] */
  angle: number;
  opacity: number;
  /** false once the card is behind or right on top of the viewer */
  visible: boolean;
  /** depth of the card's centre toward the viewer, px */
  depth: number;
  /** whole turns made so far: photos change only while the card is out of sight */
  cycle: number;
  /** CSS transform for the card inside the ring */
  transform: string;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeOutQuart = (x: number) => 1 - Math.pow(1 - clamp01(x), 4);
/** Wrap an angle to (-π, π]. */
export const wrapAngle = (a: number) => {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w === -Math.PI ? Math.PI : w;
};

/** Card size, count and the open ring for a stage of this width. */
export function layoutFor(stageWidth: number): ReelLayout {
  const narrow = stageWidth < 700;
  const count = narrow ? 12 : 16;
  const width = Math.round(Math.min(340, Math.max(150, stageWidth * (narrow ? 0.5 : 0.26))));
  // cards almost touch round the open ring
  const radius = (count * width * 1.06) / TAU;
  return { count, width, radius, perspective: radius * (narrow ? 1.4 : 0.9) };
}

/** The small tilted ring of the loader opening into the level ring around the viewer. */
export function ringPose(layout: ReelLayout, expansion: number): RingPose {
  const e = clamp01(expansion);
  return {
    // the loader's ring is smaller in proportion to its cards, so they sit apart like a dealt hand
    radius: lerp(layout.radius * 0.32, layout.radius, e),
    tilt: lerp(-22, 0, e),
    roll: lerp(-18, 0, e),
    scale: lerp(0.3, 1, e),
    perspective: lerp(layout.perspective * 2.8, layout.perspective, e),
  };
}

/** Each card takes a quarter of the deal, starting one after another. */
export const dealProgress = (i: number, count: number, formation: number) => clamp01((formation - (i / count) * 0.75) / 0.25);

/** Where card slot i is and how it looks. */
export function cardPose(i: number, layout: ReelLayout, scene: ReelScene, ring: RingPose = ringPose(layout, scene.expansion)): CardPose {
  const n = layout.count;
  const home = wrapAngle((i / n) * TAU);
  // dealt from the stack at the front of the ring, swinging out round it
  const p = dealProgress(i, n, scene.formation);
  const from = home >= 0 ? Math.PI : -Math.PI;
  const raw = lerp(from, home, easeOutCubic(p)) + scene.spin;
  const angle = wrapAngle(raw);

  // the card's centre after the ring's roll (about z) and tilt (about x)
  const r = ring.radius;
  const x = r * Math.sin(angle);
  const z = -r * Math.cos(angle);
  const roll = (ring.roll * Math.PI) / 180;
  const tilt = (ring.tilt * Math.PI) / 180;
  const yr = x * Math.sin(roll);
  const depth = yr * Math.sin(tilt) + z * Math.cos(tilt);

  // cards fade in as they are dealt, so the waiting stack never shows; anything at or behind
  // the viewer is hidden, and cards about to pass right by fade out before they get huge
  const near = 1 - clamp01((depth - ring.perspective * 0.15) / (ring.perspective * 0.25));
  const opacity = clamp01(p * 2.5) * near;
  const visible = opacity > 0.01 && depth < ring.perspective * 0.8;
  const cycle = Math.floor(((i / n) * TAU + scene.spin + Math.PI) / TAU);
  return {
    angle,
    opacity,
    visible,
    depth,
    cycle,
    transform: `rotateY(${(-angle).toFixed(4)}rad) translateZ(${(-r).toFixed(1)}px) scale(${ring.scale.toFixed(4)})`,
  };
}

/** Which photo slot i shows: slots pick up the next photos each time they pass behind the viewer. */
export const photoFor = (i: number, cycle: number, count: number, photos: number) =>
  photos > 0 ? (((i + cycle * count) % photos) + photos) % photos : -1;
