export interface OrbitSite {
  center: { x: number; z: number };
  /** Metres above the sampled ground at the object. */
  targetHeight: number;
}

/** Keep the object fixed while moving the eye around it, including full turns and overhead. */
export function landmarkOrbit(
  site: OrbitSite,
  eye: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  ground: (x: number, z: number) => number,
  obstruction: (x: number, z: number) => number = (x,z) => ground(x,z)+4,
) {
  const rad = Math.PI / 180;
  const target = { ...site.center, y: ground(site.center.x, site.center.z) + site.targetHeight };
  const dx = eye.x - target.x, dz = eye.z - target.z, dy = eye.y - target.y;
  const horizontal = Math.hypot(dx, dz);
  const distance = Math.hypot(horizontal, dy);
  const azimuth = Math.atan2(dx, -dz) + yaw * rad;
  const elevation = Math.max(5, Math.min(89, Math.atan2(dy, horizontal) / rad + pitch)) * rad;
  const radius = Math.cos(elevation) * distance;
  const pos = { x: target.x + Math.sin(azimuth) * radius, y: target.y + Math.sin(elevation) * distance, z: target.z - Math.cos(azimuth) * radius };
  // Hills behind a temple must not swallow the camera or hide the target under the terrain.
  // Eight heightfield samples are cheap and do not require raycasting the city mesh.
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const h = obstruction(pos.x + (target.x - pos.x) * t, pos.z + (target.z - pos.z) * t);
    pos.y = Math.max(pos.y, (h - target.y * t) / (1 - t));
  }
  return { pos, target };
}
