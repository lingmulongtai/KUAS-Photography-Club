/** World-anchored, full-circle vegetation candidates; sparse outer rings bound the GPU cost. */
export function* forestCells(eye: { x: number; z: number }, quality: number, detailedNear=false) {
  const bands = quality > .75 ? [[32, 240, 8], [240, 1200, 18], [1200, 4800, 48], [4800,10000,128]] : [[40, 160, 12], [160, 1100, 27], [1100, 4200, 64], [4200,10000,192]];
  const rings=bands.flatMap(([inner,outer,step],lod)=>lod===1&&detailedNear ?
    [[inner,650,quality>.75?8:12,lod],[650,outer,step,lod]] : [[inner,outer,step,lod]]);
  for (const [inner,outer,step,lod] of rings) {
    for (let ix = Math.floor((eye.x - outer) / step); ix <= Math.ceil((eye.x + outer) / step); ix++) {
      for (let iz = Math.floor((eye.z - outer) / step); iz <= Math.ceil((eye.z + outer) / step); iz++) {
        const seed = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
        const u = seed - Math.floor(seed);
        const v = Math.sin(seed) * 15731.7;
        const x = (ix + .1 + u * .8) * step;
        const z = (iz + .1 + (v - Math.floor(v)) * .8) * step;
        const distance = Math.hypot(x - eye.x, z - eye.z);
        if (distance >= inner && distance < outer) yield { x, z, lod, seed: u };
      }
    }
  }
}

/** Raw sRGB aerial colours: accept mixed canopy, reject pale roofs and blue water. */
export function woodland(c: number[]) {
  const [r, g, b] = c;
  return g > r * .98 && g > b * 1.06 && g - Math.min(r, b) > .025 && (r + g + b) / 3 < .62;
}
