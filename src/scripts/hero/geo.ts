/**
 * Local metres on a plane tangent at Shijo-Karasuma: +x east, +z south, +y up (metres above sea level).
 * Must match tools/kyoto-data/region.py, which wrote the data in public/kyoto/.
 */
export const ORIGIN = { lat: 35.0036, lon: 135.7595 };
export const M_PER_DEG_LON = 91284.17129262601;
export const M_PER_DEG_LAT = 110940.6404266756;

export function toLocal(lat: number, lon: number) {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG_LON, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT };
}

/** A box in local metres: [minX, minZ, maxX, maxZ]. */
export type Box = [number, number, number, number];

export const BUILDINGS_BOX: Box = [-9000, -7000, 4600, 6200];

/** Where things are, from OpenStreetMap / Nominatim (checked against the GSI aerial photos). */
export const PLACES = {
  shogunzuka: toLocal(35.0022428, 135.7874304), // 将軍塚青龍殿 大舞台
  kuas: toLocal(35.0099245, 135.7184382), // 京都先端科学大学 太秦キャンパス
};

/** The Uzumasa campus outline (OpenStreetMap way 219715622, © OpenStreetMap contributors). */
export const CAMPUS_OUTLINE: [number, number][] = [
  [-3875.8, -779.8], [-3847.3, -759.2], [-3842.2, -754.2], [-3839.4, -748.5], [-3837.1, -742.8], [-3836.4, -724.8],
  [-3835.8, -709.1], [-3835.4, -694.2], [-3836.6, -674.0], [-3837.8, -627.2], [-3838.2, -622.2], [-3839.4, -616.0],
  [-3812.3, -617.2], [-3811.9, -608.8], [-3806.5, -610.8], [-3800.9, -612.6], [-3677.8, -616.9], [-3673.5, -617.9],
  [-3669.4, -619.6], [-3665.8, -622.1], [-3662.6, -625.2], [-3660.1, -628.9], [-3662.0, -785.3], [-3674.2, -796.4],
  [-3875.7, -792.0],
];

/** Middle of the campus buildings. */
export const CAMPUS_CENTER = { x: -3755, z: -700 };

export function inCampus(x: number, z: number) {
  let inside = false;
  const p = CAMPUS_OUTLINE;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
