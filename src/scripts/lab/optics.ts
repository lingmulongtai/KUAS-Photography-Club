/**
 * Camera arithmetic shared by every learning-lab proposal.
 * Distances are metres, focal lengths millimetres, shutter speeds seconds.
 */
import type { FilterEffect, LensCharacter } from './pipeline';

/** Full-frame sensor height (m). A crop factor divides it. */
export const SENSOR_H = 0.024;

export interface Shot {
  /** Focal length (mm, real, not 35mm-equivalent). */
  mm: number;
  /** f-number. */
  N: number;
  /** Shutter speed (s). */
  t: number;
  iso: number;
  /** Focus distance (m). */
  focus: number;
  /** Crop factor of the sensor (1 = full frame). */
  crop?: number;
  /** 0 on a tripod, 1 handheld. */
  shake?: number;
  /** Number of aperture blades; 0 for a round opening. */
  blades?: number;
  peaking?: boolean;
  /** Stripe the clipped highlights. */
  zebra?: boolean;
  /** Extra exposure in stops on top of the settings (bracketing, compensation, an ND filter). */
  bias?: number;
  /** Fringing, softness, vignetting and flare of a particular lens. */
  lens?: LensCharacter;
  /** A filter in front of the lens. */
  filter?: FilterEffect;
  /** Narrow the view and dim the picture when focusing close, as a real lens does (macro). */
  breathing?: boolean;
}

export const SHUTTER_STOPS = [1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8] as const;
/** The full range of a camera body, down to the 30-second exposures used for the night sky. */
export const SHUTTER_FULL = [1 / 8000, 1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 15, 30] as const;
export const APERTURE_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22] as const;
export const ISO_LADDER = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] as const;
export const FOCAL_LADDER = [14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200] as const;

export const shutterText = (t: number) => (t >= 1 ? `${t}″` : `1/${Math.round(1 / t)}`);
export const apertureText = (N: number) => `F${N < 10 ? N.toFixed(1).replace('.0', '') : Math.round(N)}`;
export const distanceText = (d: number) => (d >= 10 ? `${Math.round(d)}m` : d >= 1 ? `${d.toFixed(1)}m` : `${Math.round(d * 100)}cm`);

/** Vertical field of view (radians). */
export const vfov = (mm: number, crop = 1) => 2 * Math.atan(SENSOR_H / crop / 2 / (mm / 1000));
/** Diagonal field of view in degrees, as lens charts give it. */
export const diagonalDeg = (mm: number, crop = 1) => (2 * Math.atan(0.04327 / crop / 2 / (mm / 1000)) * 180) / Math.PI;
/** Distance at which `frameH` metres fill the frame height. */
export const distanceFor = (mm: number, frameH: number, crop = 1) => frameH / 2 / Math.tan(vfov(mm, crop) / 2);

/** EV100 that the camera settings expose for. */
export const cameraEV = (N: number, t: number, iso: number) => Math.log2((N * N) / t) - Math.log2(iso / 100);

/** Near and far limits of acceptable sharpness (m). Circle of confusion scales with the sensor. */
export function depthOfField(mm: number, N: number, focus: number, crop = 1) {
  const f = mm / 1000;
  const c = 0.00003 / crop;
  const H = (f * f) / (N * c) + f;
  const near = (focus * (H - f)) / (H + focus - 2 * f);
  const far = focus >= H ? Infinity : (focus * (H - f)) / (H - focus);
  return { near, far, hyperfocal: H };
}

/** Shutter speed that gives the correct exposure for `ev` with this aperture and ISO, snapped to a stop. */
export function autoShutter(ev: number, N: number, iso: number) {
  const t = (N * N) / 2 ** (ev + Math.log2(iso / 100));
  return nearest(SHUTTER_STOPS, t);
}
export function autoAperture(ev: number, t: number, iso: number) {
  const N = Math.sqrt(t * 2 ** (ev + Math.log2(iso / 100)));
  return nearest(APERTURE_STOPS, N);
}
export function autoIso(ev: number, N: number, t: number) {
  const iso = 100 * 2 ** (Math.log2((N * N) / t) - ev);
  return nearest(ISO_LADDER, iso);
}

export function nearest<T extends number>(stops: readonly T[], v: number): T {
  let best = stops[0];
  for (const s of stops) if (Math.abs(Math.log(s / v)) < Math.abs(Math.log(best / v))) best = s;
  return best;
}

/** Index helpers for sliders that walk a ladder of stops. */
export const stopIndex = (stops: readonly number[], v: number) => stops.indexOf(nearest(stops, v));
