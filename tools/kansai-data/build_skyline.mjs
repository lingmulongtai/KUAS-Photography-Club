/**
 * Build the far-view LOD from the shipped GSI z16 packs and OSM building attributes.
 * Run: node --experimental-strip-types tools/kansai-data/build_skyline.mjs [output-directory]
 *
 * Each gzip JSON row is [heightMetres, minHeightMetres, heightSource, part, rings].
 * Height sources: 2 = mapped height, 1 = mapped storeys × 3.1 m, 0 = estimated.
 * Each unclosed ring is a flat array of x/y pairs in its z12 tile's 16384-unit
 * coordinate space. Outer ring first, then holes. The bounding-box centre owns
 * the footprint, so edges can extend beyond that tile. No ground elevation is baked in.
 */
import {classifyRings, VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync, gunzipSync} from 'node:zlib';
import {lonLat, prefectureLookup, tileXY} from '../../src/scripts/kansai/coordinates.ts';

const data = fileURLToPath(new URL('../../public/kansai/', import.meta.url));
const output = process.argv[2] ?? path.join(data, 'skyline');
const extent = 16384;
const zoom = 12;
const cellSize = 384; // About 185 metres in Kansai.
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const network = readJson(path.join(data, 'network/index.json'));
const attributes = readJson(path.join(data, 'building-attributes/index.json'));
const owner = prefectureLookup(readJson(path.join(data, 'prefectures.json')).features);
const attributeTiles = new Set(attributes.tiles);
const packOwners = new Map();
for (const [pref, keys] of Object.entries(network.prefectures)) {
  for (const key of keys) {
    if (!packOwners.has(key)) packOwners.set(key, []);
    packOwners.get(key).push(pref);
  }
}
for (const key of attributeTiles) if (!packOwners.has(key)) packOwners.set(key, []);

function packRing(points, project, subdivisions = 16) {
  const ring = [];
  for (const point of points) {
    const [u, v] = project(point);
    const x = Math.round(u * subdivisions) / subdivisions, y = Math.round(v * subdivisions) / subdivisions;
    if (x !== ring.at(-2) || y !== ring.at(-1)) ring.push(x, y);
  }
  if (ring.length >= 4 && ring[0] === ring.at(-2) && ring[1] === ring.at(-1)) ring.length -= 2;
  return ring;
}

function twiceArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return area;
}

function contains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const a = ring[i], b = ring[i + 1], c = ring[j], d = ring[j + 1];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}

function inside(row, x, y) {
  return contains(row.rings[0], x, y) && !row.rings.slice(1).some(r => contains(r, x, y));
}

function intersects(a, b) {
  if (Math.max(a[0], a[2]) < Math.min(b[0], b[2]) || Math.min(a[0], a[2]) > Math.max(b[0], b[2]) ||
      Math.max(a[1], a[3]) < Math.min(b[1], b[3]) || Math.min(a[1], a[3]) > Math.max(b[1], b[3])) return false;
  const side = (s, x, y) => (s[2] - s[0]) * (y - s[1]) - (s[3] - s[1]) * (x - s[0]);
  return side(a, b[0], b[1]) * side(a, b[2], b[3]) <= 0 && side(b, a[0], a[1]) * side(b, a[2], a[3]) <= 0;
}

// Rounding can join opposite sides of a narrow ring. Try a finer grid for
// these footprints; never feed a self-crossing shell or courtyard to the renderer.
function validRings(rings) {
  const prior = [];
  for (const [number, ring] of rings.entries()) {
    if (ring.length < 6 || twiceArea(ring) === 0) return false;
    if (number && (!contains(rings[0], ring[0], ring[1]) ||
        rings.slice(1, number).some(other => contains(other, ring[0], ring[1]) || contains(ring, other[0], other[1])))) return false;
    const edges = [];
    for (let i = 0; i < ring.length; i += 2) {
      const next = (i + 2) % ring.length;
      const edge = [ring[i], ring[i + 1], ring[next], ring[next + 1]];
      if (prior.some(other => intersects(edge, other))) return false;
      for (let j = 0; j < edges.length - 1; j++) {
        if ((next || j) && intersects(edge, edges[j])) return false;
      }
      edges.push(edge);
    }
    prior.push(...edges);
  }
  return true;
}

function compact(rings, sameOwner) {
  const coarse = rings.map(ring => {
    const pairs = [];
    for (let i = 0; i < ring.length; i += 2) pairs.push([ring[i], ring[i + 1]]);
    return packRing(pairs, p => p, 1);
  });
  if (validRings(coarse) && sameOwner(coarse)) return coarse;
  if (validRings(rings)) return rings;
}

function footprint(rings, metresPerUnit) {
  if (rings[0]?.length < 6 || !rings.length) return;
  const shell = rings[0], area = Math.abs(twiceArea(shell));
  if (!area) return;
  let west = Infinity, north = Infinity, east = -Infinity, south = -Infinity;
  for (let i = 0; i < shell.length; i += 2) {
    west = Math.min(west, shell[i]); east = Math.max(east, shell[i]);
    north = Math.min(north, shell[i + 1]); south = Math.max(south, shell[i + 1]);
  }
  rings = [shell, ...rings.slice(1).filter(r => r.length >= 6 && twiceArea(r) !== 0)];
  const filled = area - rings.slice(1).reduce((sum, r) => sum + Math.abs(twiceArea(r)), 0);
  const size = filled * metresPerUnit ** 2 / 2;
  if (size < 3) return;
  return {rings, size, west, north, east, south, x: (west + east) / 2, y: (north + south) / 2};
}

// A small spatial index limits footprint comparisons in Osaka's densest tiles.
function binsFor(row, visit) {
  const x0 = Math.max(-4, Math.floor(row.west / 128)), x1 = Math.min(131, Math.floor(row.east / 128));
  const y0 = Math.max(-4, Math.floor(row.north / 128)), y1 = Math.min(131, Math.floor(row.south / 128));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit((y + 4) * 136 + x + 4);
}

const tenth = n => Math.round(n * 10) / 10;
function vertical(row, tag, code) {
  const source = tag?.height > 0 ? 2 : tag?.levels > 0 ? 1 : 0;
  const mapped = source === 2 ? tag.height : source === 1 ? tag.levels * 3.1 : undefined;
  const inferred = code === 3103 ? 40 : code === 3102 ? Math.min(33, 8 + Math.sqrt(row.size) * .24)
    : row.size > 360 ? 9.5 : 6.7;
  row.height = tenth(mapped ?? inferred);
  row.minHeight = tenth(Math.max(0, tag?.minHeight ?? (tag?.minLevel ?? 0) * 3.1));
  row.source = source;
  row.part = tag?.part ? 1 : 0;
}

function buildTile(key) {
  const [x, y] = key.split('/').map(Number);
  const filename = key.replace('/', '-');
  const metresPerUnit = 40075016.7 * Math.cos(lonLat(x, y + .5, zoom)[1] * Math.PI / 180) / (2 ** zoom * extent);
  const cells = new Map(), principal = new Set(), osmBins = new Map(), osmRows = [];
  function consider(row, code, landmarkPart = false) {
    if (row.x < 0 || row.y < 0 || row.x >= extent || row.y >= extent || row.height <= row.minHeight) return;
    const cell = Math.floor(row.y / cellSize) * 64 + Math.floor(row.x / cellSize);
    row.score = row.height * Math.sqrt(Math.sqrt(row.size));
    const prominent = landmarkPart || code === 3103 || row.size >= 4000 || row.height >= 35 ||
      (row.part && row.height >= 18 && row.size >= 40);
    if (!prominent && row.score <= (cells.get(cell)?.score ?? 0)) return;
    const pref = owner(lonLat(x + row.x / extent, y + row.y / extent, zoom));
    if (!pref) return;
    row.pref = pref;
    if (prominent) principal.add(row);
    if (row.score > (cells.get(cell)?.score ?? 0)) cells.set(cell, row);
  }
  if (attributeTiles.has(key)) {
    const tags = JSON.parse(gunzipSync(fs.readFileSync(path.join(data, 'building-attributes', filename + '.json.gz'))));
    const project = ([lon, lat]) => {
      const [col, line] = tileXY(lon, lat, zoom);
      return [(col - x) * extent, (line - y) * extent];
    };
    for (const tag of tags) for (const polygon of tag.polygons) {
      const row = footprint(polygon.map(ring => packRing(ring, project)), metresPerUnit);
      if (!row) continue;
      vertical(row, tag, 0);
      if (row.height <= row.minHeight) continue;
      osmRows.push(row);
      binsFor(row, slot => {
        if (!osmBins.has(slot)) osmBins.set(slot, []);
        osmBins.get(slot).push(row);
      });
    }
  }
  const replaced = new Set(), landmarkParts = new Set();
  for (const row of osmRows) {
    if (row.part) continue;
    const parts = new Set();
    binsFor(row, slot => {
      for (const part of osmBins.get(slot) ?? []) if (part.part && part.size <= row.size * 1.05 &&
          inside(row, part.x, part.y)) parts.add(part);
    });
    // A tower's height can be tagged on both its parent and its occupied upper
    // floors. Drawing the whole enclosing station at that height hides its podium.
    if (parts.size && (!row.source || [...parts].some(p => p.source && p.height >= row.height * .95))) {
      replaced.add(row);
      if (row.height >= 35 || row.size >= 4000) for (const part of parts) landmarkParts.add(part);
    }
  }
  for (const row of osmRows) if (!replaced.has(row)) consider(row, 0, landmarkParts.has(row));
  const packs = packOwners.get(key).map(pref => fs.readFileSync(path.join(data, 'network', pref, filename + '.bin')));
  const seen = new Set();
  for (let slot = 0; slot < 256; slot++) {
    const pack = packs.find(p => p.readUInt32LE(slot * 4) !== p.readUInt32LE((slot + 1) * 4));
    if (!pack) continue;
    const from = pack.readUInt32LE(slot * 4), to = pack.readUInt32LE((slot + 1) * 4);
    const layer = new VectorTile(new Pbf(gunzipSync(pack.subarray(from, to)))).layers.BldA;
    if (!layer) continue;
    const baseX = (slot % 16) * extent / 16, baseY = (slot >> 4) * extent / 16;
    const project = p => [baseX + p.x * extent / (16 * layer.extent), baseY + p.y * extent / (16 * layer.extent)];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i), code = Number(f.properties.vt_code);
      if (code !== 3101 && code !== 3102 && code !== 3103) continue;
      for (const polygon of classifyRings(f.loadGeometry())) {
        // The source clips at an 80-unit buffer. A truncated face is not a building
        // footprint. A complete copy in a neighbouring source tile can still win.
        if (polygon[0].some(p => p.x <= -80 || p.y <= -80 || p.x >= layer.extent + 80 || p.y >= layer.extent + 80)) continue;
        const row = footprint(polygon.map(ring => packRing(ring, project)), metresPerUnit);
        if (!row) continue;
        if (row.west < baseX + 24 || row.north < baseY + 24 || row.east > baseX + 1000 || row.south > baseY + 1000) {
          const signature = [row.west, row.north, row.east, row.south, twiceArea(row.rings[0])].join('/');
          if (seen.has(signature)) continue;
          seen.add(signature);
        }
        let matched = false;
        binsFor(row, pos => {
          if (!matched) matched = (osmBins.get(pos) ?? []).some(tag =>
            tag.west < row.east && tag.east > row.west && tag.north < row.south && tag.south > row.north &&
            (inside(tag, row.x, row.y) || inside(row, tag.x, tag.y)));
        });
        if (matched) continue;
        vertical(row, null, code);
        consider(row, code);
      }
    }
  }
  for (const row of cells.values()) principal.add(row);
  return [...principal].filter(row => {
    const rings = compact(row.rings, coarse => {
      const snapped = footprint(coarse, metresPerUnit);
      return snapped && snapped.x >= 0 && snapped.y >= 0 && snapped.x < extent && snapped.y < extent &&
        owner(lonLat(x + snapped.x / extent, y + snapped.y / extent, zoom)) === row.pref;
    });
    if (!rings) return false;
    row.rings = rings;
    return true;
  }).sort((a, b) => a.y - b.y || a.x - b.x || a.height - b.height);
}

fs.mkdirSync(output, {recursive: true});
const counts = {footprints: 0, mappedHeight: 0, mappedLevels: 0, estimated: 0, parts: 0, bytes: 0};
const perPrefecture = {}, tiles = [];
for (const key of [...packOwners.keys()].sort()) {
  const rows = buildTile(key);
  if (!rows.length) continue;
  tiles.push(key);
  const content = rows.map(r => {
    counts.footprints++;
    counts[['estimated', 'mappedLevels', 'mappedHeight'][r.source]]++;
    counts.parts += r.part;
    perPrefecture[r.pref] = (perPrefecture[r.pref] ?? 0) + 1;
    return [r.height, r.minHeight, r.source, r.part, r.rings];
  });
  const buffer = gzipSync(JSON.stringify(content), {level: 9});
  counts.bytes += buffer.length;
  fs.writeFileSync(path.join(output, key.replace('/', '-') + '.json.gz'), buffer);
}
if (Object.keys(perPrefecture).length !== 5 || !counts.mappedHeight || !counts.mappedLevels || !counts.estimated) {
  throw new Error('Incomplete skyline source coverage');
}
const index = {zoom, extent, tiles, counts, perPrefecture,
  heightSources: ['estimated from footprint', 'mapped storeys × 3.1 m', 'mapped height in metres'],
  sources: [network.sourceInfo, attributes.source],
  attribution: '国土地理院最適化ベクトルタイルを加工 / © OpenStreetMap contributors',
  licenseUrl: attributes.licenseUrl};
fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify(index) + '\n');
console.log(JSON.stringify({tiles: tiles.length, counts, perPrefecture}));
