import * as THREE from 'three';
import { FIELD, PADDY, type GroundFeature } from './ground-relief-data.ts';

type Point = { x: number; z: number };
type Section = readonly [offset: number, height: number];
export type Elevation = (x: number, z: number) => number;
export const SURFACE = { paddy: 1, field: 2, bund: 3, ridge: 4, gravel: 5, grassBank: 6, rice: 7 } as const;

/** Adjacent faces share positions; the material derives a flat normal for each face. */
export class GroundGeometry {
  positions: number[] = [];
  surface: number[] = [];
  indices: number[] = [];

  vertex(x: number, y: number, z: number, kind: number, seed: number, across = 0, along = 0) {
    const id = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.surface.push(kind, seed, across, along);
    return id;
  }

  geometry() {
    if (!this.indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surface, 4));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function pathPoints(path: Float32Array) {
  const result: Point[] = [];
  for (let i = 0; i < path.length; i += 2) result.push({x: path[i], z: path[i+1]});
  return result;
}

function right(a: Point, b: Point) {
  const dx = b.x-a.x, dz = b.z-a.z, length = Math.hypot(dx,dz) || 1;
  return {x: dz/length, z: -dx/length};
}

/** Sweep a stepped cross-section along the map line. Insert ground samples on
 * long edges so the sides stay embedded as the DEM rises or falls. */
export function groundRibbon(out: GroundGeometry, path: Point[], closed: boolean, profile: readonly Section[],
  elevation: Elevation, kind: number, seed: number, rowAxis?: Point) {
  const count = path.length;
  if (count < 2) return;
  const directions = path.map((p,i) => right(p, path[(i+1)%count]));
  const offsets = path.map((_, i) => {
    if (!closed && i === 0) return directions[0];
    if (!closed && i === count-1) return directions[i-1];
    const a = directions[(i+count-1)%count], b = directions[i];
    const divisor = Math.max(.45, 1+a.x*b.x+a.z*b.z);
    return {x: (a.x+b.x)/divisor, z: (a.z+b.z)/divisor};
  });
  let previous = -1;
  const section = (x: number, z: number, nx: number, nz: number) => {
    const first = out.positions.length/3;
    for (const [offset, height] of profile) {
      const px = x+offset*nx, pz = z+offset*nz;
      const along=rowAxis?px*rowAxis.x+pz*rowAxis.z:0;
      out.vertex(px, elevation(px,pz)+height, pz, kind, seed,0,along);
    }
    if (previous >= 0) for (let j = 1; j < profile.length; j++) {
      const a = previous+j-1, b = first+j-1;
      out.indices.push(a,b,b+1, a,b+1,a+1);
    }
    previous = first;
  };
  section(path[0].x,path[0].z,offsets[0].x,offsets[0].z);
  for (let i = 0; i < (closed ? count : count-1); i++) {
    const j = (i+1)%count, a = path[i], b = path[j], n = offsets[i], m = offsets[j];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/14));
    for (let k = 1; k <= steps; k++) {
      const f = k/steps;
      section(a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f,n.x+(m.x-n.x)*f,n.z+(m.z-n.z)*f);
    }
  }
}

function longAxis(ring: Point[]) {
  let length = 0, axis = {x: 1, z: 0};
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i+1)%ring.length], dx = b.x-a.x, dz = b.z-a.z;
    const next = Math.hypot(dx,dz);
    if (next > length) { length = next; axis = {x: dx/next, z: dz/next}; }
  }
  return axis;
}

const distance2 = (a: Point, b: Point) => (a.x-b.x)**2+(a.z-b.z)**2;

/** Clip each row to an even/odd scan across the parcel, including any holes. */
function fieldRows(rings: Point[][], axis: Point, spacing: number, add: (a: Point, b: Point) => void) {
  const cross = {x: -axis.z, z: axis.x};
  const uv = rings.map(ring => ring.map(p => ({x: p.x*axis.x+p.z*axis.z, z: p.x*cross.x+p.z*cross.z})));
  let low = Infinity, high = -Infinity;
  for (const p of uv[0]) { low = Math.min(low,p.z); high = Math.max(high,p.z); }
  for (let v = Math.ceil((low+1)/spacing)*spacing; v < high-1; v += spacing) {
    const hits: number[] = [];
    for (const ring of uv) for (let i=0; i<ring.length; i++) {
      const a = ring[i], b = ring[(i+1)%ring.length];
      if ((a.z>v) !== (b.z>v)) hits.push(a.x+(b.x-a.x)*(v-a.z)/(b.z-a.z));
    }
    hits.sort((a,b) => a-b);
    for (let i=0; i+1<hits.length; i+=2) {
      const a = hits[i]+1.15, b = hits[i+1]-1.15;
      if (b-a < 2) continue;
      add({x:axis.x*a+cross.x*v,z:axis.z*a+cross.z*v}, {x:axis.x*b+cross.x*v,z:axis.z*b+cross.z*v});
    }
  }
}

const bund: Section[] = [[-.75,.13],[-.5,.72],[.42,.72],[.72,.08]];
const furrow: Section[] = [[-.64,.21],[-.38,.62],[.35,.62],[.64,.21]];
const rice: Section[] = [[-.46,.18],[-.37,.53],[.37,.53],[.46,.18]];

export function addField(out: GroundGeometry, feature: GroundFeature, ground: Elevation, detail: boolean) {
  const rings = feature.paths.map(pathPoints), outer = rings[0], axis = longAxis(outer);
  const noise = Math.sin(outer[0].x*.61+outer[0].z*.37)*43758.5453;
  const seed = noise-Math.floor(noise), paddy = feature.kind === PADDY;
  if (detail) {
    if (paddy) fieldRows(rings,axis,2.45,(a,b) => groundRibbon(out,[a,b],false,rice,ground,SURFACE.rice,seed,axis));
    else if (feature.kind === FIELD) fieldRows(rings,axis,3.15,(a,b) => groundRibbon(out,[a,b],false,furrow,ground,SURFACE.ridge,seed));
    return;
  }
  const style = paddy ? SURFACE.paddy : SURFACE.field;
  const height = paddy ? .19 : .24;
  const vertex = (p: Point) => out.vertex(p.x, ground(p.x,p.z)+height, p.z, style, seed, -p.x*axis.z+p.z*axis.x,p.x*axis.x+p.z*axis.z);
  const points = rings.flat(), ids = points.map(vertex);
  const projected = rings.map(ring => ring.map(p => new THREE.Vector2(p.x,p.z)));
  const triangles = THREE.ShapeUtils.triangulateShape(projected[0],projected.slice(1));
  const split = (a: number, b: number, c: number, depth: number) => {
    const ab = distance2(points[a],points[b]), bc = distance2(points[b],points[c]), ca = distance2(points[c],points[a]);
    if (depth < 9 && Math.max(ab,bc,ca) > 38**2) {
      if (bc > ab && bc >= ca) [a,b,c] = [b,c,a];
      else if (ca > ab) [a,b,c] = [c,a,b];
      const mid = {x:(points[a].x+points[b].x)/2,z:(points[a].z+points[b].z)/2};
      const m = points.push(mid)-1;
      ids.push(vertex(mid));
      split(a,m,c,depth+1); split(m,b,c,depth+1);
    } else out.indices.push(ids[c],ids[b],ids[a]);
  };
  for (const [a,b,c] of triangles) split(a,b,c,0);
  if (paddy) for (const ring of rings) groundRibbon(out,ring,true,bund,ground,SURFACE.bund,seed);
}

const wetShelf: Section[] = [[-.42,-.58],[-.38,.40],[1.65,.42],[1.9,.15]];
const upperShelf: Section[] = [[1.45,.18],[1.65,.88],[3.25,.89],[4.05,.04]];

/** The positive offsets face land on outer banks as well as on islands. */
export function addBank(out: GroundGeometry, feature: GroundFeature, ground: Elevation) {
  const path = pathPoints(feature.paths[0]);
  const seed = .5;
  groundRibbon(out,path,false,wetShelf,ground,SURFACE.gravel,seed);
  groundRibbon(out,path,false,upperShelf,ground,SURFACE.grassBank,seed);
}
