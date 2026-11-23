/**
 * Derive the distant Kyoto Station district from the surveyed detail model.
 *
 *   node tools/kyoto-data/build-station-far.mjs
 *
 * Reads public/kyoto/kyoto-station-district.glb and writes
 * public/kyoto/kyoto-station-district-far.glb with the same materials, node
 * transform and vertex encoding. Each primitive is simplified to a geometric
 * error below a pixel at the distance where the detail model hands over, small
 * disconnected parts are pruned, and the photo atlases are reduced to match.
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier} from 'meshoptimizer';

const root = fileURLToPath(new URL('../../public/kyoto/', import.meta.url));
const SOURCE = root + 'kyoto-station-district.glb';
const OUTPUT = root + 'kyoto-station-district-far.glb';
// The detail model is drawn within 1.1-1.45 km, where a pixel spans just over a metre.
const ERROR = 1;
// Atlases keep a quarter of their width: a texel still covers less than a pixel at 1.1 km.
const TEXTURE_SCALE = .25;
const WEBP_QUALITY = 72;
// Tuned by eye against the detail model at 600 m: collapsing across a photo seam
// is charged for the atlas shift, so facades do not smear, while the survey's
// noisy per-face normals carry almost no weight (the shader relights walls).
const UV_WEIGHT = ERROR * 512 / 20;
const NORMAL_WEIGHT = ERROR / 22.5;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const TYPES = {5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array};
const COMPONENTS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
const NORMALIZED = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535};

function readGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  const views = json.bufferViews.map(view => {
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (!meshopt) return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const out = new Uint8Array(meshopt.count * meshopt.byteStride);
    const start = meshopt.byteOffset ?? 0;
    MeshoptDecoder.decodeGltfBuffer(out, meshopt.count, meshopt.byteStride,
      bin.subarray(start, start + meshopt.byteLength), meshopt.mode, meshopt.filter);
    return out;
  });
  return {json, views};
}

/** One accessor's elements, tightly packed, in its stored component type. */
function accessorData({json, views}, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const Type = TYPES[accessor.componentType];
  const width = COMPONENTS[accessor.type];
  const stride = (view.byteStride ?? view.extensions?.EXT_meshopt_compression?.byteStride ?? width * Type.BYTES_PER_ELEMENT) / Type.BYTES_PER_ELEMENT;
  const raw = views[accessor.bufferView];
  const source = new Type(raw.buffer, raw.byteOffset + (accessor.byteOffset ?? 0), (accessor.count - 1) * stride + width);
  const out = new Type(accessor.count * width);
  for (let i = 0; i < accessor.count; i++) for (let c = 0; c < width; c++) out[i * width + c] = source[i * stride + c];
  return {accessor, data: out, width};
}

function metres({accessor, data}, node) {
  const scale = accessor.normalized ? 1 / NORMALIZED[accessor.componentType] : 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    out[i] = Math.max(data[i] * scale, accessor.normalized ? -1 : -Infinity) * node.scale[c] + node.translation[c];
  }
  return out;
}

/** Photo atlas coordinates, after the material's texture transform. */
function atlasUv(uv, material) {
  const transform = material.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;
  const scale = uv.accessor.normalized ? 1 / NORMALIZED[uv.accessor.componentType] : 1;
  const [sx, sy] = transform?.scale ?? [1, 1], [ox, oy] = transform?.offset ?? [0, 0];
  return Float32Array.from(uv.data, (v, i) => v * scale * (i % 2 ? sy : sx) + (i % 2 ? oy : ox));
}

/** Simplify to ERROR metres, allowing collapses across seams at the cost of their attribute error. */
function simplify(indices, positions, uv, normal) {
  const width = (uv ? 2 : 0) + (normal ? 3 : 0);
  const weights = [...(uv ? [UV_WEIGHT, UV_WEIGHT] : []), ...(normal ? [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT] : [])];
  const count = positions.length / 3;
  const attributes = new Float32Array(count * width);
  for (let i = 0; i < count; i++) {
    let c = i * width;
    if (uv) { attributes[c++] = uv[i * 2]; attributes[c++] = uv[i * 2 + 1]; }
    if (normal) for (let k = 0; k < 3; k++) attributes[c++] = normal[i * 3 + k];
  }
  const [lod] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, width, weights, null,
    0, ERROR, ['ErrorAbsolute', 'Prune', 'Permissive']);
  return lod;
}

function unitNormals({accessor, data}) {
  const scale = accessor.normalized ? 1 / NORMALIZED[accessor.componentType] : 1;
  return Float32Array.from(data, v => v * scale);
}

const source = readGlb(SOURCE);
const {json} = source;
const node = json.nodes.find(n => n.mesh !== undefined);
const out = {
  asset: {...json.asset, extras: {source: 'kyoto-station-district.glb', error: ERROR, textureScale: TEXTURE_SCALE}},
  extensionsUsed: json.extensionsUsed, extensionsRequired: json.extensionsRequired,
  buffers: [{byteLength: 0}], bufferViews: [], accessors: [],
  samplers: json.samplers, images: [], textures: json.textures, materials: json.materials,
  meshes: [], nodes: json.nodes, scenes: json.scenes, scene: json.scene,
};
const chunks = [];
let offset = 0;
function pushBytes(bytes) {
  const view = {buffer: 0, byteOffset: offset, byteLength: bytes.byteLength};
  chunks.push(bytes);
  offset += bytes.byteLength;
  const pad = (4 - offset % 4) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
  out.bufferViews.push(view);
  return out.bufferViews.length - 1;
}
// Compressed views name an empty fallback buffer: the extension is required.
let fallback = 0;
/** Meshopt-compress a vertex or index stream. */
function pushStream(array, count, mode, target) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const stride = bytes.byteLength / count;
  const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
  const index = pushBytes(encoded);
  const view = out.bufferViews[index];
  fallback = Math.max(fallback, bytes.byteLength);
  out.bufferViews[index] = {buffer: 1, byteOffset: 0, byteLength: bytes.byteLength, ...(mode !== 'TRIANGLES' && {byteStride: stride}), target,
    extensions: {EXT_meshopt_compression: {buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength, byteStride: stride, mode, count}}};
  return index;
}

let before = 0, after = 0;
for (const mesh of json.meshes) {
  const primitives = [];
  for (const primitive of mesh.primitives) {
    const position = accessorData(source, primitive.attributes.POSITION);
    const indices = Uint32Array.from(accessorData(source, primitive.indices).data);
    const material = json.materials[primitive.material];
    const uv = primitive.attributes.TEXCOORD_0 === undefined ? null : atlasUv(accessorData(source, primitive.attributes.TEXCOORD_0), material);
    const normal = primitive.attributes.NORMAL === undefined ? null : unitNormals(accessorData(source, primitive.attributes.NORMAL));
    const simplified = simplify(indices, metres(position, node), uv, normal);
    before += indices.length / 3;
    after += simplified.length / 3;
    if (!simplified.length) continue;
    // Keep only referenced vertices, in first-use order for vertex fetch locality.
    const local = Uint32Array.from(simplified);
    const [remap, count] = MeshoptEncoder.reorderMesh(local, true, false);
    const used = new Uint32Array(count);
    remap.forEach((next, old) => { if (next !== 0xffffffff) used[next] = old; });
    const IndexType = used.length < 65536 ? Uint16Array : Uint32Array;
    const indexData = IndexType.from(local);
    out.accessors.push({bufferView: pushStream(indexData, indexData.length, 'TRIANGLES', 34963),
      componentType: IndexType === Uint16Array ? 5123 : 5125, count: indexData.length, type: 'SCALAR'});
    const indicesAccessor = out.accessors.length - 1;
    const attributes = {};
    for (const [name, accessorIndex] of Object.entries(primitive.attributes)) {
      const {accessor, data, width} = accessorData(source, accessorIndex);
      const Type = data.constructor;
      // Vertex streams must have 4-byte aligned elements.
      const padded = Math.ceil(width * Type.BYTES_PER_ELEMENT / 4) * 4 / Type.BYTES_PER_ELEMENT;
      const packed = new Type(used.length * padded);
      const min = new Array(width).fill(Infinity), max = new Array(width).fill(-Infinity);
      used.forEach((v, i) => {
        for (let c = 0; c < width; c++) {
          const value = data[v * width + c];
          packed[i * padded + c] = value;
          min[c] = Math.min(min[c], value);
          max[c] = Math.max(max[c], value);
        }
      });
      const view = pushStream(packed, used.length, 'ATTRIBUTES', 34962);
      out.accessors.push({bufferView: view, componentType: accessor.componentType, count: used.length, type: accessor.type,
        ...(accessor.normalized && {normalized: true}), ...(name === 'POSITION' && {min, max})});
      attributes[name] = out.accessors.length - 1;
    }
    primitives.push({...primitive, attributes, indices: indicesAccessor});
  }
  out.meshes.push({...mesh, primitives});
}

for (const image of json.images) {
  const bytes = source.views[image.bufferView];
  const photo = sharp(Buffer.from(bytes));
  const {width, height} = await photo.metadata();
  const reduced = await photo.resize(Math.max(16, Math.round(width * TEXTURE_SCALE)), Math.max(16, Math.round(height * TEXTURE_SCALE)), {kernel: 'lanczos3'})
    .webp({quality: WEBP_QUALITY, effort: 6}).toBuffer();
  out.images.push({...image, bufferView: pushBytes(new Uint8Array(reduced))});
}

out.buffers[0].byteLength = offset;
out.buffers.push({byteLength: fallback, extensions: {EXT_meshopt_compression: {fallback: true}}});

const text = Buffer.from(JSON.stringify(out));
const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
const binChunk = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHeader = (length, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(length, 0); b.write(type, 4, 'ascii'); return b; };
fs.writeFileSync(OUTPUT, Buffer.concat([header, chunkHeader(jsonChunk.length, 'JSON'), jsonChunk, chunkHeader(binChunk.length, 'BIN\0'), binChunk]));
console.log(`${before} -> ${after} triangles, ${fs.statSync(OUTPUT).size} bytes`);
