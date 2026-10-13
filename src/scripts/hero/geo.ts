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
