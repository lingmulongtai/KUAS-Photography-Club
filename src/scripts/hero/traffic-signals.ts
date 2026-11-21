import type { Connection } from './traffic-junctions.ts';

export const HALF_CYCLE = 26;
export const GREEN_SECONDS = 21;
export const AMBER_SECONDS = 3;
export const VEHICLE_GAP = 6.4;

export function signalAspect(seconds: number, phase: number) {
  const t = (seconds + phase) % (2 * HALF_CYCLE);
  return t < GREEN_SECONDS ? 0 : t < GREEN_SECONDS + AMBER_SECONDS ? 1 : 2;
}

interface Road { pts: Float32Array; rank: number; motorway: boolean }
export interface Approach {
  path: number; end: 0 | 1; x: number; z: number;
  dx: number; dz: number; rank: number; phase: number; line: number;
}

/** Indicative signals at actual connected, at-grade road endpoints. Crossing lines
 * without a shared route node (overpasses) never qualify. */
export function signalApproaches(paths: readonly Road[], links: Connection[][][], width: readonly number[],
                                elevated: (x: number, z: number, dx: number, dz: number) => boolean, limit: number) {
  const approaches: Approach[] = [];
  const visited = new Set<number>();
  for (let i = 0; i < paths.length && approaches.length < limit; i++) for (const end of [0, 1] as const) {
    const neighbours = links[i][end];
    if (neighbours.length < 2 || visited.has(i * 2 + end)) continue;
    const road = paths[i], p = road.pts, a = end ? p.length - 2 : 0, b = end ? a - 2 : 2;
    const x = p[a], z = p[a + 1], len = Math.hypot(p[b] - x, p[b + 1] - z);
    const arms = [{ path: i, end, dx: (p[b] - x) / len, dz: (p[b + 1] - z) / len }, ...neighbours];
    for (const arm of arms) visited.add(arm.path * 2 + arm.end);
    if (approaches.length + arms.length > limit || arms.length > 4 || arms.some(arm => paths[arm.path].motorway ||
        elevated(x, z, arm.dx, arm.dz) || elevated(x + 9 * arm.dx, z + 9 * arm.dz, arm.dx, arm.dz))) continue;
    // A T or a cross needs distinct approaches, including a through road. Exclude
    // parallel carriageways, curved road splits and motorway-style forks.
    const dot = (a: Connection, b: Connection) => a.dx * b.dx + a.dz * b.dz;
    const axis = arms.find(a => arms.some(b => dot(a, b) < -.82) && arms.some(b => Math.abs(dot(a, b)) < .55));
    if (!axis) continue;
    const major = (arm: Connection) => Math.abs(dot(arm, axis)) > .7;
    if (arms.some((a, k) => arms.slice(k + 1).some(b => major(a) === major(b) && dot(a,b) > -.82))) continue;
    const offset = ((Math.round(x) * 17 + Math.round(z) * 31) % (2 * HALF_CYCLE) + 2 * HALF_CYCLE) % (2 * HALF_CYCLE);
    const line = Math.max(...arms.map(a => width[paths[a.path].rank])) * .5 + 2;
    for (const arm of arms) approaches.push({ ...arm, x, z, rank: paths[arm.path].rank, line,
      phase: offset + (major(arm) ? 0 : HALF_CYCLE) });
  }
  return approaches;
}

/** Remaining distance to the intersection after this step. A vehicle already
 * over the stop bar clears it; followers queue one car length behind the leader. */
export function remainingAfterSignal(before: number, advance: number, centreStop: number, aspect: number, leader: number) {
  let target = before - advance;
  if (aspect !== 0 && before >= centreStop - .03) target = Math.max(target, centreStop);
  return Math.min(before, Math.max(target, leader + VEHICLE_GAP));
}
