/**
 * Build the far-view LOD from the shipped GSI z16 packs and OSM building attributes.
 * Run: node --experimental-strip-types tools/kansai-data/build_skyline.mjs [output-directory]
 *
 * Each gzip JSON row is [heightMetres, minHeightMetres, heightSource, part, rings].
 * Heights: 0 footprint estimate, 1 mapped storeys × 3.1 m, 2 mapped metres,
 * 3 median 3D-GloBFP prediction, 4 bounded blend of footprint and GHSL ANBH.
 * Each unclosed ring is a flat array of x/y pairs in its z12 tile's 16384-unit
 * coordinate space. Outer ring first, then holes. The bounding-box centre owns
 * the footprint, so edges can extend beyond that tile. No ground elevation is baked in.
 */
import {classifyRings, VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import sharp from 'sharp';
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
const predicted = readJson(path.join(data, 'predicted-heights/index.json'));
const regional = readJson(path.join(data, 'heights/index.json'));
const predictedPacks = new Set(predicted.packs);
const regionalTiles = new Set(regional.tiles.map(([x, y]) => x + '/' + y));
const regionalCache = new Map();
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

function blockHeight(lon, lat) {
  const col = Math.floor((lon - regional.origin[0]) / regional.pixelSize[0]);
  const row = Math.floor((regional.origin[1] - lat) / regional.pixelSize[1]);
  const size = regional.tileSize;
  const key = Math.floor(col / size) + '/' + Math.floor(row / size);
  if (!regionalTiles.has(key)) return;
  if (!regionalCache.has(key)) {
    const tile = fs.readFileSync(path.join(data, 'heights', key + '.f32.gz'));
    regionalCache.set(key, gunzipSync(tile));
  }
  return regionalCache.get(key).readFloatLE(8 * ((row % size) * size + col % size));
}

// Select the original skyline first so enrichment preserves its footprints,
// OSM building parts, order, explicitly mapped heights and recorded storeys.
async function enrichHeights(key, rows) {
  const [tx, ty] = key.split('/').map(Number);
  const side = 2 ** (predicted.tileZoom - predicted.packZoom);
  const tileSize = predicted.tileSize;
  const pixelsPerUnit = side * tileSize / extent;
  const packs = new Map(), images = new Map(), targets = new Map();
  for (const row of rows) {
    if (row.source !== 0) continue;
    const values = [];
    const ring = row.rings[0];
    const xs = ring.filter((_, i) => i % 2 === 0), ys = ring.filter((_, i) => i % 2 === 1);
    const west = Math.min(...xs), north = Math.min(...ys);
    const width = Math.max(...xs) - west, height = Math.max(...ys) - north;
    targets.set(row, {values, x: west + width / 2, y: north + height / 2});
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = west + width * (i + .5) / 5, y = north + height * (j + .5) / 5;
      if (!inside(row, x, y)) continue;
      const px = tx * side * tileSize + Math.floor(x * pixelsPerUnit);
      const py = ty * side * tileSize + Math.floor(y * pixelsPerUnit);
      const sx = Math.floor(px / tileSize), sy = Math.floor(py / tileSize);
      const packKey = Math.floor(sx / side) + '/' + Math.floor(sy / side);
      if (!predictedPacks.has(packKey)) continue;
      const imageKey = sx + '/' + sy;
      if (!images.has(imageKey)) {
        if (!packs.has(packKey)) {
          packs.set(packKey, fs.readFileSync(path.join(data, 'predicted-heights', packKey.replace('/', '-') + '.bin')));
        }
        const pack = packs.get(packKey), offset = 4 * ((sy % side) * side + sx % side);
        const from = pack.readUInt32LE(offset), to = pack.readUInt32LE(offset + 4);
        images.set(imageKey, from === to ? null : {png: pack.subarray(from, to), samples: []});
      }
      const image = images.get(imageKey);
      if (image) image.samples.push([values, (py % tileSize) * tileSize + px % tileSize]);
    }
  }
  await Promise.all([...images.values()].filter(Boolean).map(async image => {
    const {data: pixels, info} = await sharp(image.png).raw().toBuffer({resolveWithObject: true});
    if (info.width !== tileSize || info.height !== tileSize || info.channels !== 3) throw Error('Unexpected height PNG format');
    for (const [values, pixel] of image.samples) {
      const dm = 256 * pixels[pixel * 3] + pixels[pixel * 3 + 1];
      if (dm > 0) values.push(dm / 10);
    }
  }));
  for (const [row, {values, x, y}] of targets) {
    if (values.length) {
      values.sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      const height = tenth(values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2);
      if (height > row.minHeight) {
        row.height = height; row.source = 3;
        continue;
      }
    }
    const block = blockHeight(...lonLat(tx + x / extent, ty + y / extent, zoom));
    if (!(block > 0)) continue;
    const h = row.height;
    const height = tenth(Math.max(h * .5, Math.min(h * 2, (h + block) / 2)));
    if (height > row.minHeight) { row.height = height; row.source = 4; }
  }
}

fs.mkdirSync(output, {recursive: true});
const countNames = ['estimated', 'mappedLevels', 'mappedHeight', 'predictedHeight', 'blockHeight'];
const counts = {footprints: 0, mappedHeight: 0, mappedLevels: 0, predictedHeight: 0, blockHeight: 0, estimated: 0, parts: 0, bytes: 0};
const perPrefecture = {}, tiles = [];
for (const key of [...packOwners.keys()].sort()) {
  const rows = buildTile(key);
  if (!rows.length) continue;
  await enrichHeights(key, rows);
  tiles.push(key);
  const content = rows.map(r => {
    counts.footprints++;
    counts[countNames[r.source]]++;
    counts.parts += r.part;
    perPrefecture[r.pref] = (perPrefecture[r.pref] ?? 0) + 1;
    return [r.height, r.minHeight, r.source, r.part, r.rings];
  });
  const buffer = gzipSync(JSON.stringify(content), {level: 9});
  counts.bytes += buffer.length;
  fs.writeFileSync(path.join(output, key.replace('/', '-') + '.json.gz'), buffer);
}
if (Object.keys(perPrefecture).length !== 5 || countNames.some(name => !counts[name])) {
  throw new Error('Incomplete skyline source coverage');
}
const index = {zoom, extent, tiles, counts, perPrefecture,
  heightSources: ['estimated from footprint', 'mapped storeys × 3.1 m', 'mapped height in metres',
    'median of positive 3D-GloBFP predicted heights sampled on a 5 × 5 interior grid',
    'mean of footprint estimate and GHSL block-average net building height, bounded to 0.5–2 times the footprint estimate'],
  sources: [network.sourceInfo, attributes.source, predicted.sourceUrl, regional.sourceUrl],
  heightData: [predicted, regional].map(({source, sourceUrl, epoch, license, licenseUrl}) => ({source, sourceUrl, epoch, license, licenseUrl})),
  attribution: '国土地理院最適化ベクトルタイルを加工 / © OpenStreetMap contributors / Che et al., 3D-GloBFP / Pesaresi & Politis, European Commission JRC, GHS-BUILT-H R2023A',
  licenseUrl: attributes.licenseUrl};
fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify(index) + '\n');
console.log(JSON.stringify({tiles: tiles.length, counts, perPrefecture}));
