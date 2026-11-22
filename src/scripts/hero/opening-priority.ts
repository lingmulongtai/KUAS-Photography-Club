import type { Box } from './geo';
import type { ViewDef } from './views';

export type LoadTier = 'opening' | 'afterOpen' | 'onInteract';

export interface OpeningPriorities {
  south: LoadTier;
  yamashina: LoadTier;
  yamashinaBasin: LoadTier;
  otokuni: LoadTier;
  otokuniTennozan: LoadTier;
  eastBackdrop: LoadTier;
  biwa: LoadTier;
}

const RAD = Math.PI / 180;
// 50° half-angle covers 16:9 (~33°), ultrawide 21:9 (~43°), and subtle opening drift.
const CONE_HALF_DEG = 50;
// Beyond 6 km the lightweight overview LODs hold the horizon until resident surveys stream in after open.
const NEAR_CUTOFF_M = 6000;

export const SURROUNDING_BOXES = {
  south: [-9000, 6200, 4600, 19000] as Box,
  yamashina: [4600, -2500, 12500, 8500] as Box,
  yamashinaBasin: [3100, -2600, 9500, 8600] as Box,
  otokuni: [-9500, 4200, -2500, 10500] as Box,
  otokuniTennozan: [-9500, 8500, -2500, 16500] as Box,
  // Inside x <= 4400 the city aerial sheet covers the ground; only x > 4400 exposes aerial-yamashina.
  eastBackdrop: [4400, -2500, 12500, 10000] as Box,
  biwa: [6500, -20000, 35000, 15000] as Box,
} as const;

function boxVisibility(eye: { x: number; z: number }, bearingDeg: number, box: Box) {
  const [w, n, e, s] = box;
  if (eye.x >= w && eye.x <= e && eye.z >= n && eye.z <= s) {
    return { inCone: true, minDist: 0 };
  }
  const fx = Math.sin(bearingDeg * RAD);
  const fz = -Math.cos(bearingDeg * RAD);
  let minAngle = 180;
  let minDist = Infinity;
  for (let i = 0; i <= 4; i++) {
    const px = w + (e - w) * (i / 4);
    for (let j = 0; j <= 4; j++) {
      const pz = n + (s - n) * (j / 4);
      const dx = px - eye.x;
      const dz = pz - eye.z;
      const d = Math.hypot(dx, dz);
      if (d < 1) return { inCone: true, minDist: 0 };
      const cos = Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d));
      const ang = Math.acos(cos) / RAD;
      if (ang < minAngle) minAngle = ang;
      if (ang <= CONE_HALF_DEG && d < minDist) minDist = d;
    }
  }
  return { inCone: minAngle <= CONE_HALF_DEG, minDist };
}

function tierFor(eye: { x: number; z: number }, bearing: number, box: Box, requireAllInCone = false): LoadTier {
  const { inCone, minDist } = boxVisibility(eye, bearing, box);
  if (!inCone) return 'onInteract';
  if (requireAllInCone || minDist < NEAR_CUTOFF_M) return 'opening';
  return 'afterOpen';
}

/**
 * Classify surrounding basin surveys and imagery by whether they fall in the opening camera's
 * forward field and near enough to matter on frame 1.
 */
export function openingPriorities(view: Pick<ViewDef, 'eye' | 'bearing'>): OpeningPriorities {
  const { eye, bearing } = view;
  return {
    south: tierFor(eye, bearing, SURROUNDING_BOXES.south),
    yamashina: tierFor(eye, bearing, SURROUNDING_BOXES.yamashina),
    yamashinaBasin: tierFor(eye, bearing, SURROUNDING_BOXES.yamashinaBasin),
    otokuni: tierFor(eye, bearing, SURROUNDING_BOXES.otokuni),
    otokuniTennozan: tierFor(eye, bearing, SURROUNDING_BOXES.otokuniTennozan),
    eastBackdrop: tierFor(eye, bearing, SURROUNDING_BOXES.eastBackdrop),
    // Lake Biwa has no overview LOD fallback, so load before open whenever it lies in the forward cone.
    biwa: tierFor(eye, bearing, SURROUNDING_BOXES.biwa, true),
  };
}
