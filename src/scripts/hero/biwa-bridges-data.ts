import type { Point } from '../kansai/coordinates';

export interface LakeBridgeSpec {
  name: string;
  /** Exact GSI surveyed endpoints [lat, lon] */
  west: [number, number];
  east: [number, number];
  width: number;
  baseY: number;
  approachH: number;
  archPeakH: number;
  archCenterT: number;
  archWidthT: number;
  pierCount: number;
}

/**
 * Exact GSI RdCL surveyed spans for Lake Biwa's two iconic cross-lake bridges
 * (近江大橋 and 琵琶湖大橋) so they align centimetre-accurately with both shore
 * approaches and stay visible from 20–35 km away.
 */
export const LAKE_BRIDGES: readonly LakeBridgeSpec[] = [
  {
    name: 'omi-ohashi',
    // 近江大橋: Otsu Nionohama (west) -> Kusatsu Yabase (east), ~1.29 km straight across southern Lake Biwa.
    west: [34.99765, 135.89597],
    east: [34.99685, 135.91017],
    width: 19,
    baseY: 85.0,
    approachH: 5.2,
    archPeakH: 18.0,
    archCenterT: 0.44,
    archWidthT: 0.25,
    pierCount: 16,
  },
  {
    name: 'biwako-ohashi',
    // 琵琶湖大橋: Otsu Katata (west) -> Moriyama Imahama (east), ~1.40 km arched main span rising 26.3 m.
    west: [35.12370, 135.92685],
    east: [35.11945, 135.94167],
    width: 15,
    baseY: 85.0,
    approachH: 6.0,
    archPeakH: 26.3,
    archCenterT: 0.36,
    archWidthT: 0.22,
    pierCount: 18,
  },
];

/**
 * True when a GSI RdCL bridge segment midpoint [lon, lat] belongs to Omi Ohashi or Biwako Ohashi,
 * so the tile compiler skips the redundant flat low-level road deck underneath our arched 3D spans.
 */
export function isBiwaBridgeDeck([lon, lat]: Point): boolean {
  for (const b of LAKE_BRIDGES) {
    const minLat = Math.min(b.west[0], b.east[0]) - 0.0005;
    const maxLat = Math.max(b.west[0], b.east[0]) + 0.0005;
    const minLon = Math.min(b.west[1], b.east[1]) - 0.0005;
    const maxLon = Math.max(b.west[1], b.east[1]) + 0.0005;
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
    const dx = (b.east[1] - b.west[1]) * 0.82;
    const dy = b.east[0] - b.west[0];
    const px = (lon - b.west[1]) * 0.82;
    const py = lat - b.west[0];
    const l2 = dx * dx + dy * dy;
    const t = (px * dx + py * dy) / l2;
    if (t < -0.02 || t > 1.02) continue;
    const cx = px - dx * Math.max(0, Math.min(1, t));
    const cy = py - dy * Math.max(0, Math.min(1, t));
    // ~36 m lateral corridor covers both twin decks of Biwako Ohashi & wide deck of Omi Ohashi.
    if (Math.hypot(cx, cy) < 0.00034) return true;
  }
  return false;
}
