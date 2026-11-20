export type Eye = { x: number; y: number; z: number };
type Indices = Uint16Array | Uint32Array;
export type CityShape = {
  positions: Float32Array; normals: Float32Array; roles: Float32Array; levels?: Float32Array;
  indices: Indices; stepped: boolean; overview: boolean;
};
export type CityInstances = {
  shape: CityShape; pos: Float32Array; size: Float32Array; rot: Float32Array; meta: Float32Array;
};
export type CitySurface = CityInstances | { positions: Float32Array; info?: Float32Array };
export type FaceBatch = { houses: Uint32Array; indices: Uint16Array };
export type VisibleSurface = { batches: FaceBatch[] } | { indices: Uint32Array };

// A fixed-eye perspective plane looking west, independent of the screen, camera rotation or zoom.
// Every occupied cell must be covered in full. Values are upper bounds on occluder depth.
class Occlusion {
  private width = 8192;
  private height = 1024;
  private depths = new Float32Array(this.width * this.height).fill(Infinity);
  readonly eye: Eye;
  constructor(eye: Eye) { this.eye = eye; }
  x(z: number, d: number) { return (z / d + 1.6) * (this.width / 3.2); }
  y(y: number, d: number) { return (y / d + .4) * (this.height / .55); }

  solid(left: number, right: number, low: number, high: number, depth: number) {
    const x0 = Math.max(0, Math.ceil(left)), x1 = Math.min(this.width, Math.floor(right));
    const y0 = Math.max(0, Math.ceil(low)), y1 = Math.min(this.height, Math.floor(high));
    const far = depth + .25;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = y * this.width + x;
      if (far < this.depths[k]) this.depths[k] = far;
    }
  }

  triangle(p: Float32Array | Float64Array, a: number, b: number, c: number) {
    a *= 3; b *= 3; c *= 3;
    const da = this.eye.x - p[a], db = this.eye.x - p[b], dc = this.eye.x - p[c];
    if (Math.min(da, db, dc) < 100) return;
    const ax=this.x(p[a+2]-this.eye.z,da), bx=this.x(p[b+2]-this.eye.z,db), cx=this.x(p[c+2]-this.eye.z,dc);
    const ay=this.y(p[a+1]-this.eye.y,da), by=this.y(p[b+1]-this.eye.y,db), cy=this.y(p[c+1]-this.eye.y,dc);
    // Positive z on this plane points screen-left. Only a front-facing, fully covered cell can hide anything.
    const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    if (area > -2) return;
    const l=Math.max(0, Math.ceil(Math.min(ax,bx,cx))), r=Math.min(this.width,Math.floor(Math.max(ax,bx,cx)));
    const lo=Math.max(0,Math.ceil(Math.min(ay,by,cy))), hi=Math.min(this.height,Math.floor(Math.max(ay,by,cy)));
    const dx0=by-ay, dy0=ax-bx, dx1=cy-by, dy1=bx-cx, dx2=ay-cy, dy2=cx-ax;
    const bias = (x:number,y:number) => Math.min(0,x)+Math.min(0,y)-.12*(Math.abs(x)+Math.abs(y));
    const k0=bias(dx0,dy0)-dx0*ax-dy0*ay, k1=bias(dx1,dy1)-dx1*bx-dy1*by, k2=bias(dx2,dy2)-dx2*cx-dy2*cy;
    const far=Math.max(da,db,dc)+.25;
    for(let y=lo;y<hi;y++){
      let e0=dx0*l+dy0*y+k0, e1=dx1*l+dy1*y+k1, e2=dx2*l+dy2*y+k2;
      for(let x=l;x<r;x++,e0+=dx0,e1+=dx1,e2+=dx2){
        const i=y*this.width+x;
        if (e0>0 && e1>0 && e2>0 && far<this.depths[i]) this.depths[i]=far;
      }
    }
  }

  hidden(left: number, right: number, low: number, high: number, near: number) {
    if (near < 100 || left < 0 || right >= this.width || low < 0 || high >= this.height) return false;
    const x0 = Math.floor(left), x1 = Math.floor(right), y0 = Math.floor(low), y1 = Math.floor(high);
    for (let y = y1; y >= y0; y--) for (let x = x0; x <= x1; x++) {
      if (this.depths[y * this.width + x] >= near - .25) return false;
    }
    return true;
  }
}

// The inset wall volume is opaque for flat, sloped and stepped roofs. Across the entire
// angular footprint every ray between these two conservative heights intersects the house.
function addHouses(map: Occlusion, src: CityInstances) {
  for (let i = 0; i < src.rot.length; i++) {
    const k = i * 3, m = i * 4;
    if (src.meta[m] > 767.5) continue; // The detailed campus can replace these walls.
    const w = src.size[k] * .5 - .05, d = src.size[k + 2] * .5 - .05;
    const west = map.eye.x - src.pos[k], z = src.pos[k + 2] - map.eye.z;
    if (west < 100 + w + d || Math.abs(z) > 1.6 * west + 3 * (w + d)) continue;
    const floor = src.pos[k + 1] - map.eye.y - 5.95;
    const eave = src.pos[k + 1] - map.eye.y + src.size[k + 1] - .5 * src.meta[m + 3] - .07;
    const c = Math.cos(src.rot[i]), s = Math.sin(src.rot[i]);
    let left = Infinity, right = -Infinity, low = -Infinity, high = Infinity, far = 0;
    for (let j = 0; j < 4; j++) {
      const a = j & 1 ? w : -w, b = j & 2 ? d : -d;
      const depth = west - (c * a - s * b), px = map.x(z + s * a + c * b, depth);
      left = Math.min(left, px); right = Math.max(right, px);
      low = Math.max(low, map.y(floor, depth)); high = Math.min(high, map.y(eave, depth));
      far = Math.max(far, depth);
    }
    map.solid(left, right, low, high, far);
  }
}

// Decode the same metre-space unit roof as INSTANCE_VS, solely for conservative visibility.
// The final draw still uses the original indexed shape, shader and instance attributes.
function housePoints(src: CityInstances, i: number, eye: Eye, out: Float64Array) {
  const { shape } = src, k = i * 3, m = i * 4;
  const w = src.size[k], h = src.size[k + 1], d = src.size[k + 2];
  const hip = src.meta[m + 2] > 1.5, rh = src.meta[m + 3];
  const eave = src.meta[m + 2] > .5 ? h - rh * .5 : h, overhang = Math.min(.55, d * .07);
  const c = Math.cos(src.rot[i]), s = Math.sin(src.rot[i]);
  const ex = eye.x - src.pos[k], ez = eye.z - src.pos[k + 2];
  for (let j = 0; j < shape.roles.length; j++) {
    const a = j * 3, role = shape.roles[j];
    let px = shape.positions[a], pz = shape.positions[a + 2];
    const py = shape.positions[a + 1];
    if (shape.overview && role === 0) {
      const facing = shape.normals[a] > .5 ? ex * c + ez * s : -ex * s + ez * c;
      if (facing < 0) { px = -px; pz = -pz; }
    }
    let x = px * w, z = pz * d, y = py < .5 ? -6 : eave + Math.max(py - 1, 0) * rh;
    if (shape.stepped && role > .5) {
      const level = shape.levels![j], lv = level - (Math.abs(px) < .4 ? .5 / 3 : 0);
      x = Math.sign(px) * Math.max(w * .5 - (hip ? (.5 - lv) * d : 0), Math.min(w * .5, lv * d));
      if (level >= .49) {
        x += Math.sign(px) * overhang;
        if (Math.abs(pz) >= .49) z += Math.sign(pz) * overhang;
      }
    } else if (!shape.stepped) {
      if (py > 1.5) { x = Math.sign(px) * Math.max(w * .5 - (hip ? d * .5 : 0), 0); z = 0; }
      if ((role === 1 || (role === 2 && hip)) && py < 1.5) {
        x += Math.sign(px) * overhang; z += Math.sign(pz) * overhang;
        y -= overhang * rh / Math.max(d * .5, 1);
      } else if (role === 1 && py > 1.5 && !hip) x += Math.sign(px) * overhang;
    }
    out[a] = src.pos[k] + c * x - s * z;
    out[a + 1] = src.pos[k + 1] + y;
    out[a + 2] = src.pos[k + 2] + s * x + c * z;
  }
}

function visibleTriangle(p: Float64Array | Float32Array, a: number, b: number, c: number, map: Occlusion) {
  a *= 3; b *= 3; c *= 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const { eye } = map, da = eye.x - p[a], db = eye.x - p[b], dc = eye.x - p[c];
  const facing = nx * da + ny * (eye.y - p[a + 1]) + nz * (eye.z - p[a + 2]);
  if (facing < -.12 * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz))) return false;
  const near = Math.min(da,db,dc);
  if (near <= 100) return true;
  const ax = map.x(p[a + 2] - eye.z, da), bx = map.x(p[b + 2] - eye.z, db), cx = map.x(p[c + 2] - eye.z, dc);
  const ay = map.y(p[a + 1] - eye.y, da), by = map.y(p[b + 1] - eye.y, db), cy = map.y(p[c + 1] - eye.y, dc);
  // Expand the silhouette for floating-point vertex placement and raster edge rounding.
  return !map.hidden(Math.min(ax,bx,cx) - .15, Math.max(ax,bx,cx) + .15,
    Math.min(ay,by,cy) - .15, Math.max(ay,by,cy) + .15, near);
}

type Bucket = { mask: Uint32Array; houses: number[]; count: number };
function population(v: number) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function instanceBatches(src: CityInstances, map: Occlusion): FaceBatch[] {
  const idx = src.shape.indices, triangles = idx.length / 3, groups = new Map<string, Bucket>();
  const words = new Uint32Array(Math.ceil(triangles / 32)), p = new Float64Array(src.shape.positions.length);
  for (let i = 0; i < src.rot.length; i++) {
    housePoints(src, i, map.eye, p);
    words.fill(0); let count = 0;
    for (let t = 0; t < triangles; t++) {
      if (visibleTriangle(p, idx[t*3], idx[t*3+1], idx[t*3+2], map)) {
        words[t >>> 5] |= 1 << (t & 31); count++;
      }
    }
    if (!count) continue;
    const key = words.join(',');
    let group = groups.get(key);
    if (!group) { group = { mask: words.slice(), houses: [], count }; groups.set(key,group); }
    group.houses.push(i);
  }
  // A shared draw may conservatively include extra faces. Bound draw calls per large city block.
  const ordered = [...groups.values()].sort((a,b) => b.houses.length - a.houses.length);
  const limit = Math.min(12, Math.max(2, Math.ceil(src.rot.length / 350)));
  const chosen = ordered.slice(0, limit);
  for (const extra of ordered.slice(limit)) {
    let best = chosen[0], cost = Infinity, joinedCount = 0;
    for (const base of chosen) {
      let union = 0;
      for (let j=0; j<words.length; j++) union += population(base.mask[j] | extra.mask[j]);
      const waste = (union - base.count) * base.houses.length + (union - extra.count) * extra.houses.length;
      if (waste < cost) { best = base; cost = waste; joinedCount = union; }
    }
    for (let j=0; j<words.length; j++) best.mask[j] |= extra.mask[j];
    best.count = joinedCount;
    for (const house of extra.houses) best.houses.push(house);
  }
  return chosen.map(group => {
    const indices = new Uint16Array(group.count * 3);
    let next = 0;
    for (let t=0; t<triangles; t++) if (group.mask[t >>> 5] & (1 << (t & 31))) {
      for (let j=0; j<3; j++) indices[next++] = idx[t*3+j];
    }
    return { indices, houses: Uint32Array.from(group.houses.sort((a,b) => a-b)) };
  });
}

export function panoramaVisibility(sources: CitySurface[], eye: Eye): VisibleSurface[] {
  const map = new Occlusion(eye);
  for (const src of sources) {
    if ('shape' in src) {
      addHouses(map, src);
      const p = new Float64Array(src.shape.positions.length), idx = src.shape.indices;
      for (let i=0; i<src.rot.length; i++) {
        if (eye.x-src.pos[i*3] < 100 || src.meta[i*4] > 767.5) continue;
        housePoints(src, i, eye, p);
        for (let j=0; j<idx.length; j+=3) map.triangle(p,idx[j],idx[j+1],idx[j+2]);
      }
    } else for (let i=0; i<src.positions.length/3; i+=3) {
      if (!src.info || src.info[i*4] <= 767.5) map.triangle(src.positions,i,i+1,i+2);
    }
  }
  return sources.map(src => {
    if ('shape' in src) return { batches: instanceBatches(src, map) };
    const indices: number[] = [];
    for (let i=0; i<src.positions.length/3; i+=3) {
      if (visibleTriangle(src.positions, i,i+1,i+2, map)) indices.push(i,i+1,i+2);
    }
    return { indices: Uint32Array.from(indices) };
  });
}
