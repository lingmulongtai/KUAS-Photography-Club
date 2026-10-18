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
  // Sample more densely than the 10 m local elevation grid. A fixed eight-point
  // test can miss the narrow ridge immediately behind a temple.
  const samples = Math.max(16,Math.min(128,Math.ceil(radius/48)*8));
  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const h = obstruction(pos.x + (target.x - pos.x) * t, pos.z + (target.z - pos.z) * t);
    pos.y = Math.max(pos.y, (h - target.y * t) / (1 - t));
  }
  // Keep the near view clear on both sides as well as directly beneath the eye.
  // This avoids a hillside occupying the whole screen while the centre ray is clear.
  const clearance=Math.max(12,Math.min(80,distance*.12));
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4;
    pos.y=Math.max(pos.y,obstruction(pos.x+Math.cos(a)*clearance,pos.z+Math.sin(a)*clearance)+8);
  }
  return { pos, target };
}
