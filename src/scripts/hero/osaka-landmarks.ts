import type * as THREE from 'three';
import type { Env } from './env';
import {
  createLandmarkBuilder, finalizeLandmarkGroup, inMaskShapes,
  type GroundFn, type LandmarkBuilder, type MaskShape,
} from './landmark-builder';
import { OUTLINES } from './landmark-outlines';
import { inRing, inset, ringOf } from './landmark-kit';
import { buildAbenoHarukas } from './abeno-harukas';
import { buildTsutenkaku } from './tsutenkaku-tower';
import { buildUsj, inUsjClearing, inUsjModel } from './osaka-usj';
import { HEIJO_BUILDING_MASKS, HEIJO_TREE_MASKS, buildHeijoPalace } from './nara-heijo';

// Generic survey buildings inside these outlines give way to the bespoke models.
const MODELLED = [OUTLINES.harukasTower, OUTLINES.harukasWing, OUTLINES.tsutenkaku].map(o => inset(ringOf(o), -3));

const EXTRA_BUILDING_MASKS: MaskShape[] = [...HEIJO_BUILDING_MASKS];
const EXTRA_TREE_MASKS: MaskShape[] = [...HEIJO_TREE_MASKS];

/** True when a generic skyline/regional building sits inside any bespoke Kansai landmark footprint. */
export function inOsakaLandmarkMask(x: number, z: number): boolean {
  return MODELLED.some(r => inRing(r, x, z)) || inUsjModel(x, z) || inMaskShapes(EXTRA_BUILDING_MASKS, x, z);
}

/** True when wild procedural trees should yield to landscaped plazas, water basins, or palace gravel courts. */
export function inLandmarkTreeExclusion(x: number, z: number): boolean {
  return inUsjClearing(x, z) || inMaskShapes(EXTRA_TREE_MASKS, x, z);
}

export function buildOsakaLandmarks(
  env: Env,
  ground: GroundFn,
  extras: readonly ((b: LandmarkBuilder, ground: GroundFn) => void)[] = [],
): THREE.Group {
  const b = createLandmarkBuilder();
  buildAbenoHarukas(b, ground);
  buildTsutenkaku(b, ground);
  buildUsj(b, ground);
  buildHeijoPalace(b, ground);
  for (const addEnsemble of extras) addEnsemble(b, ground);
  return finalizeLandmarkGroup(b, env, 'osaka-skyline-landmarks');
}
