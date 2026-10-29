import type { Heightfield } from './heightfield';
import type { KamoChannel } from './kamo-channel';

/** Keep nearby triangles on the same world lattice across streaming updates. */
function terrainAxis(lo:number,hi:number,center:number,segments:number) {
  const values=new Float64Array(segments+1),half=Math.floor(segments/4),radius=1600;
  const stable=segments>=100&&hi-lo>radius*2;
  const step=radius/half;
  const anchor=stable?Math.max(Math.ceil((lo+radius)/step)*step,
    Math.min(Math.floor((hi-radius)/step)*step,Math.round(center/step)*step)):center;
  const left=Math.floor(segments/2)-half,right=Math.floor(segments/2)+half;
  for(let i=0;i<=segments;i++) {
    if(stable) {
      values[i]=i<left?anchor-radius-(anchor-radius-lo)*((left-i)/left)**2.1
        :i>right?anchor+radius+(hi-anchor-radius)*((i-right)/(segments-right))**2.1
        :anchor+(i-Math.floor(segments/2))*step;
    } else {
      const u=i/segments*2-1,s=Math.abs(u)**2.1;
      values[i]=u<0?center-(center-lo)*s:center+(hi-center)*s;
    }
  }
  values[0]=lo-20000;values[segments]=hi+20000;
  return values;
}

/** A grid can be filled in batches without showing a partially updated mesh. */
function terrainGrid(hf: Heightfield, center: { x: number; z: number }, segments: number, channel?: KamoChannel) {
  const [minX, minZ, maxX, maxZ] = hf.bounds;
  const n = segments + 1;
  // Snapshot both axes before yielding; the explorer can keep moving meanwhile.
  const xs=terrainAxis(minX,maxX,center.x,segments),zs=terrainAxis(minZ,maxZ,center.z,segments);
  const clampedX=xs.map(x=>Math.min(Math.max(x,minX),maxX));
  const pos = new Float32Array(n * n * 3);
  const write = (first: number, end: number) => { for (let j = first; j < end; j++) {
    const z=zs[j];
    const cz = Math.min(Math.max(z, minZ), maxZ);
    for (let i = 0; i < n; i++) {
      const x = xs[i], cx = clampedX[i], k = (j * n + i) * 3;
      pos[k] = x;
      const ground = hf.height(cx, cz);
      pos[k + 1] = (channel ? channel.bed(cx, cz, ground) : ground) - (cx !== x || cz !== z ? 60 : 0);
      pos[k + 2] = z;
    }
  }};
  return { pos, n, write };
}

/** Vertex positions of the warped grid, with each column calculated only once. */
export function terrainPositions(hf: Heightfield, center: { x: number; z: number }, segments: number, channel?: KamoChannel) {
  const grid = terrainGrid(hf, center, segments, channel);
  grid.write(0, grid.n);
  return grid.pos;
}

/** Keep the current terrain visible while preparing a replacement in short browser tasks. */
export async function terrainPositionsAsync(hf: Heightfield, center: { x: number; z: number }, segments: number,
  channel: KamoChannel | undefined, current: () => boolean, yieldTask: () => Promise<void>) {
  const grid = terrainGrid(hf, center, segments, channel);
  for (let row = 0; row < grid.n; row += 12) {
    if (!current()) return null;
    grid.write(row, Math.min(row + 12, grid.n));
    if (row + 12 < grid.n) await yieldTask();
  }
  return current() ? grid.pos : null;
}
